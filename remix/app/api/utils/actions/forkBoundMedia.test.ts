import assert from 'node:assert/strict';
import test from 'node:test';
import { createListForkBoundMedia } from './forkBoundMedia';

test('bound-media discovery batches exact owner/target pairs and excludes non-post purposes', async () => {
	let calls = 0, query: any, options: any, limit = 0, sort: any;
	const list = createListForkBoundMedia((async () => ({ find: (q: any, o: any) => {
		calls++; query = q; options = o;
		return { sort: (s: any) => { sort = s; return { limit: (n: number) => { limit = n; return { toArray: async () => [
			{ shareId: 'file', ownerId: 'owner', targetId: 'page' },
			{ shareId: 'first', ownerId: 'owner', targetId: 'page', attachmentSortIndex: 0 },
			{ shareId: 'foreign', ownerId: 'other', targetId: 'page' }
		] }; } }; } };
	} })) as any);
	assert.deepEqual(await list([]), []);
	assert.equal(calls, 0);
	assert.deepEqual(await list([{ shareId: 'page', ownerId: 'owner' }, { shareId: 'data', ownerId: 'other' }] as any), [{ id: 'first', targetId: 'page' }, { id: 'file', targetId: 'page' }]);
	assert.equal(calls, 1);
	assert.equal(limit, 51);
	assert.deepEqual(query, { thingtime: 'attachment', attachmentState: 'ready', $and: [
		{ $or: [{ targetId: 'page', ownerId: 'owner' }, { targetId: 'data', ownerId: 'other' }] },
		{ $or: [{ attachmentPurpose: 'post' }, { attachmentPurpose: { $exists: false } }] }
	] });
	assert.deepEqual(options.projection, { shareId: 1, ownerId: 1, targetId: 1, attachmentSortIndex: 1 });
	assert.deepEqual(sort, { createdAt: 1, shareId: 1 });
});
