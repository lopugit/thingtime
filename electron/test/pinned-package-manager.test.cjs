'use strict';

const assert = require('node:assert/strict');
const { constants } = require('node:fs');
const { access, mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const helper = import('../scripts/pinned-package-manager.mjs');

test('pinned pnpm shim forwards every collector invocation through the exact Corepack pin', async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), 'thingtime-pnpm-test-'));
	t.after(() => rm(root, { force: true, recursive: true }));
	const fakeBin = path.join(root, "bin with 'quote");
	await mkdir(fakeBin);
	const fakeCorepack = path.join(fakeBin, 'corepack');
	await writeFile(
		fakeCorepack,
		'#!/bin/sh\nif [ "$2" = "--version" ]; then\n  printf \'10.12.1\\n\'\n  exit 0\nfi\nprintf \'%s\\n\' "$@"\n',
		{ mode: 0o700 }
	);

	const { createPinnedPnpmEnvironment } = await helper;
	const pinned = await createPinnedPnpmEnvironment('pnpm@10.12.1', {
		...process.env,
		PATH: fakeBin
	});
	t.after(() => pinned.dispose());

	const result = spawnSync('pnpm', ['list', '--prod', '--json'], {
		env: pinned.environment,
		encoding: 'utf8'
	});
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(result.stdout.trim().split('\n'), ['pnpm@10.12.1', 'list', '--prod', '--json']);
	assert.equal(pinned.environment.PATH.split(path.delimiter)[0], path.dirname(pinned.shimPath));

	await pinned.dispose();
	await assert.rejects(access(pinned.shimPath, constants.F_OK), /ENOENT/u);
});

test('pinned pnpm shim rejects floating or non-pnpm package-manager declarations', async () => {
	const { createPinnedPnpmEnvironment } = await helper;
	for (const packageManager of ['pnpm@latest', 'pnpm@10', 'npm@10.12.1', undefined]) {
		await assert.rejects(
			createPinnedPnpmEnvironment(packageManager, process.env),
			/electron\/package\.json must pin an exact pnpm packageManager version/u
		);
	}
});

test('pinned pnpm shim fails closed when Corepack cannot be resolved', async () => {
	const { createPinnedPnpmEnvironment } = await helper;
	await assert.rejects(
		createPinnedPnpmEnvironment('pnpm@10.12.1', { PATH: path.join(tmpdir(), 'thingtime-no-corepack') }),
		/Corepack is required/u
	);
});

test('pinned pnpm shim fails before packaging when Corepack resolves the wrong pnpm', async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), 'thingtime-pnpm-version-test-'));
	t.after(() => rm(root, { force: true, recursive: true }));
	const fakeCorepack = path.join(root, 'corepack');
	await writeFile(fakeCorepack, '#!/bin/sh\nprintf \'11.12.0\\n\'\n', { mode: 0o700 });

	const { createPinnedPnpmEnvironment } = await helper;
	await assert.rejects(
		createPinnedPnpmEnvironment('pnpm@10.12.1', { ...process.env, PATH: root }),
		/requires pnpm 10\.12\.1.*resolved 11\.12\.0/u
	);
});
