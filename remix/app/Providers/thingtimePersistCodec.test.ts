// Regression coverage for the persisted-state codec — the security fixes in
// TODO/claude-todo/09-security-hardening.md §C (no eval on persisted functions)
// and §D (no Date.parse corruption of plain strings).
//
// Runs with Node's built-in test runner through the TypeScript loader, wired as
// `npm run test:persist` (`node --import tsx --test ...`).

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

test('LEGACY bare Date.toISOString output revives, but broader timestamp text stays a string', () => {
	// pre-tagging persists stored real Dates as bare ISO strings — the reviver
	// keeps migrating that exact historical shape. Date.toJSON never emitted
	// offsets or shortened fractions, so those old values can only be user text.
	assert.ok(reviver('k', '2024-03-15T10:00:00.000Z') instanceof Date);
	assert.equal(typeof reviver('k', '2024-03-15T10:00:00+10:00'), 'string');
	assert.equal(typeof reviver('k', '2024-03-15T10:00:00.1Z'), 'string');
	assert.equal(typeof reviver('k', '2024-03-15'), 'string');
	assert.equal(typeof reviver('k', 'not a date'), 'string');

	const out = roundtrip({ offset: '2024-03-15T10:00:00+10:00' });
	assert.equal(out.offset, '2024-03-15T10:00:00+10:00');
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

test('tagged {ttype:date} payloads revive; malformed tag-shaped user objects survive', () => {
	assert.ok(reviver('k', { ttype: 'date', iso: '2024-03-15T10:00:00.000Z' }) instanceof Date);
	const malformedDate = { ttype: 'date', iso: 'garbage', label: 'keep me' };
	const incompleteDate = { ttype: 'date', label: 'also keep me' };
	const malformedString = { ttype: 'iso-string', s: 42, label: 'keep this too' };
	assert.deepEqual(reviver('k', malformedDate), malformedDate);
	assert.deepEqual(reviver('k', incompleteDate), incompleteDate);
	assert.deepEqual(reviver('k', malformedString), malformedString);
	assert.equal(reviver('k', { ttype: 'iso-string', s: '2024-03-15T10:00:00.000Z' }), '2024-03-15T10:00:00.000Z');
	assert.deepEqual(roundtrip({ malformedDate, incompleteDate, malformedString }), {
		malformedDate,
		incompleteDate,
		malformedString
	});
});

test('circular references survive and invalid Dates degrade to null without throwing', () => {
	const input: any = { invalid: new Date('not-a-date') };
	input.self = input;
	const out = roundtrip(input);
	assert.equal(out.invalid, null);
	assert.equal(out.self, out);
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
