import { access, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createPinnedPnpmEnvironment } from './pinned-package-manager.mjs';

const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBuilder = path.join(electronDir, 'node_modules', '.bin', 'electron-builder');
const packageManager = JSON.parse(await readFile(path.join(electronDir, 'package.json'), 'utf8')).packageManager;
const releaseVersion = String(process.env.THINGTIME_ELECTRON_RELEASE_VERSION || '').trim();

if (releaseVersion && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(releaseVersion)) {
	throw new Error('THINGTIME_ELECTRON_RELEASE_VERSION must be a SemVer version.');
}

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

function developerIdIdentity() {
	const result = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
	const identities = [...result.stdout.matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
	const requested = process.env.THINGTIME_ELECTRON_SIGNING_IDENTITY || process.env.CSC_NAME || '';
	const identity = requested || identities.find((value) => value.startsWith('Developer ID Application:'));
	if (!identity || !identity.startsWith('Developer ID Application:') || !identities.includes(identity)) {
		throw new Error(
			'Production release is blocked: import a Developer ID Application identity into the build keychain and set THINGTIME_ELECTRON_SIGNING_IDENTITY.'
		);
	}
	return identity;
}

function requireNotarizationCredentials() {
	const hasApiKey = process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER;
	const hasAppleId = process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID;
	const hasKeychainProfile = process.env.APPLE_KEYCHAIN_PROFILE;
	if (!hasApiKey && !hasAppleId && !hasKeychainProfile) {
		throw new Error(
			'Production release is blocked: configure a complete electron-builder notarization credential set; unsigned or unstapled release assets are not permitted.'
		);
	}
}

async function findBuiltApp() {
	const releaseRoot = path.join(electronDir, 'release');
	for (const entry of await readdir(releaseRoot, { withFileTypes: true })) {
		if (!entry.isDirectory() || !entry.name.startsWith('mac')) continue;
		const candidate = path.join(releaseRoot, entry.name, 'Thingtime.app');
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Keep checking architecture-specific Electron output directories.
		}
	}
	return null;
}

async function findReleaseArchives() {
	const releaseRoot = path.join(electronDir, 'release');
	return (await readdir(releaseRoot, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.zip'))
		.map((entry) => path.join(releaseRoot, entry.name))
		.sort((left, right) => left.localeCompare(right));
}

if (process.platform !== 'darwin') throw new Error('Thingtime production artifacts can only be built on macOS.');

const identity = developerIdIdentity();
requireNotarizationCredentials();
const releaseEnvironment = {
	...process.env,
	CSC_IDENTITY_AUTO_DISCOVERY: 'true',
	CSC_NAME: identity,
	THINGTIME_NODE_SIGNING_IDENTITY: identity
};

const pinnedPnpm = await createPinnedPnpmEnvironment(packageManager, releaseEnvironment);
try {
	run('corepack', [packageManager, 'run', 'build:resources'], { env: pinnedPnpm.environment });
	await rm(path.join(electronDir, 'release'), { force: true, recursive: true });
	run(
		electronBuilder,
		[
			'--mac',
			'--publish',
			'never',
			'--config.forceCodeSigning=true',
			`--config.mac.identity=${identity}`,
			'--config.mac.notarize=true',
			...(releaseVersion ? [`--config.extraMetadata.version=${releaseVersion}`] : [])
		],
		{ env: pinnedPnpm.environment }
	);
} finally {
	await pinnedPnpm.dispose();
}

const appPath = await findBuiltApp();
if (!appPath) throw new Error('electron-builder did not retain an unpacked Thingtime.app for verification.');
run(process.execPath, [path.join(electronDir, 'scripts', 'verify-signed-app.mjs'), '--mode', 'production', appPath], {
	env: releaseEnvironment
});
const archives = await findReleaseArchives();
if (!archives.length) throw new Error('electron-builder did not produce an updater-compatible Thingtime ZIP for publication.');
for (const archive of archives) {
	run(process.execPath, [path.join(electronDir, 'scripts', 'verify-release-archive.mjs'), '--mode', 'production', archive], {
		env: releaseEnvironment
	});
}
console.log(`Developer ID signed and notarized app verified at ${appPath}`);
console.log(`Developer ID signed and notarized updater ZIPs verified: ${archives.join(', ')}`);
