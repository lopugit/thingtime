import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { parseCodeSignatureDetails, verifySignedArtifacts } = require('../lib/thingtime-node-bridge.cjs');
const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function findBuiltApp() {
	const releaseRoot = path.join(electronDir, 'release');
	const candidates = [];
	for (const entry of await readdir(releaseRoot, { withFileTypes: true })) {
		if (!entry.isDirectory() || !entry.name.startsWith('mac')) continue;
		const candidate = path.join(releaseRoot, entry.name, 'Thingtime.app');
		try {
			await access(candidate);
			candidates.push(candidate);
		} catch {
			// Ignore Electron output directories that do not contain an unpacked app.
		}
	}
	if (candidates.length !== 1) {
		throw new Error(`Expected one unpacked Thingtime.app, found ${candidates.length}. Pass its path explicitly.`);
	}
	return candidates[0];
}

function parseArguments(values) {
	let appArgument = null;
	let mode = 'local';
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		if (value === '--mode') {
			mode = values[index + 1] || '';
			index += 1;
			continue;
		}
		if (value.startsWith('--') || appArgument) {
			throw new Error('Usage: verify-signed-app.mjs [--mode local|production|runtime] [Thingtime.app]');
		}
		appArgument = value;
	}
	if (!['local', 'production', 'runtime'].includes(mode)) {
		throw new Error('Signature verification mode must be local, production, or runtime.');
	}
	return { appArgument, mode };
}

function run(command, args, label) {
	const result = spawnSync(command, args, { encoding: 'utf8' });
	if (result.error || result.status !== 0) {
		const detail = result.error ? result.error.message : (result.stderr || result.stdout || `exit ${result.status}`).trim();
		throw new Error(`${label} failed: ${detail}`);
	}
	return `${result.stdout || ''}\n${result.stderr || ''}`;
}

const { appArgument, mode } = parseArguments(process.argv.slice(2));
const appPath = appArgument ? path.resolve(appArgument) : await findBuiltApp();
const helperApp = path.join(appPath, 'Contents', 'Helpers', 'Thingtime Node.app');
const helperExecutable = path.join(helperApp, 'Contents', 'MacOS', 'ThingtimeNode');
const bridgeExecutable = path.join(helperApp, 'Contents', 'MacOS', 'ThingtimeNodeBridge');
const runtimePath = path.join(appPath, 'Contents', 'Resources', 'ai', 'thingtime-node-runtime.mjs');

await access(path.join(appPath, 'Contents', 'MacOS', 'Thingtime'));
const signature = await verifySignedArtifacts({
	bridgeExecutable,
	helperApp,
	helperExecutable,
	outerApp: appPath,
	runtimePath
}, undefined, { mode });

const desktopDisplay = run('/usr/bin/codesign', ['--display', '--verbose=4', appPath], 'Thingtime signing detail check');
const desktop = parseCodeSignatureDetails(desktopDisplay);
const desktopRequirement = run('/usr/bin/codesign', ['--display', '--requirements', '-', appPath], 'Thingtime designated-requirement check');
const nodeRequirement = run('/usr/bin/codesign', ['--display', '--requirements', '-', helperApp], 'Thingtime Node designated-requirement check');
if (!desktopRequirement.includes('identifier "com.thingtime.desktop"') || !nodeRequirement.includes('identifier "com.thingtime.desktop.node"')) {
	throw new Error('Signed app designated requirements do not preserve the stable bundle identifiers.');
}
if (mode === 'production') {
	run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', appPath], 'Thingtime Gatekeeper assessment');
	run('/usr/bin/xcrun', ['stapler', 'validate', appPath], 'Thingtime notarization staple validation');
}

console.log(`Verified ${appPath}`);
console.log(`Identifier: ${desktop.identifier}`);
console.log(`SignatureMode: ${signature.identityClass}`);
console.log(`TeamIdentifier: ${signature.teamIdentifier}`);
