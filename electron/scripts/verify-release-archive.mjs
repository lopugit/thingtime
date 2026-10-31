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

function parseArguments(values) {
	let archiveArgument = null;
	let mode = 'production';
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		if (value === '--mode') {
			mode = values[index + 1] || '';
			index += 1;
			continue;
		}
		if (value.startsWith('--') || archiveArgument) {
			throw new Error('Usage: verify-release-archive.mjs [--mode local|production|runtime] <Thingtime ZIP>');
		}
		archiveArgument = value;
	}
	if (!archiveArgument || !['local', 'production', 'runtime'].includes(mode)) {
		throw new Error('Usage: verify-release-archive.mjs [--mode local|production|runtime] <Thingtime ZIP>');
	}
	return { archiveArgument, mode };
}

async function extractedApp(stagingRoot) {
	const apps = (await readdir(stagingRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory() && entry.name === 'Thingtime.app')
		.map((entry) => path.join(stagingRoot, entry.name));
	if (apps.length !== 1) throw new Error(`Release archive must contain exactly one top-level Thingtime.app, found ${apps.length}.`);
	return apps[0];
}

const { archiveArgument, mode } = parseArguments(process.argv.slice(2));
const archivePath = path.resolve(archiveArgument);
const archive = await lstat(archivePath);
if (!archive.isFile() || archive.isSymbolicLink() || !archivePath.toLowerCase().endsWith('.zip')) {
	throw new Error('Release archive must be a regular Thingtime macOS ZIP file.');
}

const stagingRoot = await mkdtemp(path.join(os.tmpdir(), 'thingtime-release-verify-'));
try {
	run('/usr/bin/ditto', ['-x', '-k', archivePath, stagingRoot], 'Thingtime release archive extraction');
	const appPath = await extractedApp(stagingRoot);
	run(process.execPath, [path.join(electronDir, 'scripts', 'verify-signed-app.mjs'), '--mode', mode, appPath], 'Thingtime release archive verification');
	console.log(`Verified release archive ${archivePath}`);
} finally {
	await rm(stagingRoot, { force: true, recursive: true });
}
