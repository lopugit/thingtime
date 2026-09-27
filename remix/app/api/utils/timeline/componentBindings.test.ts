import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimelineComponentReader } from './service';
import { captureComponentBindings } from '../../../timeline/componentBindings';
import { eventFixture, entryFixture } from '../../../timeline/testFixtures';
const base = eventFixture('page');
const captured = captureComponentBindings(
	base,
	{ card: { id: 'card-id', crystal: { render: { tag: 'h2', children: 'Old' } } }, missing: null },
	[],
	(ref) => `capture-${ref}`
);
const page = entryFixture({ ...base, dependencies: captured.dependencies });
function setup(bytes: number[]) {
	const reads: string[][] = [];
	const queries: any[] = [];
	const collection = {
		find: (query: any, options: any) => {
			queries.push({ query, options });
			return { toArray: async () => bytes.map((timelineEntryBytes) => ({ timelineEntryBytes })) };
		}
	};
	const read = createTimelineComponentReader({
		collection: async () => collection as any,
		entries: async (_collection, ownerId, ids) => {
			assert.equal(ownerId, base.ownerId);
			reads.push(ids);
			return ids[0] === 'page'
				? [page]
				: captured.events.filter((event) => ids.includes(event.id)).map((event, index) => entryFixture(event, index + 2));
		}
	});
	return { read, reads, queries };
}
test('recorded component reader scopes metadata and payload batches to the owner and exact linked ids', async () => {
	const h = setup([1000, 1000]);
	const result = await h.read(base.ownerId, 'page');
	assert.equal(result?.entries.length, 2);
	assert.deepEqual(h.reads, [['page'], ['capture-card', 'capture-missing']]);
	assert.equal(h.queries.length, 1);
	assert.equal(h.queries[0].query.ownerId, base.ownerId);
	assert.equal(h.queries[0].query.thingtime, 'timeline-event');
	assert.deepEqual(h.queries[0].options.projection, { timelineEntryBytes: 1 });
});
test('oversized or damaged component metadata is refused before decoding payloads', async () => {
	for (const bytes of [[3 * 1024 * 1024, 3 * 1024 * 1024], [NaN, 100], [100]]) {
		const h = setup(bytes);
		await assert.rejects(h.read(base.ownerId, 'page'), /too large|metadata is incomplete/);
		assert.deepEqual(h.reads, [['page']]);
	}
});
test('an unavailable page does not query dependency metadata or borrow source component history', async () => {
	const read = createTimelineComponentReader({
		collection: async () =>
			({
				find: () => {
					throw new Error('must not read dependencies');
				}
			} as any),
		entries: async () => []
	});
	assert.equal(await read(base.ownerId, 'foreign'), null);
});
