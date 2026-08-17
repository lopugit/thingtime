import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { stageVercelOutput } from './vercel-build.mjs';
import { getVercelIgnoreDecision } from './vercel-ignore-build.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('the repository-root Vercel config owns the product build', async () => {
	const config = JSON.parse(await readFile(resolve(repositoryRoot, 'vercel.json'), 'utf8'));

	assert.equal(config.framework, null);
	assert.equal(config.installCommand, 'corepack pnpm --dir remix install --frozen-lockfile');
	assert.equal(config.buildCommand, 'node scripts/vercel-build.mjs');
	assert.equal(config.outputDirectory, null);
	assert.equal(config.ignoreCommand, 'node scripts/vercel-ignore-build.mjs');
	assert.equal(config.git?.deploymentEnabled?.['github-actions'], false);
	assert.equal(existsSync(resolve(repositoryRoot, 'remix/vercel.json')), false);
});

test('the ignore decision excludes only the control plane and duplicate commits', () => {
	assert.equal(getVercelIgnoreDecision({ VERCEL_GIT_COMMIT_REF: 'github-actions' }).skip, true);
	assert.equal(
		getVercelIgnoreDecision({
			VERCEL_GIT_COMMIT_REF: 'develop',
			VERCEL_GIT_COMMIT_SHA: 'same',
			VERCEL_GIT_PREVIOUS_SHA: 'same'
		}).skip,
		true
	);
	assert.equal(
		getVercelIgnoreDecision({
			VERCEL_GIT_COMMIT_REF: 'codex/product-change',
			VERCEL_GIT_COMMIT_SHA: 'new',
			VERCEL_GIT_PREVIOUS_SHA: 'old'
		}).skip,
		false
	);
});

test('staging promotes a complete Nitro artifact and replaces stale root output', async (t) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'thingtime-vercel-root-'));
	t.after(() => rm(temporaryRoot, { force: true, recursive: true }));

	const source = resolve(temporaryRoot, 'remix/.vercel/output');
	const destination = resolve(temporaryRoot, '.vercel/output');
	await mkdir(resolve(source, 'static'), { recursive: true });
	await mkdir(destination, { recursive: true });
	await writeFile(resolve(source, 'static/index.html'), '<div id="root"></div>');
	await writeFile(
		resolve(source, 'config.json'),
		JSON.stringify({
			routes: [{ handle: 'filesystem' }, { src: '/(?:.*)', dest: '/index.html' }]
		})
	);
	await writeFile(resolve(destination, 'stale.txt'), 'stale');

	await stageVercelOutput({ sourceDirectory: source, destinationDirectory: destination });

	assert.equal(await readFile(resolve(destination, 'static/index.html'), 'utf8'), '<div id="root"></div>');
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
