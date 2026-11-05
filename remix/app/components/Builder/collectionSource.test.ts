import test from 'node:test';
import assert from 'node:assert/strict';
import { appendCollectionPage, collectionOffsetPage, collectionSource } from './collectionSource';

const source = collectionSource({ action: 'read-page' })!;
test('empty pages retain their cursor and older rows append with stable-key deduplication', () => {
	const first = appendCollectionPage(source, { items: [{ id: 'a', text: 'old' }], nextCursor: 'one' });
	const empty = appendCollectionPage(source, { items: [], nextCursor: 'two' }, first);
	const final = appendCollectionPage(source, { items: [{ id: 'b' }, { id: 'a', text: 'new' }] }, empty);
	assert.deepEqual(final.items, [{ id: 'a', text: 'new' }, { id: 'b' }]);
	assert.equal(final.cursor, null);
	assert.equal(first.items[0].text, 'old');
	assert.equal(final.pages, 3);
});
test('repeated or cyclical cursors and malformed pages fail without destroying prior rows', () => {
	const first = appendCollectionPage(source, { items: [{ id: 'a' }], nextCursor: 'one' });
	const second = appendCollectionPage(source, { items: [], nextCursor: 'two' }, first);
	for (const result of [{ items: [], nextCursor: 'one' }, { items: [], nextCursor: {} }, { items: [{}] }, { items: [null] }, {}])
		assert.throws(() => appendCollectionPage(source, result, second));
	assert.deepEqual(second.items, [{ id: 'a' }]);
	assert.equal(second.cursor, 'two');
	assert.throws(() => appendCollectionPage(collectionSource({ action: 'read', inputs: { cursor: 'initial' } })!, { items: [], nextCursor: 'initial' }));
});
test('nested mappings and exact totals remain data-only without arbitrary collection caps', () => {
 const custom = collectionSource({ action: 'read', itemsPath: 'data.rows', cursorPath: 'data.next', itemKey: 'record.key', cursorInput: 'after', totalPath: 'data.total' })!;
 const first = appendCollectionPage(custom, { data: { rows: [{ record: { key: 0 } }], next: 'next', total: 10001 } });
 assert.equal(first.total, 10001);
 assert.equal(appendCollectionPage(custom, { data: { rows: [], total: 10001 } }, first).total, 10001);
 assert.throws(() => appendCollectionPage(custom, { data: { rows: [], total: -1 } }), /total/);
 assert.equal(appendCollectionPage(source, { items: Array.from({ length: 10001 }, (_, id) => ({ id })) }).items.length, 10001);
});
test('source config rejects unsafe paths, non-scalar inputs and unresolved Actions', () => {
	assert.equal(collectionSource(undefined), null);
	for (const value of [{ action: '{item.action}' }, { action: 'x', inputs: { nested: {} } }, { action: 'x', cursorInput: 'a.b' }, { action: 'x', itemsPath: '__proto__.x' }, { action: 'x', inputs: { n: Infinity } }])
		assert.throws(() => collectionSource(value));
});

test('offset pages must confirm their requested offset and size', () => {
 const spec = collectionSource({ action: 'read', offsetInput: 'offset', limitInput: 'limit' })!;
 assert.equal(collectionOffsetPage(spec, { offset: 20, items: [{ id: 20 }] }, 20, 10).items.length, 1);
 assert.throws(() => collectionOffsetPage(spec, { offset: 0, items: [] }, 20, 10), /confirm/);
 assert.throws(() => collectionOffsetPage(spec, { offset: 20, items: [{ id: 1 }, { id: 2 }] }, 20, 1), /page size/);
});
