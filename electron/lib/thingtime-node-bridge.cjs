'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const NODE_LABEL = 'com.thingtime.desktop.node';
const NODE_BUNDLE_ID = 'com.thingtime.desktop.node';
const BRIDGE_BUNDLE_ID = 'com.thingtime.desktop.node.bridge';
const DESKTOP_BUNDLE_ID = 'com.thingtime.desktop';
const MANAGED_PLIST_MARKER = 'Managed by Thingtime Electron';
const MAX_FRAME_BYTES = 1_048_576;
const MAX_ERROR_BYTES = 16_384;
const BRIDGE_TIMEOUT_MS = 17_000;
const PRESENCE_BRIDGE_TIMEOUT_MS = 142_000;
const PAIRING_BRIDGE_TIMEOUT_MS = 562_000;
const MAX_COMMAND_ID_BYTES = 512;
const MAX_LOCAL_PROJECTS = 128;
const MAX_PROJECT_PATH_BYTES = 4_096;
const MAX_PROJECT_REGISTRY_BYTES = 1_048_576;
const ALLOWED_SIGNATURE_MODES = new Set(['local', 'production', 'runtime']);
const LOCAL_SIGNING_AUTHORITY_PREFIX = 'Apple Development:';
const PRODUCTION_SIGNING_AUTHORITY_PREFIX = 'Developer ID Application:';
const ELECTRON_ENTITLEMENTS = new Set(['com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory']);
// Ad-hoc hardened-runtime applications do not inherit the Developer ID library
// validation policy. Keep this relaxation confined to the explicitly labelled
// temporary unsigned lane; the signed update path stays exact and unchanged.
const UNSIGNED_ELECTRON_ENTITLEMENTS = new Set([
	...ELECTRON_ENTITLEMENTS,
	'com.apple.security.cs.disable-library-validation'
]);

const CONNECTOR_OPERATIONS = new Set([
	'connector/list',
	'connector/start',
	'connector/stop',
	'session/list',
	'session/read',
	'session/create',
	'session/send',
	'session/interrupt',
	'approval/respond'
]);

const DEVICE_ACTION_KINDS = new Set([
	'telemetry.refresh',
	'system.volume.set',
	'system.audio.mute.set',
	'system.audio.input.volume.set',
	'system.audio.input.mute.set',
	'system.audio.output.set',
	'system.audio.input.set',
	'system.audio.sound-effects.volume.set',
	'system.audio.sound-effects.mute.set',
	'system.audio.sound-effects-output.set',
	'system.brightness.set',
	'application.activate',
	'application.launch',
	'application.quit',
	'application.force-quit',
	'application.hide',
	'application.unhide',
	'application.hide-others',
	'system.lock',
	'system.sleep',
	'system.wifi.connect',
	'system.wifi.disconnect',
	'system.wifi.power.set'
]);
const MENU_BAR_ICON_IDS = new Set([
	'tree-color',
	'tree-template',
	'tree-black',
	'tree-white',
	'tree-pink',
	'tree-blue',
	'wordmark-color',
	'wordmark-template',
	'wordmark-black',
	'wordmark-white',
	'custom'
]);

class ThingtimeNodeBridgeError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'ThingtimeNodeBridgeError';
		this.code = code;
	}
}

function isPlainObject(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function byteLength(value) {
	return Buffer.byteLength(value, 'utf8');
}

function boundedString(value, label, maximumBytes, { allowEmpty = false } = {}) {
	if (typeof value !== 'string') {
		throw new ThingtimeNodeBridgeError('invalid_request', `${label} must be a string.`);
	}
	if ((!allowEmpty && !value) || byteLength(value) > maximumBytes || /[\0\r\n]/u.test(value)) {
		throw new ThingtimeNodeBridgeError('invalid_request', `${label} is invalid.`);
	}
	return value;
}

function commandId(value) {
	return boundedString(value, 'commandId', MAX_COMMAND_ID_BYTES);
}

function boundedJson(value, label = 'payload') {
	let encoded;
	try {
		encoded = JSON.stringify(value);
	} catch {
		throw new ThingtimeNodeBridgeError('invalid_request', `${label} must be JSON serializable.`);
	}
	if (!encoded || byteLength(encoded) > MAX_FRAME_BYTES) {
		throw new ThingtimeNodeBridgeError('invalid_request', `${label} exceeds the local bridge limit.`);
	}
	return encoded;
}

function nodeRequest(method, parameters = {}, suppliedCommandId) {
	boundedString(method, 'method', 128);
	if (!isPlainObject(parameters)) {
		throw new ThingtimeNodeBridgeError('invalid_request', 'Node parameters must be an object.');
	}
	const request = {
		id: crypto.randomUUID(),
		method,
		parameters
	};
	if (suppliedCommandId !== undefined && suppliedCommandId !== null) {
		request.commandId = commandId(suppliedCommandId);
	}
	boundedJson(request, 'node request');
	return request;
}

function nodeRequestTimeoutMs(method) {
	if (method === 'pairing.claim' || method === 'pairing.resume') return PAIRING_BRIDGE_TIMEOUT_MS;
	if (method === 'pairing.unpair' || method === 'permissions.request') return PRESENCE_BRIDGE_TIMEOUT_MS;
	return BRIDGE_TIMEOUT_MS;
}

function validateConnectorRequest(value) {
	if (!isPlainObject(value)) {
		throw new ThingtimeNodeBridgeError('invalid_request', 'Connector request must be an object.');
	}
	const action = boundedString(value.action, 'Connector action', 16);
	if (!['start', 'stop', 'send'].includes(action)) {
		throw new ThingtimeNodeBridgeError('invalid_request', 'Connector action is not supported.');
	}
	const id = commandId(value.commandId);
	if (action === 'start' || action === 'stop') {
		return { action, commandId: id };
	}
	const operation = boundedString(value.operation, 'Connector operation', 64);
	if (!CONNECTOR_OPERATIONS.has(operation)) {
		throw new ThingtimeNodeBridgeError('invalid_request', 'Connector operation is not allowed.');
	}
	const payload = value.payload === undefined ? {} : value.payload;
	if (!isPlainObject(payload)) {
		throw new ThingtimeNodeBridgeError('invalid_request', 'Connector payload must be an object.');
	}
	boundedJson(payload, 'connector payload');
	return { action, commandId: id, operation, payload };
}

function validateDeviceRequest(value) {
	if (!isPlainObject(value)) {
		throw new ThingtimeNodeBridgeError('invalid_request', 'Device request must be an object.');
	}
	const action = boundedString(value.action, 'Device action', 16);
	if (action === 'snapshot' || action === 'permissions') return { action };
	if (action !== 'evaluate' && action !== 'execute') {
		throw new ThingtimeNodeBridgeError('invalid_request', 'Device action is not supported.');
	}
	if (!isPlainObject(value.request)) {
		throw new ThingtimeNodeBridgeError('invalid_request', 'Device action request must be an object.');
	}
	const kind = boundedString(value.request.kind, 'Device action kind', 64);
	if (!DEVICE_ACTION_KINDS.has(kind)) {
		throw new ThingtimeNodeBridgeError('invalid_request', 'Device action kind is not allowed.');
	}
	const parameters = value.request.parameters === undefined ? {} : value.request.parameters;
	if (!isPlainObject(parameters)) {
		throw new ThingtimeNodeBridgeError('invalid_request', 'Device action parameters must be an object.');
	}
	boundedJson(parameters, 'device action parameters');
	return {
		action,
		commandId: action === 'execute' ? commandId(value.commandId) : undefined,
		request: { kind, parameters }
	};
}

function xmlEscape(value) {
	return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function plistString(value) {
	return `        <string>${xmlEscape(value)}</string>`;
}

function plistKey(value) {
	return `        <key>${xmlEscape(value)}</key>`;
}

function buildLaunchAgentPlist({
	helperExecutable,
	electronExecutable,
	runtimePath,
	childEnvironment,
	apiBaseUrl,
	projectRegistryPath = null,
	menuBarIconId = 'tree-pink',
	menuBarCustomIconPath = null,
	unsignedDistribution = false
}) {
	for (const [label, value] of [
		['helper executable', helperExecutable],
		['Electron executable', electronExecutable],
		['connector runtime', runtimePath]
	]) {
		boundedString(value, label, 16_384);
		if (!path.isAbsolute(value)) {
			throw new ThingtimeNodeBridgeError('invalid_request', `${label} must be an absolute path.`);
		}
	}

	const connectorEnvironment = {
		...childEnvironment,
		ELECTRON_RUN_AS_NODE: '1',
		NODE_NO_WARNINGS: '1'
	};
	if (projectRegistryPath) {
		boundedString(projectRegistryPath, 'project registry path', MAX_PROJECT_PATH_BYTES);
		if (!path.isAbsolute(projectRegistryPath)) {
			throw new ThingtimeNodeBridgeError('invalid_request', 'project registry path must be absolute.');
		}
		connectorEnvironment.THINGTIME_NODE_PROJECT_REGISTRY_PATH = projectRegistryPath;
	}
	const environment = {
		THINGTIME_NODE_MACH_SERVICE: '1',
		THINGTIME_NODE_CONNECTOR_EXECUTABLE: electronExecutable,
		THINGTIME_NODE_CONNECTOR_ARGUMENTS_JSON: JSON.stringify([runtimePath]),
		THINGTIME_NODE_CONNECTOR_ENV_JSON: JSON.stringify(connectorEnvironment)
	};
	if (apiBaseUrl) environment.THINGTIME_NODE_API_BASE_URL = apiBaseUrl;
	if (unsignedDistribution === true) environment.THINGTIME_NODE_UNSIGNED_DISTRIBUTION = '1';
	if (!MENU_BAR_ICON_IDS.has(menuBarIconId)) {
		throw new ThingtimeNodeBridgeError('invalid_request', 'Thingtime Node menu bar icon is invalid.');
	}
	environment.THINGTIME_NODE_MENU_BAR_ICON = menuBarIconId;
	if (menuBarCustomIconPath) {
		boundedString(menuBarCustomIconPath, 'custom menu bar icon path', 4_096);
		if (!path.isAbsolute(menuBarCustomIconPath)) {
			throw new ThingtimeNodeBridgeError('invalid_request', 'Custom menu bar icon path must be absolute.');
		}
		environment.THINGTIME_NODE_MENU_BAR_CUSTOM_ICON_PATH = menuBarCustomIconPath;
	}

	const environmentXml = Object.entries(environment)
		.sort(([left], [right]) => left.localeCompare(right))
		.flatMap(([key, value]) => [plistKey(key), plistString(value)])
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${MANAGED_PLIST_MARKER}. Do not add secrets to this file. -->
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${NODE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${plistString(helperExecutable)}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>LimitLoadToSessionType</key>
    <string>Aqua</string>
    <key>ProcessType</key>
    <string>Interactive</string>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>EnvironmentVariables</key>
    <dict>
${environmentXml}
    </dict>
    <key>MachServices</key>
    <dict>
        <key>${NODE_LABEL}.xpc</key>
        <true/>
    </dict>
</dict>
</plist>
`;
}

function projectLabelFromPath(projectPath) {
	const source = path
		.basename(projectPath)
		.replace(/[\\/\p{Cc}\p{Cf}]/gu, ' ')
		.trim();
	if (!source) return 'Project';
	let label = '';
	let size = 0;
	for (const character of source) {
		const characterSize = byteLength(character);
		if (size + characterSize > 120) break;
		label += character;
		size += characterSize;
	}
	return label.trim() || 'Project';
}

function localProjectReference(projectPath) {
	const projectId = `local-${crypto.createHash('sha256').update('thingtime-project\0').update(projectPath).digest('hex').slice(0, 32)}`;
	return { projectId, projectLabel: projectLabelFromPath(projectPath) };
}

function validateProjectRegistryPath(registryPath) {
	boundedString(registryPath, 'project registry path', MAX_PROJECT_PATH_BYTES);
	if (!path.isAbsolute(registryPath)) {
		throw new ThingtimeNodeBridgeError('invalid_request', 'The project registry path must be absolute.');
	}
	return path.normalize(registryPath);
}

async function readLocalProjectRegistry(registryPath) {
	let details;
	try {
		details = await fsPromises.lstat(registryPath);
	} catch (error) {
		if (error?.code === 'ENOENT') return [];
		throw new ThingtimeNodeBridgeError('project_registry_unavailable', 'Thingtime could not read its local project registry.');
	}
	if (
		!details.isFile() ||
		details.isSymbolicLink() ||
		details.size > MAX_PROJECT_REGISTRY_BYTES ||
		(details.mode & 0o077) !== 0 ||
		(typeof process.getuid === 'function' && details.uid !== process.getuid())
	) {
		throw new ThingtimeNodeBridgeError('project_registry_invalid', 'The local project registry failed its privacy checks.');
	}
	let parsed;
	try {
		parsed = JSON.parse(await fsPromises.readFile(registryPath, 'utf8'));
	} catch {
		throw new ThingtimeNodeBridgeError('project_registry_invalid', 'The local project registry is invalid.');
	}
	if (
		!isPlainObject(parsed) ||
		Object.keys(parsed).some((key) => !['version', 'projectPaths'].includes(key)) ||
		parsed.version !== 1 ||
		!Array.isArray(parsed.projectPaths) ||
		parsed.projectPaths.length > MAX_LOCAL_PROJECTS
	) {
		throw new ThingtimeNodeBridgeError('project_registry_invalid', 'The local project registry is invalid.');
	}
	const seen = new Set();
	return parsed.projectPaths.map((projectPath) => {
		boundedString(projectPath, 'local project path', MAX_PROJECT_PATH_BYTES);
		if (!path.isAbsolute(projectPath) || seen.has(projectPath)) {
			throw new ThingtimeNodeBridgeError('project_registry_invalid', 'The local project registry is invalid.');
		}
		seen.add(projectPath);
		return projectPath;
	});
}

async function writeLocalProjectRegistry(registryPath, projectPaths) {
	const directory = path.dirname(registryPath);
	await fsPromises.mkdir(directory, { mode: 0o700, recursive: true });
	const encoded = `${JSON.stringify({ version: 1, projectPaths })}\n`;
	if (byteLength(encoded) > MAX_PROJECT_REGISTRY_BYTES) {
		throw new ThingtimeNodeBridgeError('project_registry_invalid', 'The local project registry is too large.');
	}
	const temporaryPath = path.join(directory, `.projects-${process.pid}-${crypto.randomUUID()}.tmp`);
	let handle = null;
	try {
		handle = await fsPromises.open(temporaryPath, 'wx', 0o600);
		await handle.writeFile(encoded, 'utf8');
		await handle.sync();
		await handle.close();
		handle = null;
		await fsPromises.chmod(temporaryPath, 0o600);
		await fsPromises.rename(temporaryPath, registryPath);
		await fsPromises.chmod(registryPath, 0o600);
	} catch (error) {
		if (handle) await handle.close().catch(() => {});
		await fsPromises.rm(temporaryPath, { force: true }).catch(() => {});
		if (error instanceof ThingtimeNodeBridgeError) throw error;
		throw new ThingtimeNodeBridgeError('project_registry_unavailable', 'Thingtime could not update its local project registry.');
	}
}

async function ensureLocalProjectRegistry(registryPathValue) {
	const registryPath = validateProjectRegistryPath(registryPathValue);
	const projectPaths = await readLocalProjectRegistry(registryPath);
	if (!fs.existsSync(registryPath)) await writeLocalProjectRegistry(registryPath, projectPaths);
	return { count: projectPaths.length };
}

async function registerLocalProject(registryPathValue, projectPathValue) {
	const registryPath = validateProjectRegistryPath(registryPathValue);
	boundedString(projectPathValue, 'local project path', MAX_PROJECT_PATH_BYTES);
	if (!path.isAbsolute(projectPathValue)) {
		throw new ThingtimeNodeBridgeError('invalid_request', 'Choose an absolute local project folder.');
	}
	let projectPath;
	try {
		projectPath = await fsPromises.realpath(projectPathValue);
		if (!(await fsPromises.stat(projectPath)).isDirectory()) throw new Error('not-directory');
	} catch {
		throw new ThingtimeNodeBridgeError('invalid_request', 'Choose an available local project folder.');
	}
	const prior = await readLocalProjectRegistry(registryPath);
	const projectPaths = [...prior.filter((candidate) => candidate !== projectPath), projectPath].slice(-MAX_LOCAL_PROJECTS);
	await writeLocalProjectRegistry(registryPath, projectPaths);
	return localProjectReference(projectPath);
}

function resolveNodePaths({ isPackaged, resourcesPath, execPath, electronDir }) {
	const outerContents = isPackaged ? path.resolve(path.dirname(execPath), '..') : null;
	const outerApp = outerContents ? path.resolve(outerContents, '..') : null;
	const helperApp = isPackaged
		? path.join(outerContents, 'Helpers', 'Thingtime Node.app')
		: path.join(electronDir, 'dist', 'native', 'Thingtime Node.app');
	return {
		bridgeExecutable: path.join(helperApp, 'Contents', 'MacOS', 'ThingtimeNodeBridge'),
		electronExecutable: execPath,
		helperApp,
		helperExecutable: path.join(helperApp, 'Contents', 'MacOS', 'ThingtimeNode'),
		launchAgentPath: path.join(os.homedir(), 'Library', 'LaunchAgents', `${NODE_LABEL}.plist`),
		outerApp,
		runtimePath: isPackaged
			? path.join(resourcesPath, 'ai', 'thingtime-node-runtime.mjs')
			: path.join(electronDir, 'dist', 'ai', 'thingtime-node-runtime.mjs')
	};
}

function runProcess(command, args, options = {}) {
	const input = options.input === undefined ? null : Buffer.from(options.input);
	const maximumOutputBytes = options.maximumOutputBytes || MAX_FRAME_BYTES;
	const maximumErrorBytes = options.maximumErrorBytes || MAX_ERROR_BYTES;
	const timeoutMs = options.timeoutMs || BRIDGE_TIMEOUT_MS;

	return new Promise((resolve, reject) => {
		let settled = false;
		let stdout = Buffer.alloc(0);
		let stderr = Buffer.alloc(0);
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			shell: false,
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true
		});

		const finish = (callback, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			callback(value);
		};

		const fail = (code, message) => {
			child.kill('SIGKILL');
			finish(reject, new ThingtimeNodeBridgeError(code, message));
		};

		const timer = setTimeout(() => fail('node_timeout', 'Thingtime Node did not respond in time.'), timeoutMs);
		timer.unref?.();

		child.on('error', () => fail('node_unavailable', 'Thingtime Node could not be started.'));
		child.stdout.on('data', (chunk) => {
			stdout = Buffer.concat([stdout, chunk]);
			if (stdout.length > maximumOutputBytes) fail('node_protocol_error', 'Thingtime Node returned an oversized response.');
		});
		child.stderr.on('data', (chunk) => {
			if (stderr.length < maximumErrorBytes) {
				stderr = Buffer.concat([stderr, chunk]).subarray(0, maximumErrorBytes);
			}
		});
		child.on('close', (status, signal) => {
			finish(resolve, {
				signal,
				status: typeof status === 'number' ? status : 1,
				stderr: stderr.toString('utf8'),
				stdout: stdout.toString('utf8')
			});
		});

		if (input) child.stdin.end(input);
		else child.stdin.end();
	});
}

function parseCodeSignatureDetails(output) {
	const identifier = output.match(/^Identifier=(.+)$/mu)?.[1]?.trim() || null;
	const teamIdentifier = output.match(/^TeamIdentifier=(.+)$/mu)?.[1]?.trim() || null;
	const authorities = [...output.matchAll(/^Authority=(.+)$/gmu)].map((match) => match[1].trim());
	const timestamp = output.match(/^Timestamp=(.+)$/mu)?.[1]?.trim() || null;
	const runtimeVersion = output.match(/^Runtime Version=(.+)$/mu)?.[1]?.trim() || null;
	return { authorities, hardenedRuntime: Boolean(runtimeVersion), identifier, runtimeVersion, teamIdentifier, timestamp };
}

function parseEntitlementKeys(output) {
	const keys = new Set();
	for (const match of output.matchAll(/<key>([^<]+)<\/key>/gu)) keys.add(match[1].trim());
	for (const match of output.matchAll(/^\s*\[Key\]\s+(.+)$/gmu)) keys.add(match[1].trim());
	return [...keys].sort();
}

async function signatureDetails(targetPath, runner = runProcess) {
	const verification = await runner('/usr/bin/codesign', ['--verify', '--deep', '--strict', targetPath], {
		maximumOutputBytes: MAX_ERROR_BYTES
	});
	if (verification.status !== 0) {
		throw new ThingtimeNodeBridgeError('invalid_signature', 'Thingtime Node has an invalid code signature.');
	}
	const display = await runner('/usr/bin/codesign', ['--display', '--verbose=4', targetPath], {
		maximumOutputBytes: MAX_ERROR_BYTES
	});
	if (display.status !== 0) {
		throw new ThingtimeNodeBridgeError('invalid_signature', 'Thingtime Node signing details are unavailable.');
	}
	const entitlements = await runner('/usr/bin/codesign', ['--display', '--entitlements', ':-', targetPath], {
		maximumOutputBytes: MAX_ERROR_BYTES
	});
	if (entitlements.status !== 0) {
		throw new ThingtimeNodeBridgeError('invalid_signature', 'Thingtime Node entitlements are unavailable.');
	}
	return {
		...parseCodeSignatureDetails(`${display.stdout}\n${display.stderr}`),
		entitlementKeys: parseEntitlementKeys(`${entitlements.stdout}\n${entitlements.stderr}`)
	};
}

async function leafCertificateFingerprint(targetPath, runner = runProcess) {
	const temporaryRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'thingtime-signature-'));
	const certificatePrefix = path.join(temporaryRoot, 'certificate-');
	try {
		const extraction = await runner('/usr/bin/codesign', ['--display', `--extract-certificates=${certificatePrefix}`, targetPath], {
			maximumOutputBytes: MAX_ERROR_BYTES
		});
		if (extraction.status !== 0) {
			throw new ThingtimeNodeBridgeError('invalid_signature', 'Thingtime signing certificate details are unavailable.');
		}
		const leafCertificate = await fsPromises.readFile(`${certificatePrefix}0`);
		if (leafCertificate.length === 0) {
			throw new ThingtimeNodeBridgeError('invalid_signature', 'Thingtime signing certificate is empty.');
		}
		return crypto.createHash('sha256').update(leafCertificate).digest('hex');
	} catch (error) {
		if (error instanceof ThingtimeNodeBridgeError) throw error;
		throw new ThingtimeNodeBridgeError('invalid_signature', 'Thingtime signing certificate details are unavailable.');
	} finally {
		await fsPromises.rm(temporaryRoot, { force: true, recursive: true });
	}
}

function signatureIdentityClass(details) {
	const leafAuthority = details.authorities[0] || '';
	if (leafAuthority.startsWith(LOCAL_SIGNING_AUTHORITY_PREFIX)) return 'local';
	if (leafAuthority.startsWith(PRODUCTION_SIGNING_AUTHORITY_PREFIX)) return 'production';
	return null;
}

function assertExpectedEntitlements(details, expectedKeys, label) {
	const actual = details.entitlementKeys || [];
	const expected = [...expectedKeys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
		throw new ThingtimeNodeBridgeError('invalid_entitlements', `${label} has unexpected code-signing entitlements.`);
	}
}

async function verifySignedArtifacts(paths, runner = runProcess, options = {}) {
	const mode = options.mode || 'runtime';
	if (!ALLOWED_SIGNATURE_MODES.has(mode)) {
		throw new ThingtimeNodeBridgeError('invalid_request', 'Thingtime signature verification mode is invalid.');
	}
	if (mode === 'production' && !paths.outerApp) {
		throw new ThingtimeNodeBridgeError('invalid_installation', 'Production verification requires the outer Thingtime application.');
	}
	for (const requiredPath of [paths.helperApp, paths.helperExecutable, paths.bridgeExecutable, paths.runtimePath]) {
		let stat;
		try {
			stat = await fsPromises.lstat(requiredPath);
		} catch {
			throw new ThingtimeNodeBridgeError('node_not_installed', 'Thingtime Node desktop resources are not installed.');
		}
		if (stat.isSymbolicLink()) {
			throw new ThingtimeNodeBridgeError('invalid_installation', 'Thingtime Node resources must not be symbolic links.');
		}
	}

	const helper = await signatureDetails(paths.helperApp, runner);
	const bridge = await signatureDetails(paths.bridgeExecutable, runner);
	const signed = [
		{ details: helper, expectedIdentifier: NODE_BUNDLE_ID, label: 'Thingtime Node', targetPath: paths.helperApp },
		{ details: bridge, expectedIdentifier: BRIDGE_BUNDLE_ID, label: 'Thingtime Node bridge', targetPath: paths.bridgeExecutable }
	];
	if (paths.outerApp) {
		signed.push({
			details: await signatureDetails(paths.outerApp, runner),
			expectedIdentifier: DESKTOP_BUNDLE_ID,
			label: 'Thingtime',
			targetPath: paths.outerApp
		});
	}

	const teams = new Set();
	const identityClasses = new Set();
	for (const { details, expectedIdentifier, label } of signed) {
		if (details.identifier !== expectedIdentifier || !/^[A-Z0-9]{10}$/u.test(details.teamIdentifier || '')) {
			throw new ThingtimeNodeBridgeError('invalid_signature', 'Thingtime Node is not signed with the expected stable identity.');
		}
		if (!details.hardenedRuntime) {
			throw new ThingtimeNodeBridgeError('invalid_signature', `${label} is not signed with Hardened Runtime.`);
		}
		const identityClass = signatureIdentityClass(details);
		if (!identityClass) {
			throw new ThingtimeNodeBridgeError('invalid_signature', `${label} is not signed with an allowed identity class.`);
		}
		if (mode !== 'runtime' && identityClass !== mode) {
			throw new ThingtimeNodeBridgeError('invalid_signature', `${label} is not signed for ${mode} verification.`);
		}
		if (mode === 'production' && !details.timestamp) {
			throw new ThingtimeNodeBridgeError('invalid_signature', `${label} is missing a secure timestamp.`);
		}
		teams.add(details.teamIdentifier);
		identityClasses.add(identityClass);
	}
	if (teams.size !== 1 || identityClasses.size !== 1) {
		throw new ThingtimeNodeBridgeError('invalid_signature', 'Thingtime and Thingtime Node are signed by different teams.');
	}
	const requireExactLeafCertificate = options.requireExactLeafCertificate ?? mode !== 'runtime';
	if (requireExactLeafCertificate) {
		const fingerprints = new Set();
		for (const { targetPath } of signed) {
			fingerprints.add(await leafCertificateFingerprint(targetPath, runner));
		}
		if (fingerprints.size !== 1) {
			throw new ThingtimeNodeBridgeError(
				'invalid_signature',
				'Thingtime, Thingtime Node, and the native bridge are not signed by the same leaf certificate.'
			);
		}
	}
	assertExpectedEntitlements(helper, [], 'Thingtime Node');
	assertExpectedEntitlements(bridge, [], 'Thingtime Node bridge');
	if (paths.outerApp) {
		assertExpectedEntitlements(signed.at(-1).details, ELECTRON_ENTITLEMENTS, 'Thingtime');
	}
	return { identityClass: [...identityClasses][0], teamIdentifier: [...teams][0] };
}

/**
 * A temporary distribution build is intentionally not signed by an Apple team
 * or notarized. It is ad-hoc signed so nested macOS executables can still run.
 * This validates only structure and identifiers; callers must never present it
 * as an Apple-verified update.
 */
async function verifyUnsignedArtifacts(paths, runner = runProcess) {
	const requiredPaths = [paths.helperApp, paths.helperExecutable, paths.bridgeExecutable, paths.runtimePath];
	if (paths.outerApp) requiredPaths.push(paths.outerApp);
	for (const requiredPath of requiredPaths) {
		let stat;
		try {
			stat = await fsPromises.lstat(requiredPath);
		} catch {
			throw new ThingtimeNodeBridgeError('node_not_installed', 'Thingtime Node desktop resources are not installed.');
		}
		if (stat.isSymbolicLink()) {
			throw new ThingtimeNodeBridgeError('invalid_installation', 'Thingtime Node resources must not be symbolic links.');
		}
	}

	const unsigned = [
		{ details: await signatureDetails(paths.helperApp, runner), expectedIdentifier: NODE_BUNDLE_ID, label: 'Thingtime Node' },
		{ details: await signatureDetails(paths.bridgeExecutable, runner), expectedIdentifier: BRIDGE_BUNDLE_ID, label: 'Thingtime Node bridge' }
	];
	if (paths.outerApp) {
		unsigned.push({ details: await signatureDetails(paths.outerApp, runner), expectedIdentifier: DESKTOP_BUNDLE_ID, label: 'Thingtime' });
	}
	for (const { details, expectedIdentifier, label } of unsigned) {
		if (details.identifier !== expectedIdentifier) {
			throw new ThingtimeNodeBridgeError('invalid_signature', `${label} does not have the expected bundle identifier.`);
		}
		if (details.teamIdentifier && details.teamIdentifier !== 'not set') {
			throw new ThingtimeNodeBridgeError('invalid_signature', `${label} is Apple-signed and must not be published as unsigned.`);
		}
		if (details.authorities.some((authority) => authority.startsWith(LOCAL_SIGNING_AUTHORITY_PREFIX) || authority.startsWith(PRODUCTION_SIGNING_AUTHORITY_PREFIX))) {
			throw new ThingtimeNodeBridgeError('invalid_signature', `${label} is Apple-signed and must not be published as unsigned.`);
		}
	}
	assertExpectedEntitlements(unsigned[0].details, [], 'Thingtime Node');
	assertExpectedEntitlements(unsigned[1].details, [], 'Thingtime Node bridge');
	if (paths.outerApp) assertExpectedEntitlements(unsigned.at(-1).details, UNSIGNED_ELECTRON_ENTITLEMENTS, 'Thingtime');
	return { identityClass: 'unsigned', teamIdentifier: null };
}

function safeConnectorEnvironment(environment = process.env) {
	const allowedKeys = ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'CODEX_HOME'];
	const result = {};
	for (const key of allowedKeys) {
		const value = environment[key];
		if (typeof value === 'string' && value && byteLength(value) <= 16_384 && !/[\0\r\n]/u.test(value)) {
			result[key] = value;
		}
	}
	return result;
}

function normalizePermissions(rawPermissions) {
	return {
		permissions: ['accessibility', 'screenRecording'].map((kind) => ({
			kind,
			status: rawPermissions?.[kind] === 'granted' ? 'authorized' : 'denied'
		}))
	};
}

function normalizeNodeStatus(rawStatus, registration, version) {
	const deviceIds = Array.isArray(rawStatus?.pairing?.deviceIDs)
		? [...new Set(rawStatus.pairing.deviceIDs.filter((value) => typeof value === 'string' && value && byteLength(value) <= 512))].slice(0, 32)
		: typeof rawStatus?.pairing?.deviceID === 'string' && rawStatus.pairing.deviceID
		? [rawStatus.pairing.deviceID]
		: [];
	const paired = rawStatus?.pairing?.paired === true && deviceIds.length > 0;
	const connectorState = rawStatus?.connector?.state || 'disabled';
	const degraded = connectorState === 'failed' || connectorState === 'degraded';
	return {
		capabilities: [
			'device.telemetry',
			'system.volume.set',
			'system.audio.mute.set',
			'system.audio.input.volume.set',
			'system.audio.input.mute.set',
			'system.audio.output.set',
			'system.audio.input.set',
			'system.audio.sound-effects.volume.set',
			'system.audio.sound-effects.mute.set',
			'system.audio.sound-effects-output.set',
			'system.brightness.set',
			'application.activate',
			'application.launch',
			'application.quit',
			'application.force-quit',
			'application.hide',
			'application.unhide',
			'application.hide-others',
			'system.lock',
			'system.sleep',
			'system.wifi.connect',
			'system.wifi.disconnect',
			'system.wifi.power.set',
			'connector.codex-app-server'
		],
		connector: rawStatus?.connector || { state: 'disabled' },
		deviceId: deviceIds[0] || null,
		deviceIds,
		pairedAccountCount: deviceIds.length,
		journalEntryCount: Number.isInteger(rawStatus?.journalEntryCount) ? rawStatus.journalEntryCount : 0,
		lastError: null,
		lastSeenAt: new Date().toISOString(),
		loginItem: registration,
		pairingStatus: paired ? 'paired' : 'unpaired',
		recoverablePairing: rawStatus?.recoverablePairing === true,
		permissions: normalizePermissions(rawStatus?.permissions).permissions,
		rawStatus,
		serviceStatus: degraded ? 'degraded' : 'running',
		transportStatus: 'unknown',
		version: version || null
	};
}

function launchctlReportsMissingService(result) {
	return /could not find|no such process|service not found/iu.test(`${result?.stdout || ''}\n${result?.stderr || ''}`);
}

function requireLaunchctlSuccess(result, action, { allowMissing = false } = {}) {
	if (result?.status === 0 || (allowMissing && launchctlReportsMissingService(result))) return;
	throw new ThingtimeNodeBridgeError('login_item_failed', `macOS could not ${action} Thingtime Node.`);
}

function assertManagedLaunchAgentContents(contents) {
	if (typeof contents !== 'string' || !contents.includes(MANAGED_PLIST_MARKER)) {
		throw new ThingtimeNodeBridgeError(
			'login_item_conflict',
			'The existing Thingtime Node LaunchAgent is not owned by Thingtime Electron and was left unchanged.'
		);
	}
}

async function readManagedLaunchAgent(launchAgentPath) {
	let stat;
	try {
		stat = await fsPromises.lstat(launchAgentPath);
	} catch (error) {
		if (error?.code === 'ENOENT') return null;
		throw error;
	}
	if (stat.isSymbolicLink() || !stat.isFile()) {
		throw new ThingtimeNodeBridgeError(
			'login_item_conflict',
			'The existing Thingtime Node LaunchAgent is not a regular Thingtime-managed file and was left unchanged.'
		);
	}
	const contents = await fsPromises.readFile(launchAgentPath, 'utf8');
	assertManagedLaunchAgentContents(contents);
	return contents;
}

async function writeLaunchAgentAtomically(launchAgentPath, contents) {
	const temporaryPath = `${launchAgentPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
	try {
		await fsPromises.writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
		await fsPromises.rename(temporaryPath, launchAgentPath);
	} finally {
		await fsPromises.rm(temporaryPath, { force: true });
	}
}

async function startLaunchAgent(runner, domain, launchAgentPath) {
	// Clear a persisted disabled override before bootstrap. RunAtLoad starts the
	// freshly bootstrapped service; immediately kickstarting with `-k` would kill
	// that healthy process and can block while launchd waits for it to relaunch.
	const enable = await runner('/bin/launchctl', ['enable', `${domain}/${NODE_LABEL}`], {
		maximumOutputBytes: MAX_ERROR_BYTES,
		timeoutMs: 5_000
	});
	requireLaunchctlSuccess(enable, 'enable the login agent');
	const bootstrap = await runner('/bin/launchctl', ['bootstrap', domain, launchAgentPath], {
		maximumOutputBytes: MAX_ERROR_BYTES,
		timeoutMs: 10_000
	});
	if (bootstrap.status !== 0) {
		const needsApproval = /not permitted|denied|background item/iu.test(bootstrap.stderr);
		throw new ThingtimeNodeBridgeError(
			needsApproval ? 'login_item_approval_required' : 'login_item_failed',
			needsApproval ? 'macOS requires approval for Thingtime Node in Login Items.' : 'macOS could not register Thingtime Node as a login agent.'
		);
	}
}

async function restoreLaunchAgent({ domain, launchAgentPath, previousContents, previousRegistered, runner }) {
	const failures = [];
	try {
		const bootout = await runner('/bin/launchctl', ['bootout', `${domain}/${NODE_LABEL}`], {
			maximumOutputBytes: MAX_ERROR_BYTES,
			timeoutMs: 5_000
		});
		requireLaunchctlSuccess(bootout, 'stop the failed login agent', { allowMissing: true });
	} catch (error) {
		failures.push(error);
	}
	try {
		if (previousContents === null) await fsPromises.rm(launchAgentPath, { force: true });
		else await writeLaunchAgentAtomically(launchAgentPath, previousContents);
	} catch (error) {
		failures.push(error);
	}
	if (previousRegistered) {
		try {
			await startLaunchAgent(runner, domain, launchAgentPath);
		} catch (error) {
			failures.push(error);
		}
	}
	if (failures.length) throw new AggregateError(failures, 'Thingtime Node LaunchAgent rollback failed.');
}

class ThingtimeNodeIntegration {
	constructor({ app, electronDir, environment = process.env, runner = runProcess }) {
		this.app = app;
		this.electronDir = electronDir;
		this.environment = environment;
		this.runner = runner;
	}

	paths() {
		return resolveNodePaths({
			electronDir: this.electronDir,
			execPath: process.execPath,
			isPackaged: this.app.isPackaged,
			resourcesPath: process.resourcesPath
		});
	}

	isUnsignedDistribution() {
		return this.app.isPackaged === true && /\.unsigned$/u.test(String(this.app.getVersion?.() || ''));
	}

	bridgeEnvironment() {
		if (!this.isUnsignedDistribution()) return this.environment;
		return { ...this.environment, THINGTIME_NODE_UNSIGNED_DISTRIBUTION: '1' };
	}

	async verify(paths = this.paths()) {
		// Do not cache this result. The helper and bridge are executable trust
		// boundaries, so every execution and service registration must verify the
		// artifacts that are about to be used.
		return this.isUnsignedDistribution()
			? verifyUnsignedArtifacts(paths, this.runner)
			: verifySignedArtifacts(paths, this.runner);
	}

	async request(method, parameters = {}, suppliedCommandId) {
		const paths = this.paths();
		await this.verify(paths);
		const request = nodeRequest(method, parameters, suppliedCommandId);
		const encoded = `${boundedJson(request, 'node request')}\n`;
		const response = await this.runner(paths.bridgeExecutable, [], {
			env: this.bridgeEnvironment(),
			input: encoded,
			maximumOutputBytes: MAX_FRAME_BYTES,
			timeoutMs: nodeRequestTimeoutMs(method)
		});
		if (response.status !== 0) {
			throw new ThingtimeNodeBridgeError('node_unavailable', 'Thingtime Node bridge exited unexpectedly.');
		}

		let decoded;
		try {
			decoded = JSON.parse(response.stdout);
		} catch {
			throw new ThingtimeNodeBridgeError('node_protocol_error', 'Thingtime Node returned an invalid response.');
		}
		if (!isPlainObject(decoded) || decoded.id !== request.id || typeof decoded.ok !== 'boolean') {
			throw new ThingtimeNodeBridgeError('node_protocol_error', 'Thingtime Node returned a mismatched response.');
		}
		if (!decoded.ok) {
			const code = typeof decoded.error?.code === 'string' ? decoded.error.code : 'node_error';
			const message = typeof decoded.error?.message === 'string' ? decoded.error.message.slice(0, 1_000) : 'Thingtime Node rejected the request.';
			throw new ThingtimeNodeBridgeError(code, message);
		}
		return decoded.result ?? {};
	}

	async registrationStatus() {
		const domain = `gui/${process.getuid()}`;
		const result = await this.runner('/bin/launchctl', ['print', `${domain}/${NODE_LABEL}`], {
			maximumOutputBytes: MAX_ERROR_BYTES,
			timeoutMs: 5_000
		});
		return {
			label: NODE_LABEL,
			registered: result.status === 0,
			state: result.status === 0 ? 'enabled' : 'disabled'
		};
	}

	async status() {
		const paths = this.paths();
		if (!fs.existsSync(paths.helperApp) || !fs.existsSync(paths.runtimePath)) {
			return {
				capabilities: [],
				deviceId: null,
				lastError: { code: 'node_not_installed', message: 'Thingtime Node is not embedded in this build.' },
				loginItem: { label: NODE_LABEL, registered: false, state: 'disabled' },
				pairingStatus: 'unpaired',
				permissions: [],
				serviceStatus: 'absent',
				transportStatus: 'unknown',
				version: this.app.getVersion?.() || null
			};
		}

		let registration;
		try {
			await this.verify(paths);
			registration = await this.registrationStatus();
		} catch (error) {
			return {
				capabilities: [],
				deviceId: null,
				lastError: { code: error.code || 'invalid_installation', message: error.message },
				loginItem: { label: NODE_LABEL, registered: false, state: 'disabled' },
				pairingStatus: 'unpaired',
				permissions: [],
				serviceStatus: 'degraded',
				transportStatus: 'unknown',
				version: this.app.getVersion?.() || null
			};
		}
		if (!registration.registered) {
			return {
				capabilities: [],
				deviceId: null,
				lastError: null,
				loginItem: registration,
				pairingStatus: 'unpaired',
				permissions: [],
				serviceStatus: 'stopped',
				transportStatus: 'unknown',
				version: this.app.getVersion?.() || null
			};
		}

		try {
			const raw = await this.request('node.status');
			return normalizeNodeStatus(raw, registration, this.app.getVersion?.());
		} catch (error) {
			return {
				capabilities: [],
				deviceId: null,
				lastError: { code: error.code || 'node_unavailable', message: error.message },
				loginItem: registration,
				pairingStatus: 'unpaired',
				permissions: [],
				serviceStatus: 'starting',
				transportStatus: 'unknown',
				version: this.app.getVersion?.() || null
			};
		}
	}

	servicePlist(
		paths,
		{
			projectRegistryPath = null,
			apiBaseUrl = this.environment.THINGTIME_NODE_API_BASE_URL || null,
			menuBarIconId = this.environment.THINGTIME_NODE_MENU_BAR_ICON || 'tree-pink',
			menuBarCustomIconPath = this.environment.THINGTIME_NODE_MENU_BAR_CUSTOM_ICON_PATH || null
		} = {}
	) {
		if (apiBaseUrl) boundedString(apiBaseUrl, 'Thingtime Node API base URL', 2_048);
		return buildLaunchAgentPlist({
			apiBaseUrl,
			childEnvironment: safeConnectorEnvironment(this.environment),
			electronExecutable: paths.electronExecutable,
			helperExecutable: paths.helperExecutable,
			menuBarCustomIconPath,
			menuBarIconId,
			projectRegistryPath,
			runtimePath: paths.runtimePath,
			unsignedDistribution: this.isUnsignedDistribution()
		});
	}

	async registerService(options = {}) {
		const paths = this.paths();
		await this.verify(paths);
		if (!this.app.isPackaged && this.environment.THINGTIME_NODE_ALLOW_DEV_REGISTRATION !== '1') {
			throw new ThingtimeNodeBridgeError('signed_app_required', 'Register Thingtime Node from a stably signed packaged Thingtime app.');
		}

		const plist = this.servicePlist(paths, options);
		const launchAgentDirectory = path.dirname(paths.launchAgentPath);
		await fsPromises.mkdir(launchAgentDirectory, { mode: 0o700, recursive: true });

		const domain = `gui/${process.getuid()}`;
		const previousContents = await readManagedLaunchAgent(paths.launchAgentPath);
		const previousRegistration = await this.registrationStatus();
		if (previousRegistration.registered && previousContents === null) {
			throw new ThingtimeNodeBridgeError(
				'login_item_conflict',
				'A Thingtime Node service is registered without a Thingtime Electron-managed LaunchAgent and was left unchanged.'
			);
		}
		const bootout = await this.runner('/bin/launchctl', ['bootout', `${domain}/${NODE_LABEL}`], {
			maximumOutputBytes: MAX_ERROR_BYTES,
			timeoutMs: 5_000
		});
		requireLaunchctlSuccess(bootout, 'stop the existing login agent', { allowMissing: true });
		let registrationChanged = true;
		try {
			await writeLaunchAgentAtomically(paths.launchAgentPath, plist);

			// bootout and plist creation leave an attacker-controlled time window after
			// the early diagnostic check. Revalidate immediately before launchd is
			// asked to execute the helper.
			await this.verify(paths);
			await startLaunchAgent(this.runner, domain, paths.launchAgentPath);
			registrationChanged = false;
		} catch (error) {
			if (registrationChanged) {
				try {
					await restoreLaunchAgent({
						domain,
						launchAgentPath: paths.launchAgentPath,
						previousContents,
						previousRegistered: previousRegistration.registered,
						runner: this.runner
					});
				} catch (rollbackError) {
					const failure = new ThingtimeNodeBridgeError(
						'login_item_rollback_failed',
						'Thingtime Node registration failed and macOS could not restore the previous login agent.'
					);
					failure.cause = rollbackError;
					throw failure;
				}
			}
			throw error;
		}
		return this.status();
	}

	async reconcileRegisteredService(options = {}, { startIfStopped = false } = {}) {
		const paths = this.paths();
		const registration = await this.registrationStatus();
		const existing = await readManagedLaunchAgent(paths.launchAgentPath);
		if (!registration.registered) {
			// A missing plist means the user has never enabled the node (or removed it
			// explicitly), so app launch must not install one silently. The native Quit
			// item intentionally leaves our managed plist behind; default-on desktop
			// launch may safely bootstrap that previously approved service again.
			if (existing === null || startIfStopped !== true) return this.status();
			await this.verify(paths);
			return this.registerService(options);
		}
		await this.verify(paths);
		if (existing === null) {
			throw new ThingtimeNodeBridgeError(
				'login_item_conflict',
				'A Thingtime Node service is registered without a Thingtime Electron-managed LaunchAgent and was left unchanged.'
			);
		}
		return existing === this.servicePlist(paths, options) ? this.status() : this.registerService(options);
	}

	async unregisterService() {
		const paths = this.paths();
		const domain = `gui/${process.getuid()}`;
		const existing = await readManagedLaunchAgent(paths.launchAgentPath);
		const registration = await this.registrationStatus();
		if (registration.registered && existing === null) {
			throw new ThingtimeNodeBridgeError(
				'login_item_conflict',
				'A Thingtime Node service is registered without a Thingtime Electron-managed LaunchAgent and was left unchanged.'
			);
		}
		const bootout = await this.runner('/bin/launchctl', ['bootout', `${domain}/${NODE_LABEL}`], {
			maximumOutputBytes: MAX_ERROR_BYTES,
			timeoutMs: 10_000
		});
		requireLaunchctlSuccess(bootout, 'stop the login agent', { allowMissing: true });
		if (existing !== null) await fsPromises.rm(paths.launchAgentPath, { force: true });
		return this.status();
	}

	async connector(value) {
		const request = validateConnectorRequest(value);
		if (request.action === 'start') return this.request('connector.start', {}, request.commandId);
		if (request.action === 'stop') return this.request('connector.stop', {}, request.commandId);
		return this.request('connector.send', { operation: request.operation, payload: request.payload }, request.commandId);
	}

	async device(value, { userApproved = false } = {}) {
		const request = validateDeviceRequest(value);
		if (request.action === 'snapshot') return this.request('telemetry.snapshot');
		if (request.action === 'permissions') return this.request('permissions.preflight');

		const telemetry = await this.request('telemetry.snapshot');
		const parameters = {
			action: request.request,
			context: {
				origin: 'remoteAccount',
				sessionLocked: telemetry?.session?.isLocked === true,
				userApproved: userApproved === true
			}
		};
		return this.request(request.action === 'evaluate' ? 'action.evaluate' : 'action.execute', parameters, request.commandId);
	}
}

module.exports = {
	BRIDGE_BUNDLE_ID,
	CONNECTOR_OPERATIONS,
	DESKTOP_BUNDLE_ID,
	DEVICE_ACTION_KINDS,
	MANAGED_PLIST_MARKER,
	MAX_FRAME_BYTES,
	NODE_BUNDLE_ID,
	NODE_LABEL,
	ThingtimeNodeBridgeError,
	ThingtimeNodeIntegration,
	buildLaunchAgentPlist,
	ensureLocalProjectRegistry,
	nodeRequest,
	nodeRequestTimeoutMs,
	normalizeNodeStatus,
	normalizePermissions,
	parseCodeSignatureDetails,
	resolveNodePaths,
	registerLocalProject,
	runProcess,
	safeConnectorEnvironment,
	validateConnectorRequest,
	validateDeviceRequest,
	verifySignedArtifacts,
	verifyUnsignedArtifacts
};
