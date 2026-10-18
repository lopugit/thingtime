import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electronExecutable = require('electron');
const { stopOwnedProcessGroup } = require('../lib/local-runtime.cjs');
if (process.platform === 'win32') throw new Error('Parallel desktop development currently requires POSIX process groups.');
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
let processesStopped = true;
try {
	runScript('build-web.mjs');
	runScript('verify-web-build.mjs');
	profilePath = await mkdtemp(path.join(os.tmpdir(), 'thingtime-desktop-dev-'));
	console.log(`Starting unsigned Thingtime Dev with isolated profile ${profilePath}`);
	let requestedRestart = false;
	let stopping = false;
	let child;
	let escalationTimer;
	let groupCleanup;
	const cleanup = () => (groupCleanup ||= stopOwnedProcessGroup(child?.pid));
	const forwardSignal = () => {
		stopping = true;
		// Give Electron's before-quit hook time to release the DB authority and
		// stop MongoDB. Never terminate the database group at the first signal.
		child?.kill('SIGTERM');
		if (!escalationTimer)
			escalationTimer = setTimeout(() => {
				void cleanup().catch(() => {});
			}, 15000);
	};
	process.on('SIGINT', forwardSignal);
	process.on('SIGTERM', forwardSignal);
	try {
		do {
			if (stopping) break;
			requestedRestart = false;
			groupCleanup = null;
			child = spawn(electronExecutable, ['.'], {
				cwd: electronDir,
				detached: true,
				env: {
					...process.env,
					THINGTIME_DESKTOP_PARALLEL_DEV: '1',
					THINGTIME_DESKTOP_DEV_PROFILE: profilePath,
					THINGTIME_NODE_ALLOW_DEV_REGISTRATION: '0'
				},
				stdio: ['inherit', 'inherit', 'inherit', 'ipc']
			});
			processesStopped = false;
			child.on('message', (message) => {
				if (message?.type === 'thingtime-dev-restart') requestedRestart = true;
			});
			let result;
			try {
				result = await new Promise((resolve, reject) => {
					child.once('error', reject);
					child.once('exit', (code, signal) => resolve({ code, signal }));
				});
			} finally {
				clearTimeout(escalationTimer);
				escalationTimer = null;
				await cleanup();
				processesStopped = true;
			}
			if (result.code !== 0 && result.signal !== 'SIGINT' && result.signal !== 'SIGTERM')
				throw new Error(`Thingtime Dev exited with ${result.signal || result.code}`);
		} while (requestedRestart && !stopping);
	} finally {
		process.off('SIGINT', forwardSignal);
		process.off('SIGTERM', forwardSignal);
		clearTimeout(escalationTimer);
	}
} finally {
	if (!processesStopped) {
		console.error(`Preserved development profile and bundles because process shutdown was not verified: ${profilePath}`);
	} else {
		if (profilePath) await rm(profilePath, { force: true, recursive: true });
		await rm(stagedWebDir, { force: true, recursive: true });
		await rm(stagedAiDir, { force: true, recursive: true });
		await rm(path.join(electronDir, 'dist', 'mail'), { force: true, recursive: true });
		await rm(path.join(electronDir, 'dist', 'database'), { force: true, recursive: true });
		console.log('Removed the Thingtime Dev profile and staged web/AI bundles.');
	}
}
