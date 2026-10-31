import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBatchObserveService, parseBatchObserveRequest } from './batchObserve';
const seed = JSON.parse(readFileSync(new URL('../../../fileSync/fixtures/uploadBatchDigest.v1.json', import.meta.url), 'utf8')).vectors[0].descriptor;
const folder = (id: string, parent: string | null, name = id) => ({
	shareId: id,
	ownerId: 'owner',
	thingtime: ['folder'],
	folderId: parent,
	acl: ['tt:user'],
	updatedAt: new Date(),
	crystal: { name }
});
function fixture(extra: any[] = []) {
	const docs = [folder('cloud-root', null), folder('parent', 'cloud-root', 'Parent'), ...extra];
	let cursors = 0,
		closed = 0;
	const session = { snapshotEnabled: true };
	const coll = {
		findOne: async (q: any) => docs.find((d) => d.shareId === q.shareId && d.ownerId === q.ownerId),
		find(q: any, options: any) {
			assert.equal(options.session, session);
			assert.ok(options.signal);
			cursors++;
			const rows = docs.filter((d) => q.folderId.$in.includes(d.folderId));
			return {
				batchSize() {
					return this;
				},
				async *[Symbol.asyncIterator]() {
					yield* rows;
				},
				async close() {
					closed++;
				}
			};
		}
	};
	const service = createBatchObserveService({
		collection: async () => coll as any,
		snapshot: async (work: any) => work(session),
		workspace: (async () => {
			const keys = new Set<string>();
			return {
				add: async (k: string) => {
					if (keys.has(k)) return false;
					keys.add(k);
					return true;
				},
				close: async () => {}
			};
		}) as any
	});
	return {
		service,
		get cursors() {
			return cursors;
		},
		get closed() {
			return closed;
		}
	};
}
test('observe shares parent sibling lookups for256paths and returns ordered missing leaves', async () => {
	const f = fixture();
	const paths = Array.from({ length: 256 }, (_, i) => 'Parent/f' + i);
	const result: any = await f.service('owner', 'cloud-root', paths, new AbortController().signal);
	assert.equal(result.ok, true);
	assert.equal(f.cursors, 2);
	assert.equal(f.closed, 2);
	assert.deepEqual(
		result.observations.map((r: any) => r.path),
		paths
	);
	assert.ok(result.observations.every((r: any) => r.node === null && r.parent.id === 'parent'));
});
test('observe returns actual canonical file target and null root-level or missing parent', async () => {
	const file = {
		...folder('file', 'parent', 'existing'),
		thingtime: ['file'],
		timelineHeadId: 'revision',
		crystal: {
			name: 'existing',
			trashed: false,
			content: {
				attachmentId: 'att',
				version: 'a'.repeat(64),
				size: 4,
				fingerprint: { algorithm: 'sha256-parts-v1', partCount: 1, partSizeBytes: 8388608, sha256: 'b'.repeat(64) }
			}
		}
	};
	const f = fixture([file]);
	const result: any = await f.service('owner', 'cloud-root', ['Parent/existing', 'rootfile', 'Missing/file'], new AbortController().signal);
	assert.equal(result.ok, true);
	assert.equal(result.observations[0].node.file.id, 'file');
	assert.equal(result.observations[0].node.file.content.size, 4);
	assert.equal(result.observations[1].parent, null);
	assert.equal(result.observations[2].parent, null);
});
test('observe suppresses all output on sibling aliases, inaccessible rows or file ancestors', async () => {
	for (const extra of [
		[folder('alias', 'cloud-root', 'parent')],
		[{ ...folder('foreign', 'parent', 'other'), acl: ['tt:public'] }],
		[{ ...folder('alias', 'parent', 'f'), ownerId: 'other' }]
	]) {
		const f = fixture(extra);
		const result = await f.service('owner', 'cloud-root', ['Parent/f'], new AbortController().signal);
		assert.equal(result.ok, false);
		assert.equal(f.closed, f.cursors);
	}
});
test('observe parser closes fields and bounds paths and normalized uniqueness', () => {
	const request = { phase: 'observe', scope: seed.scope, configuration: seed.configuration, paths: ['Parent/f'] };
	assert.equal(parseBatchObserveRequest(request).paths.length, 1);
	for (const patch of [
		{ permit: true },
		{ paths: ['../private'] },
		{ paths: ['Parent/F', 'parent/f'] },
		{ paths: Array.from({ length: 257 }, (_, i) => 'f' + i) },
		{ configuration: { ...seed.configuration, configuration: { ...seed.configuration.configuration, paused: true } } }
	])
		assert.throws(() => parseBatchObserveRequest({ ...request, ...patch }));
});

test('observe distinguishes revoked root authority from transient transport without leaking details', async () => {
	const offline = createBatchObserveService({
		collection: async () => {
			throw Error('private hostname');
		}
	});
	const retry: any = await offline('owner', 'root', ['file'], new AbortController().signal);
	assert.equal(retry.status, 503);
	assert.equal(retry.authorityChanged, false);
	assert.ok(!JSON.stringify(retry).includes('hostname'));
	const missing = createBatchObserveService({
		collection: async () => ({ findOne: async () => null } as any),
		snapshot: async (work: any) => work({ snapshotEnabled: true })
	});
	const revoked: any = await missing('owner', 'root', ['file'], new AbortController().signal);
	assert.equal(revoked.status, 403);
	assert.equal(revoked.authorityChanged, true);
});
