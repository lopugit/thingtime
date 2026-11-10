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

test('the install lock serialises installers and refuses unowned legacy lock removal', async () => {
	const directory = mkdtempSync(path.join(tmpdir(), 'tt-install-lock-'));
	const lockPath = path.join(directory, 'node_modules', '.thingtime-install.lock');
	try {
		// A legacy lock has no ownership proof: elapsed time alone cannot authorize deleting it.
		mkdirSync(lockPath, { recursive: true });
		const old = new Date(Date.now() - 16 * 60 * 1000);
		utimesSync(lockPath, old, old);
		const warnings = [];
		assert.throws(() => withInstallLock(() => 'ran', { lockPath, logger: silentLogger }), /Ownerless install lock/);
		assert.equal(existsSync(lockPath), true);
		rmSync(lockPath, { recursive: true });
		assert.equal(withInstallLock(() => 'ran', { lockPath, logger: { log() {}, warn: (message) => warnings.push(message) } }), 'ran');
		assert.equal(existsSync(lockPath), false, 'released after the run');

		// a live lock held by another process blocks until that process releases it
		mkdirSync(lockPath);
		// The path travels as an argv value, not as interpolated source: under
		// `node -e` the first user argument is process.argv[1], so the holder needs
		// no quoting or escaping of its own (JSON.stringify is not a JS escaper).
		const holder = spawn(
			process.execPath,
			['-e', "setTimeout(() => require('node:fs').rmSync(process.argv[1], { recursive: true, force: true }), 700)", lockPath],
			{ stdio: 'ignore' }
		);
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


test('a killed installer is diagnosed immediately without stealing a possible child lock', async () => {
 const directory = mkdtempSync(path.join(tmpdir(), 'tt-exited-install-'));
 const lockPath = path.join(directory, '.thingtime-install.lock');
 const helper = path.join(__dirname, 'ensure-dependencies.js');
 const holder = spawn(process.execPath, ['-e', "require(process.argv[1]).withInstallLock(() => { process.stdout.write('locked\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000); }, {lockPath: process.argv[2]})", helper, lockPath], { stdio: ['ignore', 'pipe', 'pipe'] });
 try {
  await new Promise((resolve, reject) => { holder.stdout.once('data', resolve); holder.once('error', reject); holder.once('exit', code => reject(new Error(`holder exited before ready: ${code}`))); });
  const exited = new Promise(resolve => holder.once('exit', resolve));
  holder.kill('SIGKILL');
  await exited;
  const started = Date.now();
  assert.throws(() => withInstallLock(() => 'must not run', { lockPath, logger: silentLogger }), /Interrupted installer lock/);
  assert.ok(Date.now() - started < 1000, 'does not wait ten minutes on a dead holder');
  assert.equal(existsSync(lockPath), true, 'preserves possible child installer ownership');
 } finally { holder.kill(); rmSync(directory, {recursive: true, force: true}); }
});


test('an old lock held by a live installer is never stolen', async () => {
 const directory = mkdtempSync(path.join(tmpdir(), 'tt-live-install-'));
 const lockPath = path.join(directory, '.thingtime-install.lock');
 const helper = path.join(__dirname, 'ensure-dependencies.js');
 const holder = spawn(process.execPath, ['-e', "require(process.argv[1]).withInstallLock(() => { const old = new Date(Date.now() - 20*60*1000); require('node:fs').utimesSync(process.argv[2], old, old); process.stdout.write('locked\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 700); }, {lockPath: process.argv[2]})", helper, lockPath], {stdio: ['ignore', 'pipe', 'pipe']});
 const exited = new Promise(resolve => holder.once('exit', resolve));
 try {
  await new Promise((resolve, reject) => { holder.stdout.once('data', resolve); holder.once('error', reject); });
  const start = Date.now();
  const elapsed = withInstallLock(() => Date.now() - start, {lockPath, logger: silentLogger});
  assert.ok(elapsed >= 600, `waited for live owner (${elapsed}ms)`);
  assert.equal(existsSync(lockPath), false);
  await exited;
 } finally { holder.kill(); rmSync(directory, {recursive: true, force: true}); }
});
