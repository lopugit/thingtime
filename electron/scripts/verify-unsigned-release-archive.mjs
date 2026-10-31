import { lstat, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, label) {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.error || result.status !== 0) {
        const detail = result.error ? result.error.message : (result.stderr || result.stdout || `exit ${result.status}`).trim();
        throw new Error(`${label} failed: ${detail}`);
    }
}

const archiveArgument = process.argv[2];
if (!archiveArgument || process.argv.length !== 3) {
    throw new Error('Usage: verify-unsigned-release-archive.mjs <Thingtime ZIP>');
}
const archivePath = path.resolve(archiveArgument);
const archive = await lstat(archivePath);
if (!archive.isFile() || archive.isSymbolicLink() || !archivePath.toLowerCase().endsWith('.zip')) {
    throw new Error('Unsigned release archive must be a regular Thingtime macOS ZIP file.');
}

const stagingRoot = await mkdtemp(path.join(os.tmpdir(), 'thingtime-unsigned-release-verify-'));
try {
    run('/usr/bin/ditto', ['-x', '-k', archivePath, stagingRoot], 'Unsigned Thingtime release archive extraction');
    const apps = (await readdir(stagingRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name === 'Thingtime.app')
        .map((entry) => path.join(stagingRoot, entry.name));
    if (apps.length !== 1) throw new Error(`Unsigned release archive must contain exactly one top-level Thingtime.app, found ${apps.length}.`);
    run(process.execPath, [path.join(electronDir, 'scripts', 'verify-unsigned-app.mjs'), apps[0]], 'Unsigned Thingtime release archive verification');
    console.log(`Verified unsigned release archive ${archivePath}`);
} finally {
    await rm(stagingRoot, { force: true, recursive: true });
}
