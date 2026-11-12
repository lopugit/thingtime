import assert from 'node:assert/strict';
import test from 'node:test';
import { readRelatedHistoryCache, writeRelatedHistoryCache, clearRelatedHistoryCache } from './relatedHistoryCache';
import { readHistoryFilters, writeHistoryFilters } from './browserModel';
test('related membership cache is bounded and separated by account, origin and database', () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const values = new Map<string, string>();
	const localStorage = {
		get length() {
			return values.size;
		},
		key: (i: number) => [...values.keys()][i],
		getItem: (k: string) => values.get(k) ?? null,
		setItem: (k: string, v: string) => values.set(k, v),
		removeItem: (k: string) => values.delete(k)
	};
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } });
	try {
		const scope = { ownerId: 'owner', apiOrigin: 'https://example.test', dataPlane: 'home' };
		const related = { rootId: 'page', thingIds: ['page', 'component'], revision: 'a'.repeat(64), sharedCount: 1 };
		writeRelatedHistoryCache(scope, related);
		assert.deepEqual(readRelatedHistoryCache(scope, 'page'), related);
		for (const change of [{ ownerId: 'other' }, { apiOrigin: 'https://other.test' }, { dataPlane: 'custom-other' }])
			assert.equal(readRelatedHistoryCache({ ...scope, ...change }, 'page'), null);
		const key = [...values.keys()][0];
		values.set(key, JSON.stringify({ ...related, thingIds: ['component'] }));
		assert.equal(readRelatedHistoryCache(scope, 'page'), null);
		for (let i = 0; i < 12; i++) writeRelatedHistoryCache(scope, { ...related, rootId: `page-${i}`, thingIds: [`page-${i}`] });
		assert.equal(values.size, 8);
		assert.equal(readRelatedHistoryCache(scope, 'page'), null);
		assert.ok(readRelatedHistoryCache(scope, 'page-11'));
		clearRelatedHistoryCache(scope, 'page-11');
		assert.equal(readRelatedHistoryCache(scope, 'page-11'), null);
	} finally {
		if (previous) Object.defineProperty(globalThis, 'window', previous);
		else Reflect.deleteProperty(globalThis, 'window');
	}
});
test('related History URLs retain the root and look, but cannot select an unbounded related account stream', () => {
	const params = new URLSearchParams('storage=home&thing=page&scope=related&look=frames');
	const filters = readHistoryFilters(params);
	assert.equal(filters.related, true);
	assert.deepEqual(readHistoryFilters(writeHistoryFilters(params, filters)), filters);
	assert.equal(readHistoryFilters(new URLSearchParams('scope=related')).related, false);
	assert.equal(readHistoryFilters(new URLSearchParams('scope=related&thing=bad%20id')).related, false);
	assert.equal(writeHistoryFilters(params, { ...filters, related: false }).has('scope'), false);
	assert.equal(writeHistoryFilters(params, { ...filters, thingId: '' }).has('scope'), false);
});
