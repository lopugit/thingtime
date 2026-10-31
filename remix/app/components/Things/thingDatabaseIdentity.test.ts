import assert from 'node:assert/strict';
import test from 'node:test';
import { isDataPlane, scopedThingCacheKey, thingHistoryHref } from '../../utils/dataPlane';

test('a history link pins its account and database without carrying credentials', () => {
	const href = new URL(thingHistoryHref('thing/a', 'home', 'account-1'), 'https://thingtime.test');
	assert.equal(href.pathname, '/thing/thing%2Fa');
	assert.equal(href.searchParams.get('dataPlane'), 'home');
	assert.equal(href.searchParams.get('historyOwner'), 'account-1');
	assert.throws(() => thingHistoryHref('id', 'mongodb://private', 'account'), /Unknown/);
});

test('matching Thing ids never share caches across accounts or databases, and ambiguous scopes cannot seed', () => {
	const custom = `custom-${'a'.repeat(64)}`;
	assert.equal(isDataPlane(custom), true); assert.equal(isDataPlane('custom-home'), false);
	assert.equal(scopedThingCacheKey('one', undefined, 'same-id'), null);
	const keys = [scopedThingCacheKey('one', 'home', 'same-id'), scopedThingCacheKey('two', 'home', 'same-id'),
		scopedThingCacheKey('one', custom, 'same-id'), scopedThingCacheKey(null, 'home', 'same-id')];
	assert.equal(new Set(keys).size, keys.length);
	assert.ok(keys.every(key => key?.startsWith('tt-thing-v2-')));
});
