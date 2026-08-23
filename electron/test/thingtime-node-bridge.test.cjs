'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
	buildLaunchAgentPlist,
	ensureLocalProjectRegistry,
	nodeRequestTimeoutMs,
	normalizeNodeStatus,
	parseCodeSignatureDetails,
	safeConnectorEnvironment,
	registerLocalProject,
	ThingtimeNodeIntegration,
	validateConnectorRequest,
	validateDeviceRequest,
	verifySignedArtifacts
} = require('../lib/thingtime-node-bridge.cjs');

async function makeSignedNodeFixture() {
	const root = await mkdtemp(path.join(tmpdir(), 'thingtime-node-bridge-'));
	const helperApp = path.join(root, 'Thingtime Node.app');
	const helperExecutable = path.join(helperApp, 'Contents', 'MacOS', 'ThingtimeNode');
	const bridgeExecutable = path.join(helperApp, 'Contents', 'MacOS', 'ThingtimeNodeBridge');
	const runtimePath = path.join(root, 'thingtime-node-runtime.mjs');
	const paths = {
		bridgeExecutable,
		electronExecutable: '/Applications/Thingtime.app/Contents/MacOS/Thingtime',
		helperApp,
		helperExecutable,
		launchAgentPath: path.join(root, 'Library', 'LaunchAgents', 'com.thingtime.desktop.node.plist'),
		outerApp: null,
		runtimePath
	};
	await mkdir(path.dirname(helperExecutable), { recursive: true });
	await writeFile(helperExecutable, 'signed helper');
	await writeFile(bridgeExecutable, 'signed bridge');
	await writeFile(runtimePath, 'export {};');

	const state = {
		bootstrapCalls: 0,
		bootstrapPlists: [],
		bootoutCalls: 0,
		bridgeRuns: 0,
		bridgeTimeouts: [],
		certificateByTarget: new Map(),
		certificateExtractionArguments: [],
		failBootstrapCount: 0,
		launchctlCalls: [],
		replaceOnBootout: false,
		serviceRegistered: false
	};
	const runner = async (command, args, options = {}) => {
		if (command === '/usr/bin/codesign') {
			const target = args.at(-1);
			if (args[0] === '--verify') {
				const valid = target !== bridgeExecutable || (await readFile(bridgeExecutable, 'utf8')) === 'signed bridge';
				return { status: valid ? 0 : 1, signal: null, stdout: '', stderr: valid ? '' : 'invalid signature' };
			}
			if (args.includes('--entitlements')) {
				return { status: 0, signal: null, stdout: '<?xml version="1.0"?><plist><dict></dict></plist>', stderr: '' };
			}
			const certificateExtractionArgument = args.find((argument) => argument.startsWith('--extract-certificates='));
			if (certificateExtractionArgument) {
				state.certificateExtractionArguments.push([...args]);
				const prefix = certificateExtractionArgument.slice('--extract-certificates='.length);
				await writeFile(`${prefix}0`, state.certificateByTarget.get(target) || 'shared leaf certificate');
				return { status: 0, signal: null, stdout: '', stderr: '' };
			}
			if (args.includes('--extract-certificates')) {
				return { status: 1, signal: null, stdout: '', stderr: 'separate certificate prefix argument is unsupported' };
			}
			const identifier = target === bridgeExecutable ? 'com.thingtime.desktop.node.bridge' : 'com.thingtime.desktop.node';
			return {
				status: 0,
				signal: null,
				stdout: '',
				stderr: `Identifier=${identifier}\nTeamIdentifier=6DQQ9V7C84\nAuthority=Apple Development: Test (ABCDE12345)\nRuntime Version=15.0.0\n`
			};
		}
		if (command === bridgeExecutable) {
			state.bridgeRuns += 1;
			state.bridgeTimeouts.push(options.timeoutMs);
			const request = JSON.parse(Buffer.from(options.input).toString('utf8'));
			return {
				status: 0,
				signal: null,
				stderr: '',
				stdout: JSON.stringify({ id: request.id, ok: true, result: { paired: false } })
			};
		}
		if (command === '/bin/launchctl') {
			state.launchctlCalls.push([...args]);
			if (args[0] === 'print') {
				return {
					status: state.serviceRegistered ? 0 : 1,
					signal: null,
					stdout: '',
					stderr: state.serviceRegistered ? '' : 'Could not find service'
				};
			}
			if (args[0] === 'bootout' && state.replaceOnBootout) {
				await rm(bridgeExecutable, { force: true });
				await symlink('/usr/bin/false', bridgeExecutable);
			}
			if (args[0] === 'bootout') {
				state.bootoutCalls += 1;
				state.serviceRegistered = false;
			}
			if (args[0] === 'bootstrap') {
				state.bootstrapCalls += 1;
				state.bootstrapPlists.push(await readFile(paths.launchAgentPath, 'utf8'));
				if (state.failBootstrapCount > 0) {
					state.failBootstrapCount -= 1;
					return { status: 5, signal: null, stdout: '', stderr: 'bootstrap failed' };
				}
				state.serviceRegistered = true;
			}
			return { status: 0, signal: null, stdout: '', stderr: '' };
		}
		throw new Error(`Unexpected command: ${command}`);
	};
	const integration = new ThingtimeNodeIntegration({
		app: { isPackaged: false, getVersion: () => '0.1.0' },
		electronDir: root,
		environment: { THINGTIME_NODE_ALLOW_DEV_REGISTRATION: '1' },
		runner
	});
	integration.paths = () => paths;
	return { bridgeExecutable, integration, paths, root, runner, state };
}

test('launch agent is deterministic, escaped, and contains the packaged runtime contract', () => {
	const input = {
		apiBaseUrl: 'https://thingtime.com/',
		childEnvironment: {
			ELECTRON_RUN_AS_NODE: '0',
			HOME: '/Users/A&B',
			NODE_NO_WARNINGS: '0',
			PATH: '/opt/bin:/usr/bin'
		},
		electronExecutable: '/Applications/Thingtime.app/Contents/MacOS/Thingtime',
		helperExecutable: '/Applications/Thingtime.app/Contents/Helpers/Thingtime Node.app/Contents/MacOS/ThingtimeNode',
		menuBarCustomIconPath: '/Users/test/Library/Application Support/Thingtime/thingtime-node/menu-bar-custom.png',
		menuBarIconId: 'wordmark-template',
		projectRegistryPath: '/Users/test/Library/Application Support/Thingtime/thingtime-node/projects.json',
		runtimePath: '/Applications/Thingtime.app/Contents/Resources/ai/thingtime-node-runtime.mjs'
	};
	const first = buildLaunchAgentPlist(input);
	const second = buildLaunchAgentPlist(input);

	assert.equal(first, second);
	assert.match(first, /Managed by Thingtime Electron/u);
	assert.match(first, /ThingtimeNode/u);
	assert.match(first, /thingtime-node-runtime\.mjs/u);
	assert.match(first, /ELECTRON_RUN_AS_NODE/u);
	assert.match(first, /ELECTRON_RUN_AS_NODE&quot;:&quot;1/u);
	assert.match(first, /NODE_NO_WARNINGS&quot;:&quot;1/u);
	assert.doesNotMatch(first, /ELECTRON_RUN_AS_NODE&quot;:&quot;0/u);
	assert.doesNotMatch(first, /NODE_NO_WARNINGS&quot;:&quot;0/u);
	assert.match(first, /A&amp;B/u);
	assert.match(first, /THINGTIME_NODE_PROJECT_REGISTRY_PATH/u);
	assert.match(first, /projects\.json/u);
	assert.match(first, /<key>THINGTIME_NODE_MACH_SERVICE<\/key>/u);
	assert.match(first, /<key>THINGTIME_NODE_CONNECTOR_ENV_JSON<\/key>/u);
	assert.match(first, /<key>THINGTIME_NODE_MENU_BAR_ICON<\/key>\s*<string>wordmark-template<\/string>/u);
	assert.match(first, /<key>THINGTIME_NODE_MENU_BAR_CUSTOM_ICON_PATH<\/key>/u);
	assert.match(first, /<key>KeepAlive<\/key>\s*<true\/>/u);
	assert.doesNotMatch(first, /SuccessfulExit/u);
	assert.doesNotMatch(first, /<string>THINGTIME_NODE_MACH_SERVICE<\/string>/u);
	assert.doesNotMatch(first, /OPENAI_API_KEY|ANTHROPIC_API_KEY/u);
});

test('launch agent rejects unknown or relative menu bar icon configuration', () => {
	const base = {
		apiBaseUrl: 'https://thingtime.com/',
		childEnvironment: {},
		electronExecutable: '/Applications/Thingtime.app/Contents/MacOS/Thingtime',
		helperExecutable: '/Applications/Thingtime.app/Contents/Helpers/Thingtime Node.app/Contents/MacOS/ThingtimeNode',
		runtimePath: '/Applications/Thingtime.app/Contents/Resources/ai/thingtime-node-runtime.mjs'
	};
	assert.throws(() => buildLaunchAgentPlist({ ...base, menuBarIconId: 'unknown' }), /menu bar icon/u);
	assert.throws(() => buildLaunchAgentPlist({ ...base, menuBarIconId: 'custom', menuBarCustomIconPath: 'relative.png' }), /absolute/u);
});

test('writes an atomic 0600 local project registry and returns only a public reference', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'thingtime-node-projects-'));
	const registryPath = path.join(root, 'userData', 'thingtime-node', 'projects.json');
	const projectPath = path.join(root, 'Empty Project');
	try {
		await mkdir(projectPath, { recursive: true });
		assert.deepEqual(await ensureLocalProjectRegistry(registryPath), { count: 0 });
		assert.equal((await stat(registryPath)).mode & 0o777, 0o600);

		const reference = await registerLocalProject(registryPath, projectPath);
		assert.match(reference.projectId, /^local-[a-f0-9]{32}$/u);
		assert.equal(reference.projectLabel, 'Empty Project');
		assert.equal(JSON.stringify(reference).includes(root), false);
		assert.deepEqual(JSON.parse(await readFile(registryPath, 'utf8')), {
			version: 1,
			projectPaths: [await realpath(projectPath)]
		});
		assert.equal((await stat(registryPath)).mode & 0o777, 0o600);

		await registerLocalProject(registryPath, projectPath);
		assert.equal(JSON.parse(await readFile(registryPath, 'utf8')).projectPaths.length, 1);

		const unusualProjectPath = path.join(root, '  Private\\Name\u2066  ');
		await mkdir(unusualProjectPath);
		const unusualReference = await registerLocalProject(registryPath, unusualProjectPath);
		assert.equal(unusualReference.projectLabel, 'Private Name');
		assert.doesNotMatch(unusualReference.projectLabel, /[\\/\p{Cc}\p{Cf}]/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('connector requests are allowlisted, bounded, and command-bound', () => {
	assert.deepEqual(validateConnectorRequest({ action: 'send', commandId: 'command-1', operation: 'session/read', payload: { sessionId: 's1' } }), {
		action: 'send',
		commandId: 'command-1',
		operation: 'session/read',
		payload: { sessionId: 's1' }
	});
	assert.throws(
		() => validateConnectorRequest({ action: 'send', commandId: 'command-1', operation: 'private/store/read', payload: {} }),
		/not allowed/u
	);
	assert.throws(() => validateConnectorRequest({ action: 'start' }), /commandId/u);
	assert.throws(
		() => validateConnectorRequest({ action: 'send', commandId: 'x', operation: 'session/send', payload: { text: 'x'.repeat(1_048_576) } }),
		/bridge limit/u
	);
});

test('device mutations require a command id and reject unsupported action kinds', () => {
	assert.deepEqual(validateDeviceRequest({ action: 'snapshot' }), { action: 'snapshot' });
	assert.deepEqual(
		validateDeviceRequest({
			action: 'execute',
			commandId: 'command-2',
			request: { kind: 'system.volume.set', parameters: { volume: 0.5 } }
		}),
		{
			action: 'execute',
			commandId: 'command-2',
			request: { kind: 'system.volume.set', parameters: { volume: 0.5 } }
		}
	);
	for (const [kind, parameters] of [
		['system.audio.mute.set', { muted: true }],
		['system.audio.input.volume.set', { level: 0.4 }],
		['system.audio.input.mute.set', { muted: true }],
		['system.audio.output.set', { deviceId: 'BuiltInOutputDevice' }],
		['system.audio.input.set', { deviceId: 'BuiltInInputDevice' }],
		['system.audio.sound-effects.volume.set', { level: 0.4 }],
		['system.audio.sound-effects.mute.set', { muted: true }],
		['system.audio.sound-effects-output.set', { deviceId: 'BuiltInOutputDevice' }],
		['application.hide', { bundleIdentifier: 'com.example.App' }],
		['application.unhide', { bundleIdentifier: 'com.example.App' }],
		['application.force-quit', { bundleIdentifier: 'com.example.App' }],
		['application.hide-others', {}],
		['system.sleep', {}],
		['system.wifi.connect', { ssid: 'Thingtime Guest' }],
		['system.wifi.disconnect', {}],
		['system.wifi.power.set', { enabled: false }]
	]) {
		assert.deepEqual(validateDeviceRequest({ action: 'execute', commandId: `command-${kind}`, request: { kind, parameters } }), {
			action: 'execute',
			commandId: `command-${kind}`,
			request: { kind, parameters }
		});
	}
	assert.throws(
		() => validateDeviceRequest({ action: 'execute', commandId: 'command-3', request: { kind: 'screen.capture', parameters: {} } }),
		/not allowed/u
	);
	assert.throws(
		() => validateDeviceRequest({ action: 'execute', request: { kind: 'application.launch', parameters: { bundleIdentifier: 'com.example.app' } } }),
		/commandId/u
	);
});

test('connector child environment uses an explicit non-secret allowlist', () => {
	assert.deepEqual(
		safeConnectorEnvironment({
			PATH: '/usr/bin',
			HOME: '/Users/test',
			CODEX_HOME: '/Users/test/.codex',
			OPENAI_API_KEY: 'do-not-copy',
			THINGTIME_TOKEN: 'do-not-copy'
		}),
		{ PATH: '/usr/bin', HOME: '/Users/test', CODEX_HOME: '/Users/test/.codex' }
	);
});

test('signature parser reads stable identifiers and team IDs', () => {
	assert.deepEqual(parseCodeSignatureDetails('Executable=/tmp/Thingtime\nIdentifier=com.thingtime.desktop\nTeamIdentifier=6DQQ9V7C84\n'), {
		authorities: [],
		hardenedRuntime: false,
		identifier: 'com.thingtime.desktop',
		runtimeVersion: null,
		teamIdentifier: '6DQQ9V7C84',
		timestamp: null
	});
});

test('status normalization does not claim a control-plane connection it cannot observe', () => {
	const value = normalizeNodeStatus(
		{
			connector: { state: 'running', processIdentifier: 42 },
			journalEntryCount: 3,
			pairing: { paired: true, deviceID: 'device-1', deviceIDs: ['device-1', 'device-2', 'device-2'] },
			recoverablePairing: true,
			permissions: { accessibility: 'granted', screenRecording: 'denied' },
			service: 'running'
		},
		{ label: 'com.thingtime.desktop.node', registered: true, state: 'enabled' },
		'0.1.0'
	);

	assert.equal(value.serviceStatus, 'running');
	assert.equal(value.pairingStatus, 'paired');
	assert.deepEqual(value.deviceIds, ['device-1', 'device-2']);
	assert.equal(value.pairedAccountCount, 2);
	assert.equal(value.recoverablePairing, true);
	assert.equal(value.transportStatus, 'unknown');
	assert.deepEqual(value.permissions, [
		{ kind: 'accessibility', status: 'authorized' },
		{ kind: 'screenRecording', status: 'denied' }
	]);
});

test('revalidates the native bridge signature before every execution', async () => {
	const fixture = await makeSignedNodeFixture();
	try {
		await fixture.integration.request('node.status');
		assert.equal(fixture.state.bridgeRuns, 1);

		await writeFile(fixture.bridgeExecutable, 'mutated after verification');
		await assert.rejects(fixture.integration.request('node.status'), (error) => error?.code === 'invalid_signature');
		assert.equal(fixture.state.bridgeRuns, 1);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('presence-gated pairing and permission requests allow bounded human confirmation time', async () => {
	const fixture = await makeSignedNodeFixture();
	try {
		await fixture.integration.request('node.status');
		await fixture.integration.request('pairing.claim', { pairingSecret: 'pair-secret' }, 'pair-1');
		await fixture.integration.request('pairing.resume', {}, 'pair-resume-1');
		await fixture.integration.request('pairing.unpair', {}, 'unpair-1');
		await fixture.integration.request('permissions.request', { kind: 'accessibility' }, 'permission-1');
		assert.deepEqual(fixture.state.bridgeTimeouts, [17_000, 562_000, 562_000, 142_000, 142_000]);
		assert.equal(nodeRequestTimeoutMs('node.status'), 17_000);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('revalidates helper identity immediately before launchd registration', async () => {
	const fixture = await makeSignedNodeFixture();
	try {
		fixture.state.replaceOnBootout = true;
		await assert.rejects(fixture.integration.registerService(), (error) => error?.code === 'invalid_installation');
		assert.equal(fixture.state.bootstrapCalls, 0);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('re-registers the managed node with only the private registry file path', async () => {
	const fixture = await makeSignedNodeFixture();
	try {
		const registryPath = path.join(fixture.root, 'userData', 'thingtime-node', 'projects.json');
		await fixture.integration.registerService({ projectRegistryPath: registryPath });
		assert.equal(fixture.state.bootstrapCalls, 1);
		assert.match(fixture.state.bootstrapPlists[0], /THINGTIME_NODE_PROJECT_REGISTRY_PATH/u);
		assert.match(fixture.state.bootstrapPlists[0], /projects\.json/u);
		assert.doesNotMatch(fixture.state.bootstrapPlists[0], /projectPaths|Empty Project/u);
		assert.equal(
			fixture.state.launchctlCalls.some(([operation]) => operation === 'kickstart'),
			false
		);
		assert.ok(
			fixture.state.launchctlCalls.findIndex(([operation]) => operation === 'enable') <
				fixture.state.launchctlCalls.findIndex(([operation]) => operation === 'bootstrap')
		);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('reconciles endpoint and menu icon changes without restarting an unchanged node', async () => {
	const fixture = await makeSignedNodeFixture();
	const options = {
		apiBaseUrl: 'https://pr-68.previews.dev.thingtime.com/',
		menuBarIconId: 'tree-color'
	};
	try {
		await fixture.integration.registerService(options);
		assert.equal(fixture.state.bootstrapCalls, 1);
		await fixture.integration.reconcileRegisteredService(options);
		assert.equal(fixture.state.bootstrapCalls, 1);
		await fixture.integration.reconcileRegisteredService({ ...options, menuBarIconId: 'tree-pink' });
		assert.equal(fixture.state.bootstrapCalls, 2);
		assert.match(fixture.state.bootstrapPlists[1], /THINGTIME_NODE_API_BASE_URL/u);
		assert.match(fixture.state.bootstrapPlists[1], /pr-68\.previews\.dev\.thingtime\.com/u);
		assert.match(fixture.state.bootstrapPlists[1], /tree-pink/u);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('app launch restarts an explicitly enabled managed node after its menu-bar Quit action', async () => {
	const fixture = await makeSignedNodeFixture();
	const options = {
		apiBaseUrl: 'https://pr-68.previews.dev.thingtime.com/',
		menuBarIconId: 'tree-pink'
	};
	try {
		await fixture.integration.reconcileRegisteredService(options, { startIfStopped: true });
		assert.equal(fixture.state.bootstrapCalls, 0, 'a never-enabled node must not be installed silently');
		await fixture.integration.registerService(options);
		assert.equal(fixture.state.bootstrapCalls, 1);

		// Native Quit performs launchctl bootout but deliberately preserves the
		// Electron-managed plist as proof that this node was explicitly enabled.
		fixture.state.serviceRegistered = false;
		await fixture.integration.reconcileRegisteredService(options, { startIfStopped: false });
		assert.equal(fixture.state.bootstrapCalls, 1);
		assert.equal(fixture.state.serviceRegistered, false);

		await fixture.integration.reconcileRegisteredService(options, { startIfStopped: true });
		assert.equal(fixture.state.bootstrapCalls, 2);
		assert.equal(fixture.state.serviceRegistered, true);
		assert.match(fixture.state.bootstrapPlists[1], /Managed by Thingtime Electron/u);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('packaging verification rejects a different native bridge leaf certificate', async () => {
	const fixture = await makeSignedNodeFixture();
	try {
		fixture.state.certificateByTarget.set(fixture.bridgeExecutable, 'different leaf certificate');
		await assert.rejects(
			verifySignedArtifacts(fixture.paths, fixture.runner, { mode: 'local' }),
			(error) => error?.code === 'invalid_signature' && /same leaf certificate/u.test(error.message)
		);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('packaging verification extracts leaf certificates with the macOS equals-form option', async () => {
	const fixture = await makeSignedNodeFixture();
	try {
		assert.deepEqual(await verifySignedArtifacts(fixture.paths, fixture.runner, { mode: 'local' }), {
			identityClass: 'local',
			teamIdentifier: '6DQQ9V7C84'
		});
		assert.equal(fixture.state.certificateExtractionArguments.length, 2);
		for (const args of fixture.state.certificateExtractionArguments) {
			assert.equal(args.includes('--extract-certificates'), false);
			assert.match(args.find((argument) => argument.startsWith('--extract-certificates=')) || '', /^--extract-certificates=\/.*\/certificate-$/u);
		}
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('registration refuses to overwrite a foreign LaunchAgent before bootout', async () => {
	const fixture = await makeSignedNodeFixture();
	try {
		await mkdir(path.dirname(fixture.paths.launchAgentPath), { recursive: true });
		await writeFile(fixture.paths.launchAgentPath, '<plist><dict><key>Label</key><string>com.thingtime.desktop.node</string></dict></plist>');
		await assert.rejects(fixture.integration.registerService(), (error) => error?.code === 'login_item_conflict');
		assert.equal(fixture.state.bootoutCalls, 0);
		assert.equal(fixture.state.bootstrapCalls, 0);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test('failed registration restores the prior managed plist and running service', async () => {
	const fixture = await makeSignedNodeFixture();
	try {
		const previousPlist = buildLaunchAgentPlist({
			apiBaseUrl: 'https://previous.example/',
			childEnvironment: { HOME: '/Users/test', PATH: '/usr/bin' },
			electronExecutable: fixture.paths.electronExecutable,
			helperExecutable: fixture.paths.helperExecutable,
			runtimePath: fixture.paths.runtimePath
		});
		await mkdir(path.dirname(fixture.paths.launchAgentPath), { recursive: true });
		await writeFile(fixture.paths.launchAgentPath, previousPlist);
		fixture.state.serviceRegistered = true;
		fixture.state.failBootstrapCount = 1;

		await assert.rejects(fixture.integration.registerService(), (error) => error?.code === 'login_item_failed');
		assert.equal(await readFile(fixture.paths.launchAgentPath, 'utf8'), previousPlist);
		assert.equal(fixture.state.bootstrapCalls, 2);
		assert.equal(fixture.state.serviceRegistered, true);
		assert.notEqual(fixture.state.bootstrapPlists[0], previousPlist);
		assert.equal(fixture.state.bootstrapPlists[1], previousPlist);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});
