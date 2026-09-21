'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const { brokenToolNames, directDependencyNames, ensureDependencies, parseToolNames, withInstallLock } = require('./ensure-dependencies.js');

const silentLogger = {
	log() {},
	warn() {}
};

test('the install lock serialises concurrent installers and discards a stale lock', async () => {
	const directory = mkdtempSync(path.join(tmpdir(), 'tt-install-lock-'));
	const lockPath = path.join(directory, 'node_modules', '.thingtime-install.lock');
	try {
		// a lock nobody holds any more (older than the stale window) is removed, not waited on
		mkdirSync(lockPath, { recursive: true });
		const old = new Date(Date.now() - 16 * 60 * 1000);
		utimesSync(lockPath, old, old);
		const warnings = [];
		assert.equal(withInstallLock(() => 'ran', { lockPath, logger: { log() {}, warn: (message) => warnings.push(message) } }), 'ran');
		assert.match(warnings[0], /stale install lock/);
		assert.equal(existsSync(lockPath), false, 'released after the run');

		// a live lock held by another process blocks until that process releases it
		mkdirSync(lockPath);
		const holder = spawn(process.execPath, ['-e', `setTimeout(() => require('node:fs').rmSync(${JSON.stringify(lockPath)}, { recursive: true, force: true }), 700)`], { stdio: 'ignore' });
		const logs = [];
		const started = Date.now();
		const result = withInstallLock(() => Date.now() - started, { lockPath, logger: { log: (message) => logs.push(message), warn() {} } });
		assert.ok(result >= 600, `waited for the holder (${result} ms)`);
		assert.match(logs[0], /Another dependency install is running/);
		assert.equal(existsSync(lockPath), false);
		await new Promise((resolve) => holder.on('exit', resolve));
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test('forces a relink when a tool is broken despite complete direct links', () => {
	let repaired = false;
	const installs = [];

	ensureDependencies({
		tools: ['eslint'],
		findMissing: () => [],
		findBrokenTools: () => (repaired ? [] : ['eslint']),
		install: (options) => {
			installs.push(options);
			repaired = true;
		},
		logger: silentLogger
	});

	assert.deepEqual(installs, [{ force: true }]);
});

test('check-only mode reports broken tools without mutating dependencies', () => {
	let installed = false;

	assert.throws(
		() =>
			ensureDependencies({
				checkOnly: true,
				tools: ['eslint'],
				findMissing: () => [],
				findBrokenTools: () => ['eslint'],
				install: () => {
					installed = true;
				},
				logger: silentLogger
			}),
		/unusable tools: eslint/
	);
	assert.equal(installed, false);
});

test('validation tools are direct and start successfully', () => {
	assert.ok(directDependencyNames().includes('prettier'));
	assert.deepEqual(brokenToolNames(['eslint', 'prettier']), []);
});

test('parses repeated and comma-separated tool probes', () => {
	assert.deepEqual(parseToolNames(['--tool=eslint', '--quiet', '--tool=prettier,eslint']), ['eslint', 'prettier', 'eslint']);
});
