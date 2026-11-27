const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

async function fixture(t, broken = false) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thingtime-build-deps-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const bin = path.join(dir, 'node_modules', '.bin', 'electron-builder');
	const write = () => { fs.mkdirSync(path.dirname(bin), { recursive: true }); fs.writeFileSync(bin, '#!/bin/sh\ntest -f "./ready"\n', { mode: 0o700 }); };
	if (broken) write();
	const { ensureElectronBuildDependencies } = await import('../scripts/ensure-build-dependencies.mjs');
	return { dir, bin, write, ensure: options => ensureElectronBuildDependencies({ electronDir: dir, packageManager: 'pnpm@10.12.1', ...options }) };
}

for (const broken of [false, true]) test(`repairs ${broken ? 'incomplete' : 'missing'} builder through the pinned frozen lockfile`, async t => {
	const f = await fixture(t, broken); let installs = 0;
	f.ensure({ runner(command, args, options) {
		if (command !== 'corepack') return spawnSync(command, args, options);
		assert.deepEqual(args, ['pnpm@10.12.1', 'install', '--frozen-lockfile']);
		assert.equal(options.cwd, f.dir); installs++;
		f.write(); fs.writeFileSync(path.join(f.dir, 'ready'), ''); return { status: 0 };
	} });
	assert.equal(installs, 1);
});

test('healthy builder does not reinstall dependencies', async t => {
	const f = await fixture(t, true); fs.writeFileSync(path.join(f.dir, 'ready'), '');
	f.ensure({ runner(command, args, options) { assert.notEqual(command, 'corepack'); return spawnSync(command, args, options); } });
});

test('failed or ineffective dependency repair stops before resources', async t => {
	const f = await fixture(t);
	for (const status of [1, 0]) assert.throws(() => f.ensure({ runner(command, args, options) {
		return command === 'corepack' ? { status } : spawnSync(command, args, options);
	} }), /resource builds were not started/u);
	const source = fs.readFileSync(path.join(__dirname, '../scripts/build-local-app.mjs'), 'utf8');
	assert.ok(source.indexOf('ensureElectronBuildDependencies({') < source.indexOf("'run', 'build:resources'"));
});
