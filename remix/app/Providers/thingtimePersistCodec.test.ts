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

test('LEGACY bare ISO-8601 timestamp strings still revive to Dates; offsets accepted', () => {
	// pre-tagging persists stored real Dates as bare ISO strings — the reviver
	// keeps migrating them (new persists tag Dates and escape lookalike strings)
	assert.ok(reviver('k', '2024-03-15T10:00:00.000Z') instanceof Date);
	assert.ok(reviver('k', '2024-03-15T10:00:00+10:00') instanceof Date);
	assert.equal(typeof reviver('k', '2024-03-15'), 'string');
	assert.equal(typeof reviver('k', 'not a date'), 'string');
});

test('a USER string that looks like a full ISO timestamp survives round-trips as a string', () => {
	// the corruption class TODO 9 is about: with tagging + escaping, even a
	// perfect ISO-lookalike user string can no longer be confused with a Date
	const input = { pasted: '2026-07-21T03:46:23.955Z' };
	const once = roundtrip(input);
	assert.equal(typeof once.pasted, 'string', 'should still be a string after one cycle');
	assert.equal(once.pasted, input.pasted);
	const twice = roundtrip(once);
	assert.equal(typeof twice.pasted, 'string', 'should still be a string after two cycles');
	assert.equal(twice.pasted, input.pasted);
});

test('a Date and an identical-looking user string coexist and each keep their type', () => {
	const instant = '2024-03-15T10:00:00.000Z';
	const out = roundtrip({ real: new Date(instant), fake: instant });
	assert.ok(out.real instanceof Date);
	assert.equal(out.real.toISOString(), instant);
	assert.equal(typeof out.fake, 'string');
	assert.equal(out.fake, instant);
});

test('tagged {ttype:date} payloads revive; malformed tags degrade without throwing', () => {
	assert.ok(reviver('k', { ttype: 'date', iso: '2024-03-15T10:00:00.000Z' }) instanceof Date);
	assert.equal(reviver('k', { ttype: 'date', iso: 'garbage' }), 'garbage');
	assert.equal(reviver('k', { ttype: 'date' }), undefined);
	assert.equal(reviver('k', { ttype: 'iso-string', s: '2024-03-15T10:00:00.000Z' }), '2024-03-15T10:00:00.000Z');
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
