import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudInventoryPagesService } from './inventoryPages';
import { openInventoryQueue, INVENTORY_QUEUE_BYTES } from './inventoryQueue';
import { cloudInventoryResponse } from './inventoryStream';
import { CLOUD_INVENTORY_TIMEOUT_MS, CLOUD_INVENTORY_PAGE_BYTES, type CloudInventoryPage } from '../../../fileSync/cloudInventoryPages';
import { contentPartPlan } from '../../../fileSync/contentFingerprint';

const folder = (id: string, parent: string | null = 'root') => ({ shareId: id, ownerId: 'owner', thingtime: ['folder'], folderId: parent,
	acl: ['tt:user'], updatedAt: new Date('2026-10-19T00:00:00Z'), crystal: { name: id } });
const file = (id: string) => ({ ...folder(id), thingtime: ['file'], timelineHeadId: 'revision-' + id, crystal: { name: id, trashed: false,
	content: { attachmentId: 'attachment-' + id, version: 'a'.repeat(64), size: 4,
		fingerprint: { algorithm: 'sha256-parts-v1', ...contentPartPlan(4), sha256: 'b'.repeat(64) } } } });
function fixture(children: any[] = [file('file')]) {
	const docs = [folder('root', null), ...children]; let session: any, queries = 0, closed = 0, time = 0, sessions = 0, workspaces = 0;
	let afterRow = () => {}, afterSnapshot = () => {}, custom = false;
	const check = (options: any) => { assert.equal(options.session, session); assert.equal(options.readPreference, 'primary');
		assert.ok(options.maxTimeMS > 0 && options.maxTimeMS <= 5000); assert.equal(options.projection._id, 0); };
	const service = createCloudInventoryPagesService({
		customPlane: () => custom, now: () => time,
		workspace: async () => { const queue = await openInventoryQueue(); workspaces++; return { ...queue, close: async () => { await queue.close(); workspaces--; } }; },
		collection: async () => ({
			findOne: async (filter: any, options: any) => { check(options); return session.docs.find((d: any) => d.shareId === filter.shareId && d.ownerId === filter.ownerId); },
			find: (filter: any, options: any) => {
				check(options); assert.ok(filter.folderId.$in.length <= 128); queries++;
				const matches = session.docs.filter((d: any) => filter.folderId.$in.includes(d.folderId));
				return { sort: function() { return this; }, batchSize: function(n: number) { assert.equal(n, 128); return this; },
					async *[Symbol.asyncIterator]() { for (const doc of matches) { afterRow(); yield doc; } },
					async close() { closed++; } };
			}
		}),
		snapshot: async work => { sessions++; session = { docs: structuredClone(docs), snapshotEnabled: true, inTransaction: () => false,
			snapshotTime: { getHighBitsUnsigned: () => 100, getLowBitsUnsigned: () => 2 } };
			const result = await work(session); afterSnapshot(); return result; }
	});
	return { service, docs, counts: () => ({ queries, closed, workspaces, sessions }), row: (fn: () => void) => { afterRow = fn; },
		end: (fn: () => void) => { afterSnapshot = fn; }, expire: () => { time = CLOUD_INVENTORY_TIMEOUT_MS; }, custom: () => { custom = true; } };
}

test('10,001 files stream as 79 bounded pages from one unchanged snapshot', async () => {
	const f = fixture(Array.from({ length: 10_001 }, (_, i) => file('file-' + i))), pages: CloudInventoryPage[] = [];
	await f.service('owner', 'root', async page => {
		assert.ok(page.nodes.length <= 128); assert.ok(Buffer.byteLength(JSON.stringify(page)) <= CLOUD_INVENTORY_PAGE_BYTES);
		if (!pages.length) f.docs.splice(1); // Concurrent writes cannot change this observation.
		if (page.totalEntries !== undefined) assert.equal(f.counts().workspaces, 0);
		pages.push(page);
	});
	assert.equal(pages.length, 79); assert.equal(pages.at(-1)!.totalEntries, 10_001);
	assert.equal(new Set(pages.map(p => p.generation)).size, 1);
	assert.deepEqual(pages.map(p => p.ordinal), pages.map((_, i) => i));
	assert.deepEqual(f.counts(), { queries: 1, closed: 1, workspaces: 0, sessions: 1 });
});

test('wide directory frontiers use disk and bounded parent queries', async () => {
	const f = fixture(Array.from({ length: 4096 }, (_, i) => folder('folder-' + i))); let count = 0;
	await f.service('owner', 'root', async p => { count += p.nodes.length; });
	assert.equal(count, 4096); assert.deepEqual(f.counts(), { queries: 33, closed: 33, workspaces: 0, sessions: 1 });
});

test('snapshot expiry, private access failure, abort and cleanup failure never publish a terminal page', async () => {
	for (const reason of ['timeout', 'abort', 'plane', 'private', 'failure', 'snapshot-end'] as const) {
		const f = fixture(Array.from({ length: 260 }, (_, i) => file('file-' + i))), abort = new AbortController(), pages: CloudInventoryPage[] = [];
		if (reason === 'private') f.docs[259].acl = ['tt:public'];
		if (reason === 'snapshot-end') f.end(() => { throw Error('snapshot expired'); });
		await assert.rejects(f.service('owner', 'root', async page => {
			pages.push(page);
			if (reason === 'timeout') f.expire();
			if (reason === 'abort') abort.abort();
			if (reason === 'plane') f.custom();
			if (reason === 'failure') throw Error('reader disconnected');
		}, abort.signal), reason);
		assert.ok(pages.length > 0); assert.ok(pages.every(p => p.totalEntries === undefined));
		assert.equal(f.counts().workspaces, 0); assert.equal(f.counts().queries, f.counts().closed);
	}
});

test('queue stays FIFO across reads/appends and refuses invalid bounds and closed use', async () => {
	const queue = await openInventoryQueue();
	try {
		for (let i = 0; i < 1000; i++) await queue.append({ id: String(i), path: 'folder-' + i, depth: 1 });
		assert.deepEqual((await queue.read(128)).map(r => r.id), Array.from({ length: 128 }, (_, i) => String(i)));
		await queue.append({ id: '1000', path: 'later', depth: 1 });
		let next = 128;
		for (;;) { const page = await queue.read(); if (!page.length) break; for (const row of page) assert.equal(row.id, String(next++)); }
		assert.equal(next, 1001);
		await assert.rejects(queue.read(129));
		await assert.rejects(queue.append({ id: 'huge', path: 'x'.repeat(8192), depth: 1 }));
	} finally { await queue.close(); }
	await queue.close(); await assert.rejects(queue.read()); await assert.rejects(queue.append({ id: 'closed', path: 'x', depth: 1 }));
	await assert.rejects(openInventoryQueue(INVENTORY_QUEUE_BYTES + 1));
	const tiny = await openInventoryQueue(1);
	try { await assert.rejects(tiny.append({ id: 'full', path: 'x', depth: 1 }), /disk bound/); } finally { await tiny.close(); }
});

test('process capture admission bounds scratch use and releases a rejected workspace', async () => {
	let release!: () => void;
	const pending = new Promise<void>(resolve => { release = resolve; });
	const service = createCloudInventoryPagesService({ customPlane: () => false,
		workspace: async () => { await pending; throw Error('no workspace'); } });
	const a = service('owner', 'root', async () => {}), b = service('owner', 'root', async () => {});
	const settled = Promise.allSettled([a, b]);
	await assert.rejects(service('owner', 'root', async () => {}), /capacity/); release(); await settled;
	await assert.rejects(service('owner', 'root', async () => {}), /no workspace/);
});

test('stream redacts source failures and reader cancellation aborts outstanding source work', async () => {
	const failed = cloudInventoryResponse('owner', 'root', new Request('https://sync.test'), async () => { throw Error('/private/path secret'); });
	const text = await failed.text(); assert.doesNotMatch(text, /private\/path|secret/); assert.equal(JSON.parse(text).ok, false);
	let observed!: AbortSignal, stopped!: () => void;
	const done = new Promise<void>(resolve => { stopped = resolve; });
	const response = cloudInventoryResponse('owner', 'root', new Request('https://sync.test'), async (_owner, _root, _emit, signal) => {
		observed = signal!; await new Promise<void>(resolve => signal!.addEventListener('abort', () => resolve(), { once: true })); stopped();
	});
	await response.body!.cancel(); await done; assert.ok(observed.aborted);
});
