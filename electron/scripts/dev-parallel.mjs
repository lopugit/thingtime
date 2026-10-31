import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimWorkspace, developmentEnvironment, prepareWorkspace, retainedWorkspace, stopWorkspace, workspaceEnvironment } from './dev-workspace.mjs';

const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { stopOwnedProcessGroup } = require('../lib/local-runtime.cjs');
if (process.platform === 'win32') throw new Error('Parallel desktop development currently requires POSIX process groups.');
const stagedWebDir = path.join(electronDir, 'dist', 'web');
const stagedAiDir = path.join(electronDir, 'dist', 'ai');
const workspaceArg = process.argv.find(value => value.startsWith('--workspace='));
const workspace = workspaceArg ? retainedWorkspace(workspaceArg.slice('--workspace='.length)) : null;
if (process.argv.includes('--prepare-only') && !workspace) throw new Error('--prepare-only requires a named --workspace.');
if (process.argv.includes('--stop-workspace')) {
	if (!workspace) throw new Error('--stop-workspace requires a named --workspace.');
	await stopWorkspace(workspace);
	console.log(`Stopped owned development processes; retained state: ${workspace.root}`);
	process.exit(0);
}
const electronExecutable = workspace && process.argv.includes('--use-staged') && !process.argv.includes('--prepare-only')
	? path.join(workspace.runtime, 'Contents/MacOS/Electron') : require('electron');

function runScript(name) {
	const result = spawnSync(process.execPath, [path.join(electronDir, 'scripts', name)], {
		cwd: electronDir,
		env: process.env,
		stdio: 'inherit'
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${name} failed with exit code ${result.status ?? 'unknown'}`);
}

const inspectorArg = process.argv.find(value => value.startsWith('--inspect-ui='));
const inspectorPort = inspectorArg ? Number(inspectorArg.slice('--inspect-ui='.length)) : workspace?.inspectorPort;
if (inspectorArg && (!Number.isSafeInteger(inspectorPort) || inspectorPort < 1024 || inspectorPort > 65535)) throw new Error('Choose an unused nonprivileged UI inspection port.');
const launchArgs = [workspace?.source || '.', ...(inspectorPort ? [`--remote-debugging-port=${inspectorPort}`, '--remote-debugging-address=127.0.0.1'] : [])];

let profilePath;
let processesStopped = true;
let releaseWorkspace;
try {
	if (workspace) releaseWorkspace = await claimWorkspace(workspace);
	if (!process.argv.includes('--use-staged')) runScript('build-web.mjs');
	runScript('verify-web-build.mjs');
	if (workspace && (!process.argv.includes('--use-staged') || process.argv.includes('--prepare-only'))) await prepareWorkspace(workspace, electronDir, electronExecutable);
	if (process.argv.includes('--prepare-only')) {
		console.log(`Retained development app ready: ${workspace.app}`);
	} else {
	profilePath = workspace?.profile || await mkdtemp(path.join(os.tmpdir(), 'thingtime-desktop-dev-'));
	console.log(`Starting unsigned Thingtime Dev with isolated profile ${profilePath}`);
	let requestedRestart = false;
	let stopping = false;
	let child;
	let escalationTimer;
	let groupCleanup;
	const cleanup = () => (groupCleanup ||= workspace ? stopWorkspace(workspace) : stopOwnedProcessGroup(child?.pid));
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
			child = spawn(workspace ? path.join(workspace.runtime, 'Contents/MacOS/Electron') : electronExecutable, launchArgs, {
				cwd: workspace?.source || electronDir,
				detached: true,
				env: {
					...(workspace ? developmentEnvironment() : process.env),
					...(workspace ? await workspaceEnvironment(workspace) : {}),
					THINGTIME_DESKTOP_PARALLEL_DEV: '1',
					...(workspace ? { THINGTIME_DESKTOP_DEV_NAME: `Thingtime Dev ${workspace.name}` } : {}),
					THINGTIME_DESKTOP_DEV_PROFILE: profilePath,
					THINGTIME_NODE_ALLOW_DEV_REGISTRATION: '0'
				},
				// Local console email can contain synthetic verification links.
				// Retained development logs keep diagnostics, never that content.
				stdio: workspace ? ['ignore', 'ignore', 'inherit', 'ipc'] : ['inherit', 'inherit', 'inherit', 'ipc']
			});
			processesStopped = false;
			if (workspace) await releaseWorkspace.recordChild(child.pid);
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
				if (workspace) await releaseWorkspace.recordChild(null);
			}
			if (result.code !== 0 && result.signal !== 'SIGINT' && result.signal !== 'SIGTERM')
				throw new Error(`Thingtime Dev exited with ${result.signal || result.code}`);
		} while (requestedRestart && !stopping);
	} finally {
		process.off('SIGINT', forwardSignal);
		process.off('SIGTERM', forwardSignal);
		clearTimeout(escalationTimer);
	}
	}
} finally {
	if (!processesStopped) {
		console.error(`Preserved development profile and bundles because process shutdown was not verified: ${profilePath}`);
	} else if (workspace) {
		console.log(`Retained development app, profile and resources: ${workspace.root}`);
	} else {
		if (profilePath) await rm(profilePath, { force: true, recursive: true });
		await rm(stagedWebDir, { force: true, recursive: true });
		await rm(stagedAiDir, { force: true, recursive: true });
		await rm(path.join(electronDir, 'dist', 'mail'), { force: true, recursive: true });
		await rm(path.join(electronDir, 'dist', 'database'), { force: true, recursive: true });
		console.log('Removed the Thingtime Dev profile and staged web/AI bundles.');
	}
	if (processesStopped) await releaseWorkspace?.();
}
