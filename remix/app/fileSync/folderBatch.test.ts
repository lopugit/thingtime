import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
	folderBatchCanonicalBytes,
	folderBatchDigest,
	parseFolderBatchDescriptor,
	parseFolderBatchProbeResponse,
	parseNativeFolderBatchResult,
	parseFolderBatchCommitResponse,
	type FolderBatchDescriptor
} from './folderBatch';
const vectors = JSON.parse(readFileSync(new URL('./fixtures/folderBatchDigest.v1.json', import.meta.url), 'utf8')).vectors;
const seed = (): FolderBatchDescriptor => structuredClone(vectors[0].descriptor);
for (const vector of vectors)
	test(`folder canonical ${vector.name} bytes and digest`, async () => {
		assert.equal(new TextDecoder().decode(folderBatchCanonicalBytes(vector.descriptor)), vector.canonicalUtf8);
		assert.equal(await folderBatchDigest(vector.descriptor), vector.sha256);
	});
test('folder authority, dependencies, aliases, closed fields and metadata bounds fail closed', () => {
	const changes: ((d: any) => void)[] = [
		(d) => (d.scope.ownerId = 'another'),
		(d) => (d.configuration.configuration.mode = 'two-way'),
		(d) => (d.configuration.configuration.paused = true),
		(d) => (d.members[1].write.operation.id = d.members[0].write.operation.id),
		(d) => (d.members[1].write.operation.mutation.source.id = d.members[0].write.operation.mutation.source.id),
		(d) => (d.members[1].parent.ordinal = 1),
		(d) => (d.members[1].write.folderId = 'wrong-parent'),
		(d) => (d.members[1].parent = { kind: 'existing', id: d.members[0].write.operation.id }),
		(d) => (d.members[0].parent = { kind: 'root', credential: 'private' }),
		(d) => (d.members[0].write.operation.mutation.source.fingerprint = null),
		(d) => (d.members[0].write.operation.mutation.source.sha256 = 'a'.repeat(64)),
		(d) => (d.members[0].write.operation.mutation.source.version = 'x'.repeat(513)),
		(d) => {
			d.members[2].write.operation.mutation.path = 'parent';
			d.members[2].write.operation.mutation.source.path = 'parent';
		},
		(d) => (d.members = Array(257).fill(d.members[0]))
	];
	for (const change of changes) {
		const d = seed();
		change(d);
		assert.throws(() => parseFolderBatchDescriptor(d));
	}
	const input = seed(),
		parsed = parseFolderBatchDescriptor(input);
	input.members[0].write.folderId = 'changed';
	assert.notEqual(parsed.members[0].write.folderId, 'changed');
});
test('native folder validation is exact sparse subset and no malformed success escapes', async () => {
	const descriptor = seed(),
		digest = await folderBatchDigest(descriptor),
		input = { descriptor, digest, ordinals: [1, 2], remainingMs: 1000 };
	const value = {
		ok: true,
		version: 1,
		batchId: descriptor.batchId,
		digest,
		results: [
			{ ordinal: 1, status: 'validated' },
			{ ordinal: 2, status: 'failed', code: 'source-changed', retryable: false }
		]
	};
	assert.equal(parseNativeFolderBatchResult(value, input).results.length, 2);
	for (const patch of [
		{ ...value, results: [] },
		{ ...value, results: [...value.results].reverse() },
		{ ...value, results: [{ ordinal: 1, status: 'validated', source: 'private' }, value.results[1]] },
		{ ...value, digest: '0'.repeat(64) }
	])
		assert.throws(() => parseNativeFolderBatchResult(patch, input));
	assert.throws(() => parseNativeFolderBatchResult(value, { ...input, ordinals: [2, 1] }));
	assert.throws(() => parseNativeFolderBatchResult(value, { ...input, remainingMs: 180001 }));
});
test('canonical folder receipts bind exact member ID/name/parent for probe and commit', async () => {
	const descriptor = seed(),
		digest = await folderBatchDigest(descriptor),
		input = { descriptor, digest };
	const results = descriptor.members.map((m) => ({
		ordinal: m.ordinal,
		status: 'confirmed',
		replayed: true,
		folder: { id: m.write.operation.id, name: m.write.operation.mutation.path.split('/').at(-1), folderId: m.write.folderId, revision: 'r1' }
	}));
	const envelope = { ok: true, version: 1, batchId: descriptor.batchId, digest, results };
	assert.equal(parseFolderBatchProbeResponse(envelope, input).results.length, 3);
	assert.equal(parseFolderBatchCommitResponse({ ...envelope, results: [results[2]] }, input, [2]).results.length, 1);
	for (const key of ['id', 'name', 'folderId']) {
		const changed = structuredClone(envelope);
		changed.results[0].folder[key] = 'different';
		assert.throws(() => parseFolderBatchProbeResponse(changed, input));
	}
});
