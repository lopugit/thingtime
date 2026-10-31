import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCloudIndexFeed, readCloudIndexChanges, type CloudIndexChange } from './cloudIndexChanges.client';
import type { CloudInventoryPage } from './cloudInventoryPages';
import type { SyncEntry } from './reconcile';
const scope = { origin: 'https://cloud-index.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'device', rootId: 'connection' },
	rootId = 'cloud-root';
const folder = (path: string, version = '1'): SyncEntry => ({ path, id: 'folder-id', version, kind: 'folder', size: 0, sha256: null });
const feed = (cursor: number, changes: unknown[] = []) => ({
	ok: true,
	feed: { version: 1, rootId, rootRevision: 'root-1', cursor, changes, hasMore: false }
});
const snapshotPage = (path: string, ordinal = 0, totalEntries?: number): CloudInventoryPage => ({
	version: 1,
	generation: 'snapshot',
	rootId,
	rootRevision: 'root-1',
	ordinal,
	nodes: [{ kind: 'folder', path, id: 'folder-id', revision: '1', folderId: rootId }],
	...(totalEntries === undefined ? {} : { totalEntries })
});
const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => (resolve = r));
	return { promise, resolve };
};
test(
	'remote delta arrives during initial traversal, expands only its subtree, and checkpoints after durable frame consumption',
	{ timeout: 5000 },
	async () => {
		const seen = deferred(),
			checkpoints: { cursor: string; complete: boolean }[] = [],
			snapshots: (string | undefined)[] = [],
			calls: string[] = [];
		const input = {
			currentScope: () => scope,
			origin: () => scope.origin,
			requireCapability: async (feature: string, minimum: string) => {
				if (feature === 'api.files') assert.equal(minimum, '1.7.0');
			},
			fetch: async (target: any, init: any) => {
				const url = new URL(String(target));
				calls.push(url.search);
				assert.equal(init.headers['X-Thingtime-Expected-Actor'], 'owner');
				const after = url.searchParams.get('after');
				return Response.json(
					after === null ? feed(10) : after === '10' ? feed(11, [{ position: 11, entry: folder('Renamed', '2'), subtree: 'folder-id' }]) : feed(11)
				);
			},
			snapshot: async function* (subtree?: string) {
				snapshots.push(subtree);
				assert.ok(checkpoints.length, 'watermark must precede snapshot');
				if (subtree) return;
				await seen.promise;
				yield snapshotPage('Old');
			}
		};
		const frames = [];
		for await (const value of readCloudIndexChanges(scope, rootId, input, crypto.randomUUID(), 0, async () => true, {
			checkpoint: async (cursor, complete) => {
				checkpoints.push({ cursor, complete });
			}
		})) {
			frames.push(value);
			if (value.changes.some((change) => (change as CloudIndexChange).sourceKind === 'delta')) seen.resolve();
		}
		const changes = frames.flatMap((value) => value.changes as CloudIndexChange[]);
		assert.deepEqual(
			changes.map((change) => [change.entry.path, change.sourceKind, change.sourcePosition]),
			[
				['Renamed', 'delta', 11],
				['Old', 'snapshot', 10]
			]
		);
		assert.equal(frames.at(-1)?.state, 'complete');
		assert.deepEqual(checkpoints[0], { cursor: '10', complete: false });
		assert.deepEqual(checkpoints.at(-1), { cursor: '11', complete: true });
		assert.deepEqual(snapshots, [undefined, 'folder-id']);
		assert.ok(calls.some((value) => value.includes('after=10')));
	}
);
test('a resumed completed snapshot consumes only durable deltas with fresh dense operation sequences', { timeout: 5000 }, async () => {
	const positions: string[] = [],
		captureId = crypto.randomUUID();
	let snapshots = 0;
	const input = {
		currentScope: () => scope,
		origin: () => scope.origin,
		requireCapability: async () => {},
		fetch: async (target: any) => {
			const url = new URL(String(target)),
				after = Number(url.searchParams.get('after'));
			assert.ok(url.searchParams.has('after'));
			return Response.json(after === 11 ? feed(12, [{ position: 12, entry: folder('new', '3'), subtree: 'folder-id' }]) : feed(12));
		},
		snapshot: async function* () {
			snapshots++;
		}
	};
	const rows = [];
	for await (const value of readCloudIndexChanges(scope, rootId, input, captureId, 5, async () => true, {
		cursor: '11',
		snapshotComplete: true,
		checkpoint: async (cursor) => {
			positions.push(cursor);
		}
	}))
		rows.push(...value.changes);
	assert.deepEqual(
		rows.map((value) => value.sequence),
		[6]
	);
	assert.equal(rows[0].entry.path, 'new');
	assert.equal(snapshots, 1, 'only the changed subtree expands');
	assert.equal(positions.at(-1), '12');
});
test('source transport backpressure bounds initial snapshot memory independently of tree size', { timeout: 5000 }, async () => {
	let read = 0;
	const input = {
		currentScope: () => scope,
		origin: () => scope.origin,
		requireCapability: async () => {},
		fetch: async () => Response.json(feed(0)),
		snapshot: async function* () {
			for (let i = 0; i < 100; i++) {
				read++;
				yield snapshotPage('folder-' + i, i, i === 99 ? 100 : undefined);
			}
		}
	};
	const iterator = readCloudIndexChanges(scope, rootId, input, crypto.randomUUID(), 0, async () => true, { checkpoint: async () => {} });
	await iterator.next();
	await new Promise((resolve) => setImmediate(resolve));
	assert.ok(read <= 5, `read ${read} source pages before consumer resumed`);
	let count = 0;
	for await (const value of iterator) count += value.changes.length;
	assert.equal(count, 100);
});
test('remote feed validation refuses foreign roots, absent boundaries, and invalid or unordered entries', () => {
	const valid = feed(11, [{ position: 11, entry: folder('new'), subtree: 'folder-id' }]).feed;
	assert.equal(parseCloudIndexFeed(valid, rootId, 10).cursor, 11);
	for (const patch of [
		{ rootId: 'other' },
		{ cursor: 9 },
		{ cursor: 10, changes: [], hasMore: true },
		{ changes: [{ position: 10, entry: folder('new'), subtree: 'folder-id' }] },
		{ changes: [{ position: 11, entry: folder('new'), subtree: null }] }
	])
		assert.throws(() => parseCloudIndexFeed({ ...valid, ...patch }, rootId, 10));
});

test('a failed subtree retains the prior durable Timeline cursor for replay', { timeout: 5000 }, async () => {
	const checkpoints: string[] = [];
	const input = {
		currentScope: () => scope,
		origin: () => scope.origin,
		requireCapability: async () => {},
		fetch: async (target: any) =>
			Response.json(
				new URL(String(target)).searchParams.has('after')
					? feed(11, [{ position: 11, entry: folder('changed', '2'), subtree: 'folder-id' }])
					: feed(10)
			),
		snapshot: async function* (subtree?: string) {
			if (subtree) throw Error('subtree transport interrupted');
		}
	};
	await assert.rejects(async () => {
		for await (const _ of readCloudIndexChanges(scope, rootId, input, crypto.randomUUID(), 0, async () => true, {
			checkpoint: async (cursor) => {
				checkpoints.push(cursor);
			}
		})) {
			/* Consumer durably accepts each observation before pulling again. */
		}
	}, /subtree transport interrupted/);
	assert.ok(checkpoints.length > 0);
	assert.ok(
		checkpoints.every((cursor) => cursor === '10'),
		'incomplete subtree must replay from the earlier watermark'
	);
});

test('revoked scope aborts a concurrent snapshot and refuses a late remote response', { timeout: 5000 }, async () => {
	let revoked = false,
		closed = false;
	const input = {
		currentScope: () => (revoked ? { ...scope, ownerId: 'other' } : scope),
		origin: () => scope.origin,
		requireCapability: async () => {},
		fetch: async (target: any) => {
			if (new URL(String(target)).searchParams.has('after')) revoked = true;
			return Response.json(feed(10));
		},
		snapshot: async function* (_subtree?: string, signal?: AbortSignal) {
			try {
				await new Promise<void>((resolve) => {
					signal!.addEventListener('abort', () => resolve(), { once: true });
					if (signal!.aborted) resolve();
				});
			} finally {
				closed = true;
			}
		}
	};
	await assert.rejects(async () => {
		for await (const _ of readCloudIndexChanges(scope, rootId, input, crypto.randomUUID(), 0, async () => true, { checkpoint: async () => {} })) {
		}
	}, /context changed/);
	assert.equal(closed, true);
});
