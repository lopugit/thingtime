import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { installLocalApp } from './install-local-app.mjs';

const appName = 'Thingtime.app';

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
	if (!parsed || parsed.format !== 1 || !Number.isSafeInteger(parsed.waitForPid) || parsed.waitForPid <= 1) {
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
	return { sourceApp, targetDir, waitForPid: parsed.waitForPid };
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

const planPath = parseArguments(process.argv.slice(2));
try {
	const plan = readPlan(planPath);
	await waitForExit(plan.waitForPid);
	const result = installLocalApp({ sourceApp: plan.sourceApp, targetDir: plan.targetDir, signatureMode: 'production' });
	const opened = spawnSync('/usr/bin/open', [result.targetApp], { stdio: 'ignore' });
	if (opened.error || opened.status !== 0) fail('Thingtime was installed but could not be reopened automatically.');
} finally {
	rmSync(planPath, { force: true });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath !== import.meta.url) fail('Thingtime cached release helper must run as its own process.');
