import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electronExecutable = require('electron');
const stagedWebDir = path.join(electronDir, 'dist', 'web');
const stagedAiDir = path.join(electronDir, 'dist', 'ai');

function runScript(name) {
	const result = spawnSync(process.execPath, [path.join(electronDir, 'scripts', name)], {
		cwd: electronDir,
		env: process.env,
		stdio: 'inherit'
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${name} failed with exit code ${result.status ?? 'unknown'}`);
}

let profilePath;
try {
	runScript('build-web.mjs');
	runScript('verify-web-build.mjs');
	profilePath = await mkdtemp(path.join(os.tmpdir(), 'thingtime-desktop-dev-'));
	console.log(`Starting unsigned Thingtime Dev with isolated profile ${profilePath}`);
	const child = spawn(electronExecutable, ['.'], {
		cwd: electronDir,
		env: {
			...process.env,
			THINGTIME_DESKTOP_PARALLEL_DEV: '1',
			THINGTIME_DESKTOP_DEV_PROFILE: profilePath,
			THINGTIME_NODE_ALLOW_DEV_REGISTRATION: '0'
		},
		stdio: 'inherit'
	});
	const forwardSignal = (signal) => child.kill(signal);
	process.on('SIGINT', forwardSignal);
	process.on('SIGTERM', forwardSignal);
	const result = await new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => resolve({ code, signal }));
	});
	process.off('SIGINT', forwardSignal);
	process.off('SIGTERM', forwardSignal);
	if (result.code !== 0 && result.signal !== 'SIGINT' && result.signal !== 'SIGTERM') {
		throw new Error(`Thingtime Dev exited with ${result.signal || result.code}`);
	}
} finally {
	if (profilePath) await rm(profilePath, { force: true, recursive: true });
	await rm(stagedWebDir, { force: true, recursive: true });
	await rm(stagedAiDir, { force: true, recursive: true });
	console.log('Removed the Thingtime Dev profile and staged web/AI bundles.');
}
