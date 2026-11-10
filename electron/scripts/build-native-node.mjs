import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(electronDir, '..');
const packageRoot = path.join(repoRoot, 'macos', 'ThingtimeNode');
const buildScript = path.join(packageRoot, 'scripts', 'build-bundle.sh');
const cacheRoot = process.env.THINGTIME_NODE_CACHE_ROOT || path.join(homedir(), 'Library', 'Caches', 'com.thingtime.desktop.node');
const sourceApp = path.join(cacheRoot, 'bundle-stage', 'Thingtime Node.app');
const stagedRoot = path.join(electronDir, 'dist', 'native');
const stagedApp = path.join(stagedRoot, 'Thingtime Node.app');
const signingMode = String(process.env.THINGTIME_NODE_SIGNING_MODE || 'signed').trim();

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd || repoRoot,
		env: options.env || process.env,
		stdio: 'inherit'
	});
	if (result.error || result.status !== 0) {
		const detail = result.error ? result.error.message : `exit ${result.status}`;
		throw new Error(`${command} failed (${detail}).`);
	}
}

if (process.platform !== 'darwin') {
	throw new Error('Thingtime Node can only be built on macOS.');
}

const baseVersion = process.env.THINGTIME_ELECTRON_BASE_VERSION || '0.1.0';
const buildNumber = process.env.THINGTIME_ELECTRON_BUILD_NUMBER || '1';
if (!/^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z]+)*$/u.test(baseVersion)) {
	throw new Error('THINGTIME_ELECTRON_BASE_VERSION is not a valid bundle version.');
}
if (!/^\d+$/u.test(buildNumber)) {
	throw new Error('THINGTIME_ELECTRON_BUILD_NUMBER must be numeric.');
}
if (!['signed', 'unsigned'].includes(signingMode)) {
	throw new Error('THINGTIME_NODE_SIGNING_MODE must be signed or unsigned.');
}

run(buildScript, [], {
	cwd: packageRoot,
	env: {
		...process.env,
		THINGTIME_NODE_EMBEDDED: '1',
		THINGTIME_NODE_BUILD_NUMBER: buildNumber,
		THINGTIME_NODE_CACHE_ROOT: cacheRoot,
		THINGTIME_NODE_SIGNING_MODE: signingMode,
		THINGTIME_NODE_VERSION: baseVersion
	}
});

await rm(stagedRoot, { force: true, recursive: true });
await mkdir(stagedRoot, { recursive: true });
run('/usr/bin/ditto', ['--rsrc', '--extattr', sourceApp, stagedApp]);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', stagedApp]);

await writeFile(
	path.join(stagedRoot, 'manifest.json'),
	`${JSON.stringify(
		{
			app: 'Thingtime Node.app',
			bridgeBundleIdentifier: 'com.thingtime.desktop.node.bridge',
			bundleIdentifier: 'com.thingtime.desktop.node',
			buildNumber,
			loginRegistration: 'electron-authoritative',
			runtime: '../ai/thingtime-node-runtime.mjs',
			signingMode,
			version: baseVersion
		},
		null,
		2
	)}\n`
);

console.log(`Thingtime Node staged at ${path.relative(repoRoot, stagedApp)}`);
