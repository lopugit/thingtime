import test from 'node:test';
import assert from 'node:assert/strict';
import { appendCollectionPage, collectionSource } from './collectionSource';

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
test('bounded pages, bytes and distinct rows; nested mappings remain data-only', () => {
	const custom = collectionSource({ action: 'read', itemsPath: 'data.rows', cursorPath: 'data.next', itemKey: 'record.key', cursorInput: 'after' })!;
	assert.equal(appendCollectionPage(custom, { data: { rows: [{ record: { key: 0 } }] } }).items.length, 1);
	assert.throws(() => appendCollectionPage(source, { items: [{ id: 'a', text: 'x'.repeat(4 * 1024 * 1024) }] }), /4 MB/);
	assert.throws(() => appendCollectionPage(source, { items: Array.from({ length: 10001 }, (_, id) => ({ id })) }), /10,000/);
	let pages = appendCollectionPage(source, { items: [], nextCursor: '1' });
	for (let i = 2; i <= 200; i++) pages = appendCollectionPage(source, { items: [], nextCursor: String(i) }, pages);
	assert.throws(() => appendCollectionPage(source, { items: [] }, pages), /200 pages/);
});
test('source config rejects unsafe paths, non-scalar inputs and unresolved Actions', () => {
	assert.equal(collectionSource(undefined), null);
	for (const value of [{ action: '{item.action}' }, { action: 'x', inputs: { nested: {} } }, { action: 'x', cursorInput: 'a.b' }, { action: 'x', itemsPath: '__proto__.x' }, { action: 'x', inputs: { n: Infinity } }])
		assert.throws(() => collectionSource(value));
});
