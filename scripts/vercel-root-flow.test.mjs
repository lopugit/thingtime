import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { stageVercelOutput } from './vercel-build.mjs';
import { getVercelIgnoreDecision } from './vercel-ignore-build.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('the repository root pins the same pnpm version as Remix', async () => {
	const rootPackage = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'));
	const remixPackage = JSON.parse(await readFile(resolve(repositoryRoot, 'remix/package.json'), 'utf8'));

	assert.equal(rootPackage.packageManager, 'pnpm@10.12.1');
	assert.equal(rootPackage.packageManager, remixPackage.packageManager);
});

test('the repository-root Vercel config owns the product build', async () => {
	const config = JSON.parse(await readFile(resolve(repositoryRoot, 'vercel.json'), 'utf8'));

	assert.equal(config.framework, null);
	assert.equal(config.installCommand, 'corepack pnpm --dir remix install --frozen-lockfile');
	assert.equal(config.buildCommand, 'node scripts/vercel-build.mjs');
	assert.equal(config.outputDirectory, null);
	assert.equal(config.ignoreCommand, 'node scripts/vercel-ignore-build.mjs');
	assert.deepEqual(config.git?.deploymentEnabled, {
		'*': false,
		main: true,
		develop: true
	});
	assert.equal(existsSync(resolve(repositoryRoot, 'remix/vercel.json')), false);
});

test('the ignore decision excludes the control plane while preserving develop custom-environment builds', () => {
	assert.deepEqual(
		getVercelIgnoreDecision({
			VERCEL_GIT_COMMIT_REF: 'github-actions',
			VERCEL_TARGET_ENV: 'develop',
			VERCEL_GIT_COMMIT_SHA: 'same',
			VERCEL_GIT_PREVIOUS_SHA: 'same'
		}),
		{ skip: true, reason: 'the github-actions control plane does not deploy' }
	);
	assert.deepEqual(
		getVercelIgnoreDecision({
			VERCEL_GIT_COMMIT_REF: 'codex/product-change',
			VERCEL_GIT_COMMIT_SHA: 'same',
			VERCEL_GIT_PREVIOUS_SHA: 'same'
		}),
		{ skip: true, reason: 'the selected commit was already considered' }
	);
	assert.deepEqual(
		getVercelIgnoreDecision({
			VERCEL_GIT_COMMIT_REF: 'codex/product-change',
			VERCEL_TARGET_ENV: 'develop',
			VERCEL_GIT_COMMIT_SHA: 'same',
			VERCEL_GIT_PREVIOUS_SHA: 'same'
		}),
		{ skip: false, reason: 'the develop custom environment requires an isolated build' }
	);
	assert.deepEqual(
		getVercelIgnoreDecision({
			VERCEL_GIT_COMMIT_REF: 'codex/product-change',
			VERCEL_GIT_COMMIT_SHA: 'new',
			VERCEL_GIT_PREVIOUS_SHA: 'old'
		}),
		{ skip: false, reason: 'this product commit requires a build' }
	);
});

test('staging promotes a complete Nitro artifact and replaces stale root output', async (t) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'thingtime-vercel-root-'));
	t.after(() => rm(temporaryRoot, { force: true, recursive: true }));

	const source = resolve(temporaryRoot, 'remix/.vercel/output');
	const destination = resolve(temporaryRoot, '.vercel/output');
	await mkdir(resolve(source, 'static'), { recursive: true });
	await mkdir(resolve(source, 'functions/__server.func'), { recursive: true });
	await mkdir(destination, { recursive: true });
	await writeFile(resolve(source, 'static/index.html'), '<div id="root"></div>');
	await writeFile(resolve(source, 'functions/__server.func/index.mjs'), 'export default {}');
	await symlink('./__server.func', resolve(source, 'functions/[...].func'));
	await writeFile(
		resolve(source, 'config.json'),
		JSON.stringify({
			routes: [{ handle: 'filesystem' }, { src: '/(?:.*)', dest: '/index.html' }]
		})
	);
	await writeFile(resolve(destination, 'stale.txt'), 'stale');

	await stageVercelOutput({ sourceDirectory: source, destinationDirectory: destination });

	assert.equal(await readFile(resolve(destination, 'static/index.html'), 'utf8'), '<div id="root"></div>');
	assert.equal(await readlink(resolve(destination, 'functions/[...].func')), './__server.func');
	assert.equal(await readFile(resolve(destination, 'functions/[...].func/index.mjs'), 'utf8'), 'export default {}');
	assert.equal(existsSync(resolve(destination, 'stale.txt')), false);
	assert.equal(existsSync(resolve(source, 'config.json')), true);
});

test('invalid source output leaves the previous root artifact untouched', async (t) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'thingtime-vercel-invalid-'));
	t.after(() => rm(temporaryRoot, { force: true, recursive: true }));

	const source = resolve(temporaryRoot, 'remix/.vercel/output');
	const destination = resolve(temporaryRoot, '.vercel/output');
	await mkdir(resolve(source, 'static'), { recursive: true });
	await mkdir(destination, { recursive: true });
	await writeFile(resolve(source, 'static/index.html'), 'not the app shell');
	await writeFile(resolve(source, 'config.json'), JSON.stringify({ routes: [] }));
	await writeFile(resolve(destination, 'known-good.txt'), 'keep');

	await assert.rejects(stageVercelOutput({ sourceDirectory: source, destinationDirectory: destination }), /missing the Vite root shell/);
	assert.equal(await readFile(resolve(destination, 'known-good.txt'), 'utf8'), 'keep');
});
