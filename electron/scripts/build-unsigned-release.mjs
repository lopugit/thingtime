import { access, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createPinnedPnpmEnvironment } from './pinned-package-manager.mjs';

const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBuilder = path.join(electronDir, 'node_modules', '.bin', 'electron-builder');
const packageManager = JSON.parse(await readFile(path.join(electronDir, 'package.json'), 'utf8')).packageManager;
const releaseVersion = String(process.env.THINGTIME_ELECTRON_RELEASE_VERSION || '').trim();

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

if (process.platform !== 'darwin') throw new Error('Thingtime unsigned release artifacts can only be built on macOS.');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(releaseVersion) || !releaseVersion.endsWith('.unsigned')) {
    throw new Error('THINGTIME_ELECTRON_RELEASE_VERSION must be SemVer ending in .unsigned for an unsigned release.');
}

const unsignedEnvironment = {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    CSC_NAME: '-',
    THINGTIME_ELECTRON_SIGNING_IDENTITY: '',
    THINGTIME_NODE_SIGNING_IDENTITY: '',
    THINGTIME_NODE_SIGNING_MODE: 'unsigned'
};
const pinnedPnpm = await createPinnedPnpmEnvironment(packageManager, unsignedEnvironment);
try {
    run('corepack', [packageManager, 'run', 'build:resources'], { env: pinnedPnpm.environment });
    await rm(path.join(electronDir, 'release'), { force: true, recursive: true });
    run(
        electronBuilder,
        [
            '--mac',
            '--publish', 'never',
            '--config.forceCodeSigning=true',
            ...(process.env.THINGTIME_ELECTRON_BUILD_NUMBER ? [`--config.buildVersion=${process.env.THINGTIME_ELECTRON_BUILD_NUMBER}`] : []),
            '--config.mac.identity=-',
            '--config.mac.notarize=false',
			'--config.mac.entitlements=build/entitlements.unsigned.mac.plist',
			'--config.mac.entitlementsInherit=build/entitlements.unsigned.mac.inherit.plist',
            `--config.extraMetadata.version=${releaseVersion}`
        ],
        { env: pinnedPnpm.environment }
    );
} finally {
    await pinnedPnpm.dispose();
}

const appPath = await findBuiltApp();
if (!appPath) throw new Error('electron-builder did not retain an unpacked unsigned Thingtime.app for verification.');
run(process.execPath, [path.join(electronDir, 'scripts', 'verify-unsigned-app.mjs'), appPath], { env: unsignedEnvironment });
const archives = await findReleaseArchives();
if (!archives.length) throw new Error('electron-builder did not produce an unsigned Thingtime ZIP for publication.');
for (const archive of archives) {
    run(process.execPath, [path.join(electronDir, 'scripts', 'verify-unsigned-release-archive.mjs'), archive], { env: unsignedEnvironment });
}
console.log(`Unsigned Thingtime app verified at ${appPath}`);
console.log(`Unsigned Thingtime updater ZIPs verified: ${archives.join(', ')}`);
