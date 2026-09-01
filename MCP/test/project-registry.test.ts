import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { LocalProjectRegistry, refreshEmptyProjectRegistry } from '../src/live/projectRegistry.js';

test('maps local directories to stable opaque ids without returning paths', () => {
	const registry = new LocalProjectRegistry({ secondary: '/', thingtime: '/tmp' }, 'thingtime');
	const reference = registry.register('/tmp');
	assert.match(reference.projectId, /^local-[a-f0-9]{32}$/);
	assert.equal(reference.projectLabel, 'tmp');
	assert.equal(registry.resolve('thingtime'), realpathSync('/tmp'));
	assert.doesNotMatch(JSON.stringify(reference), /private|\/tmp/);
	assert.deepEqual(registry.list(), [
		{ projectId: 'thingtime', projectLabel: 'tmp' },
		{ projectId: 'secondary', projectLabel: 'Project' },
		reference
	]);
	assert.doesNotMatch(JSON.stringify(registry.list()), /\/tmp|private/u);
});

test('fails closed for unknown project ids and relative paths', () => {
	const registry = new LocalProjectRegistry();
	assert.throws(() => registry.resolve('missing'), /unavailable/);
	assert.throws(() => registry.register('relative/path'), /invalid/);
	assert.throws(() => new LocalProjectRegistry({ '.private': '/tmp' }), /invalid/);
	assert.equal(registry.register('/tmp/  Private\\Name\u2066  ').projectLabel, 'Private Name');
});

test('discovers fresh-install projects locally before exposing bounded references', async () => {
	const registry = new LocalProjectRegistry();
	let starts = 0;
	let refreshes = 0;
	const connector = {
		refreshProjects: async () => {
			refreshes += 1;
			registry.register('/tmp');
		}
	};

	await refreshEmptyProjectRegistry(registry, [connector], async () => {
		starts += 1;
	});

	assert.equal(starts, 1);
	assert.equal(refreshes, 1);
	assert.deepEqual(registry.list().map(({ projectId, projectLabel }) => ({ projectId, projectLabel })), [
		{ projectId: registry.register('/tmp').projectId, projectLabel: 'tmp' }
	]);
	assert.doesNotMatch(JSON.stringify(registry.list()), /\/tmp|private/u);

	await refreshEmptyProjectRegistry(registry, [connector], async () => {
		starts += 1;
	});
	assert.equal(starts, 2);
	assert.equal(refreshes, 1);
});

test('reloads a private Electron registry while keeping project paths off the wire', async () => {
	const root = await mkdtemp(join(tmpdir(), 'thingtime-project-registry-'));
	const projectPath = join(root, 'Empty Project');
	const registryPath = join(root, 'projects.json');
	try {
		await mkdir(projectPath);
		await writeFile(registryPath, JSON.stringify({ version: 1, projectPaths: [projectPath] }), { mode: 0o600 });
		const registry = LocalProjectRegistry.fromEnvironment({ THINGTIME_NODE_PROJECT_REGISTRY_PATH: registryPath });
		registry.reloadFromFile();
		const references = registry.list();
		assert.equal(references.length, 1);
		assert.equal(references[0]?.projectLabel, 'Empty Project');
		assert.match(references[0]?.projectId || '', /^local-[a-f0-9]{32}$/u);
		assert.equal(registry.resolve(references[0]?.projectId), realpathSync(projectPath));
		assert.equal(JSON.stringify(references).includes(root), false);

		await chmod(registryPath, 0o644);
		assert.throws(() => registry.reloadFromFile(), /privacy checks/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
