import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { installLocalApp } from './install-local-app.mjs';

const appName = 'Thingtime.app';
const verifyScript = new URL('./verify-signed-app.mjs', import.meta.url).pathname;

function fail(message) {
	throw new Error(message);
}

function parseArguments(values) {
	if (values.length !== 1) fail('Usage: install-cached-release.mjs <update-plan.json>');
	return resolve(values[0]);
}

function readPlan(planPath) {
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(planPath, 'utf8'));
	} catch {
		fail('Thingtime update plan is unreadable.');
	}
	if (!parsed || parsed.format !== 1 || !['install', 'launch'].includes(parsed.action) || !Number.isSafeInteger(parsed.waitForPid) || parsed.waitForPid <= 1) {
		fail('Thingtime update plan is invalid.');
	}
	if (typeof parsed.cacheRoot !== 'string' || typeof parsed.sourceApp !== 'string' || typeof parsed.targetDir !== 'string') fail('Thingtime update plan is invalid.');
	const cacheRoot = resolve(parsed.cacheRoot);
	const sourceApp = resolve(parsed.sourceApp);
	const targetDir = resolve(parsed.targetDir);
	if (
		!sourceApp.startsWith(`${cacheRoot}/bundles/`) ||
		!sourceApp.endsWith(`/${appName}`) ||
		targetDir !== resolve(homedir(), 'Applications') ||
		!existsSync(sourceApp)
	) fail('Thingtime update source is invalid.');
	return { action: parsed.action, sourceApp, targetDir, waitForPid: parsed.waitForPid };
}

function processExists(pid) {
	const result = spawnSync('/bin/kill', ['-0', String(pid)], { stdio: 'ignore' });
	return result.status === 0;
}

async function waitForExit(pid) {
	const deadline = Date.now() + 60_000;
	while (processExists(pid)) {
		if (Date.now() >= deadline) fail('Thingtime did not quit within one minute; the installed app was left unchanged.');
		await new Promise((resolveWait) => setTimeout(resolveWait, 250));
	}
}

export function verifyCachedReleaseSource(sourceApp, runner = spawnSync) {
	const result = runner(process.execPath, [verifyScript, '--mode', 'production', sourceApp], {
		encoding: 'utf8',
		env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	if (result.error || result.status !== 0) {
		fail('The cached Thingtime bundle did not pass Developer ID, notarization, and nested-code verification.');
	}
}

export async function executeCachedReleasePlan(plan, options = {}) {
	const waitForExitFn = options.waitForExit || waitForExit;
	const verifyApp = options.verifyApp || verifyCachedReleaseSource;
	const installApp = options.installApp || installLocalApp;
	const openApp = options.openApp || ((appPath) => spawnSync('/usr/bin/open', ['-n', appPath], { stdio: 'ignore' }));

	await waitForExitFn(plan.waitForPid);
	// Verify again after the main process exits, immediately before use. This
	// closes the gap between the UI-side cache check and the detached handoff.
	verifyApp(plan.sourceApp);
	const targetApp = plan.action === 'install'
		? installApp({ sourceApp: plan.sourceApp, targetDir: plan.targetDir, signatureMode: 'production' }).targetApp
		: plan.sourceApp;
	const opened = openApp(targetApp);
	if (opened.error || opened.status !== 0) fail('Thingtime was installed but could not be reopened automatically.');
	return targetApp;
}

async function main(values) {
	const planPath = parseArguments(values);
	try {
		const plan = readPlan(planPath);
		await executeCachedReleasePlan(plan);
	} finally {
		rmSync(planPath, { force: true });
	}
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
	try {
		await main(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
