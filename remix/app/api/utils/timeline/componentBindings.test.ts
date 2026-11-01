import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimelineComponentReader, readRecordedComponentEntries } from './service';
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


test('combined component reads preflight all unique records before bounded payload batches', async () => {
 const events = Array.from({ length: 260 }, (_, index) => captureComponentBindings(base, { [`ref-${index}`]: null }, [], () => `capture-${index}`).events[0]);
 const wanted = events.map(event => ({ thingId: event.thingId, eventId: event.id }));
 const reads: string[][] = []; let metadataReads = 0;
 const collection = { find: () => { metadataReads++; return { toArray: async () => events.map(() => ({ timelineEntryBytes: 1000 })) }; } };
 const reader = async (_things: any, _owner: string, ids: string[]) => { reads.push(ids); return events.filter(event => ids.includes(event.id)).map(event => entryFixture(event)); };
 await assert.rejects(readRecordedComponentEntries(collection, base.ownerId, wanted, reader, 100_000), /too large/);
 assert.equal(reads.length, 0);
 const result = await readRecordedComponentEntries(collection, base.ownerId, [...wanted, wanted[0]], reader, 300_000);
 assert.equal(result.length, 260); assert.deepEqual(reads.map(batch => batch.length), [128, 128, 4]); assert.equal(metadataReads, 2);
 await assert.rejects(readRecordedComponentEntries(collection, base.ownerId, wanted, async () => events.map(event => entryFixture({ ...event, ownerId: 'other' })), 300_000), /incomplete/);
});
