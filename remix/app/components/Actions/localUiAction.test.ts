import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceLocalUi } from './localUiAction';

test('local choices and counters change only this instance and respect bounds', () => {
	const defaults = { active: '1', on: true, count: 3 };
	let state = reduceLocalUi({}, defaults, { op: 'set', key: 'active', value: '2' });
	state = reduceLocalUi(state, defaults, { op: 'toggle', key: 'on' });
	state = reduceLocalUi(state, defaults, { op: 'increment', key: 'count', step: 10, max: 5 });
	assert.deepEqual(state, { active: '2', on: false, count: 5 });
	assert.deepEqual(defaults, { active: '1', on: true, count: 3 });
	assert.deepEqual(reduceLocalUi(state, defaults, { op: 'reset' }), {});
});

test('local actions cannot replace runtime authority or grow unbounded state', () => {
	const state = { active: '1' };
	for (const key of ['__proto__', 'constructor', 'prototype', 'viewer', 'query', 'last', 'result', 'a.b']) {
		assert.equal(reduceLocalUi(state, {}, { op: 'set', key, value: 'injected' }), state);
	}
	for (const value of [NaN, Infinity, {}, [], 'x'.repeat(2001)]) assert.equal(reduceLocalUi(state, {}, { op: 'set', key: 'active', value }), state);
	const full = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`k${i}`, i]));
	assert.equal(reduceLocalUi(full, {}, { op: 'set', key: 'extra', value: 1 }), full);
	assert.equal(reduceLocalUi(full, {}, { op: 'set', key: 'k1', value: 9 }).k1, 9);
});

test('cycles operate on a bounded declared set', () => {
	assert.deepEqual(reduceLocalUi({}, { tab: 'last' }, { op: 'cycle', key: 'tab', values: ['first', 'last'] }), { tab: 'first' });
	assert.deepEqual(reduceLocalUi({}, {}, { op: 'cycle', key: 'tab', values: [] }), {});
});
