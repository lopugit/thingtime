// Regression coverage for the persisted-state codec — the security fixes in
// TODO/claude-todo/09-security-hardening.md §C (no eval on persisted functions)
// and §D (no Date.parse corruption of plain strings).
//
// Runs in plain Node (no test framework): `node --test` picks up the `test()`
// calls via node:test, or run directly with `node app/Providers/...test.ts`.
// Wired as `npm run test:persist`.

import assert from 'node:assert/strict';
import test from 'node:test';

import { parse, reviver, stringify } from './thingtimePersistCodec.ts';

const roundtrip = (value: unknown): any => parse(stringify(value));

test('plain strings that merely look date-ish survive a round-trip unchanged', () => {
	const input = {
		a: 'Post 1',
		b: '1',
		c: '2024',
		d: 'March 2024',
		e: '5 April',
		f: 'hello world',
		g: '2024-03-15' // bare date, no time component — must stay a string
	};
	const out = roundtrip(input);
	for (const key of Object.keys(input)) {
		assert.equal(typeof out[key], 'string', `${key} should still be a string`);
		assert.equal(out[key], (input as any)[key], `${key} value should be unchanged`);
	}
});

test('strings stay strings across TWO save/reload cycles (no corruption drift)', () => {
	const once = roundtrip({ title: 'Post 1', year: '2024' });
	const twice = roundtrip(once);
	assert.equal(twice.title, 'Post 1');
	assert.equal(twice.year, '2024');
});

test('a real Date revives as a Date and preserves its instant', () => {
	const now = new Date('2024-03-15T10:00:00.000Z');
	const out = roundtrip({ createdAt: now });
	assert.ok(out.createdAt instanceof Date, 'should revive to a Date');
	assert.equal(out.createdAt.getTime(), now.getTime());
});

test('full ISO-8601 timestamp strings revive to Dates; offsets accepted', () => {
	assert.ok(reviver('k', '2024-03-15T10:00:00.000Z') instanceof Date);
	assert.ok(reviver('k', '2024-03-15T10:00:00+10:00') instanceof Date);
	assert.equal(typeof reviver('k', '2024-03-15'), 'string');
	assert.equal(typeof reviver('k', 'not a date'), 'string');
});

test('functions never persist and never revive (no eval on storage)', () => {
	const out = roundtrip({ handler: () => 42, nested: { fn: function named() {} } });
	assert.equal(out.handler, undefined, 'function value should be dropped');
	assert.equal(out.nested.fn, undefined, 'nested function value should be dropped');
});

test('a hostile persisted {ttype:function} payload is dropped, not eval\'d', () => {
	// Simulate what an attacker who can write same-origin storage would plant.
	// The serialized form is what flatted produces; the reviver must ignore it.
	const planted = reviver('payload', {
		ttype: 'function',
		code: '(() => { globalThis.__pwned = true; })()',
		ttScope: {}
	});
	assert.equal(planted, undefined, 'ttype:function payload must be dropped');
	assert.equal((globalThis as any).__pwned, undefined, 'payload must not have executed');
});
