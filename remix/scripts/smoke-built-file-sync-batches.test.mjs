/** Pure runner contract tests. These do NOT execute or prove a built server. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertBuiltBatchManifest, resolveCompiledEntry, BUILT_BATCH_SMOKE_PORT } from './smoke-built-file-sync-batches.mjs';
const origin = 'http://127.0.0.1:' + BUILT_BATCH_SMOKE_PORT;
const manifest = () => ({
	schemaVersion: 1,
	origin,
	features: { 'api.file-sync-batches': { version: '1.0.0' } },
	operations: [
		{ feature: 'api.file-sync-batches', path: '/api/v1/files/batches', methods: ['POST'] },
		{ feature: 'api.file-sync-batches', path: '/api/v1/files/batches-docs', methods: ['GET'] }
	]
});
test('built manifest assertions reject wrong origin/version or missing executable/docs operation', () => {
	assert.doesNotThrow(() => assertBuiltBatchManifest(manifest(), origin));
	for (const change of [
		(m) => (m.origin = 'https://other.test'),
		(m) => (m.features['api.file-sync-batches'].version = '0.9.0'),
		(m) => delete m.features['api.file-sync-batches'],
		(m) => m.operations.pop(),
		(m) => (m.operations[0].methods = ['GET'])
	]) {
		const m = manifest();
		change(m);
		assert.throws(() => assertBuiltBatchManifest(m, origin));
	}
});
test('bundle resolver accepts output/server/entry paths without executing modules or starting listeners', async () => {
	const root = await mkdtemp(join(tmpdir(), 'thingtime-smoke-runner-unit-'));
	try {
		const server = join(root, 'server');
		await mkdir(server);
		const entry = join(server, 'index.mjs');
		await writeFile(entry, 'throw Error("must never execute in resolver test")');
		assert.equal(await resolveCompiledEntry(root), await realpath(entry));
		assert.equal(await resolveCompiledEntry(server), await realpath(entry));
		assert.equal(await resolveCompiledEntry(entry), await realpath(entry));
		await assert.rejects(resolveCompiledEntry(join(root, 'missing')));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
