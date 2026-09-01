import { access, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createPinnedPnpmEnvironment } from './pinned-package-manager.mjs';

const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBuilder = path.join(electronDir, 'node_modules', '.bin', 'electron-builder');
const packageManager = JSON.parse(await readFile(path.join(electronDir, 'package.json'), 'utf8')).packageManager;

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd || electronDir,
		env: options.env || process.env,
		stdio: options.stdio || 'inherit',
		encoding: options.encoding
	});
	if (result.error || result.status !== 0) {
		const detail = result.error ? result.error.message : `exit ${result.status}`;
		throw new Error(`${command} failed (${detail}).`);
	}
	return result;
}

function resolveAppleDevelopmentIdentity() {
	const requested = process.env.THINGTIME_ELECTRON_SIGNING_IDENTITY || '';
	const result = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
	const identities = [...result.stdout.matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
	const identity = requested || identities.find((value) => value.startsWith('Apple Development:'));
	if (!identity || !identity.startsWith('Apple Development:') || !identities.includes(identity)) {
		throw new Error('A valid Apple Development identity is required for the local TCC-stable Thingtime build.');
	}
	return identity;
}

async function builtAppPath() {
	const releaseRoot = path.join(electronDir, 'release');
	const candidates = [];
	for (const entry of await readdir(releaseRoot, { withFileTypes: true })) {
		if (entry.isDirectory() && entry.name.startsWith('mac')) {
			candidates.push(path.join(releaseRoot, entry.name, 'Thingtime.app'));
		}
	}
	for (const candidate of candidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Keep checking architecture-specific Electron output directories.
		}
	}
	return null;
}

if (process.platform !== 'darwin') throw new Error('The signed local Electron app can only be built on macOS.');

const identity = resolveAppleDevelopmentIdentity();
const signingEnvironment = {
	...process.env,
	CSC_IDENTITY_AUTO_DISCOVERY: 'true',
	CSC_NAME: identity,
	THINGTIME_NODE_SIGNING_IDENTITY: identity
};

const pinnedPnpm = await createPinnedPnpmEnvironment(packageManager, signingEnvironment);
try {
	run('corepack', [packageManager, 'run', 'build:resources'], { env: pinnedPnpm.environment });
	await rm(path.join(electronDir, 'release'), { force: true, recursive: true });
	run(electronBuilder, ['--dir', '--mac', '--config.forceCodeSigning=true', `--config.mac.identity=${identity}`, '--config.mac.notarize=false'], {
		env: pinnedPnpm.environment
	});
} finally {
	await pinnedPnpm.dispose();
}

const appPath = await builtAppPath();
if (!appPath) throw new Error('electron-builder did not produce an unpacked Thingtime.app.');
run(process.execPath, [path.join(electronDir, 'scripts', 'verify-signed-app.mjs'), '--mode', 'local', appPath], {
	env: signingEnvironment
});
console.log(`Signed local app built at ${appPath}`);
