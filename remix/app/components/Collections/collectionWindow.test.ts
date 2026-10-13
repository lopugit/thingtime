import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectionWindow } from './collectionWindow';

test('all supported sizes cover every result once across pages', () => {
	for (const size of [5, 10, 15, 20] as const) {
		const records = Array.from({ length: 47 }, (_, n) => n);
		const seen = [];
		for (let page = 1; page <= Math.ceil(records.length / size); page++) {
			const window = collectionWindow(records.length, size, page);
			seen.push(...records.slice(window.start, window.end));
		}
		assert.deepEqual(seen, records);
	}
});
test('filtering or deleting the final page cannot leave an empty out-of-range page', () => {
	assert.deepEqual(collectionWindow(6, 5, 8), { page: 2, pages: 2, start: 5, end: 6, pageSize: 5 });
	assert.equal(collectionWindow(0, 20, 9).start, 0);
	assert.equal(collectionWindow(3, 5, -1).page, 1);
});
test('infinite mode reveals cumulative batches without skipping earlier results', () => {
	assert.equal(collectionWindow(47, 'infinite', 4, 10).start, 0);
	assert.equal(collectionWindow(47, 'infinite', 4, 20).end, 20);
	assert.equal(collectionWindow(47, 'infinite', 4, 60).end, 47);
});
