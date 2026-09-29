import assert from 'node:assert/strict';
import test from 'node:test';
import { createRelatedTimelineReader } from './relatedHistory';

const request = { thingId: 'page', before: null, after: null, limit: 40, related: true as const };
test('related history uses the authorized composition but never reads another author’s event graph', async () => {
	const root = { ownerId: 'owner', shareId: 'page', thingtime: ['webpage'] };
	const own = { ownerId: 'owner', shareId: 'component', thingtime: ['component'] };
	const foreign = { ownerId: 'other', shareId: 'shared', thingtime: ['component'] };
	const calls: any[] = [];
	const docs = new Map<string, any>([
		['page', root],
		['component', own],
		['shared', foreign]
	]);
	const read = createRelatedTimelineReader({
		collection: async () =>
			({
				findOne: async (query: any) => {
					assert.deepEqual(query, { ownerId: 'owner', shareId: 'page', thingtime: 'webpage' });
					return root;
				}
			} as any),
		resolve: async (viewer, id) => {
			assert.deepEqual(viewer, { id: 'owner' });
			assert.equal(id, 'page');
			return { root, docs } as any;
		},
		page: async (_things, owner, query, targets) => {
			calls.push({ owner, query, targets });
			return { entries: [], nextBefore: null, nextAfter: null };
		}
	});
	const first = await read('owner', request);
	assert.deepEqual(first.related.thingIds, ['component', 'page']);
	assert.equal(first.related.sharedCount, 1);
	assert.equal(first.reset, undefined);
	assert.deepEqual(calls[0].targets, ['component', 'page']);
	const cursor = { ...request, after: 100, relatedRevision: first.related.revision };
	await read('owner', cursor);
	assert.equal(calls[1].query.after, 100);
	docs.set('older-component', { ...own, shareId: 'older-component' });
	const changed = await read('owner', cursor);
	assert.equal(changed.reset, true);
	assert.equal(calls[2].query.after, null);
	assert.equal(calls[2].query.before, null);
	assert.notEqual(changed.related.revision, first.related.revision);
	// Removing a dependency also invalidates an older-page cursor.
	docs.delete('component');
	const removed = await read('owner', { ...request, before: 50, relatedRevision: changed.related.revision });
	assert.equal(removed.reset, true);
	assert.deepEqual(calls[3].targets, ['older-component', 'page']);
});

test('unowned roots, invalid cursors and failed composition authorization never read Timeline rows', async () => {
	let resolveCalls = 0;
	let pageCalls = 0;
	let exists = false;
	const read = createRelatedTimelineReader({
		collection: async () => ({ findOne: async () => (exists ? {} : null) } as any),
		resolve: async () => {
			resolveCalls++;
			return { ok: false, status: 404, error: 'Not found' } as any;
		},
		page: async () => {
			pageCalls++;
			throw new Error('must not read');
		}
	});
	await assert.rejects(read('owner', { ...request, after: 1 }), /Invalid/);
	await assert.rejects(read('owner', request), /owned page/);
	assert.equal(resolveCalls, 0);
	exists = true;
	await assert.rejects(read('owner', request), /Not found/);
	assert.equal(pageCalls, 0);
});
