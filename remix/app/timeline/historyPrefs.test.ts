import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_HISTORY_PREFS, HISTORY_PAUSED_THINGS_MAX, HISTORY_RETENTION, HISTORY_THING_ID_PATTERN, applyHistoryPrefsPatch, parseHistoryPrefs, parseHistoryPrefsPatch } from './historyPrefs.ts';

const ids = (count: number, prefix = 'thing') => Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
const longId = (n: number) => `${String(n).padStart(4, '0')}${'x'.repeat(196)}`;

test('stored records read leniently: invalid or unknown input falls back to fresh defaults', () => {
	assert.deepEqual(DEFAULT_HISTORY_PREFS, { syncHold: false, retention: 'forever', pausedThingIds: [] });
	assert.ok(Object.isFrozen(DEFAULT_HISTORY_PREFS));
	for (const stored of [undefined, null, 'held', 7, [], { syncHold: 'yes', retention: 'weekly', pausedThingIds: 'page-1' }]) assert.deepEqual(parseHistoryPrefs(stored), DEFAULT_HISTORY_PREFS);
	assert.notEqual(parseHistoryPrefs(undefined).pausedThingIds, DEFAULT_HISTORY_PREFS.pausedThingIds);
	assert.deepEqual(parseHistoryPrefs({ syncHold: true, retention: '90d', pausedThingIds: ['page-1', 'bad id', 7, 'page-1', '', '-lead', 'page-2'], extra: 'ignored' }), { syncHold: true, retention: '90d', pausedThingIds: ['page-1', 'page-2'] });
	assert.equal(parseHistoryPrefs({ pausedThingIds: ids(HISTORY_PAUSED_THINGS_MAX + 5) }).pausedThingIds.length, HISTORY_PAUSED_THINGS_MAX);
	for (const retention of HISTORY_RETENTION) assert.equal(parseHistoryPrefs({ retention }).retention, retention);
});

test('the Thing id rule mirrors the Timeline contract: 200 characters, no leading punctuation, no whitespace', () => {
	for (const id of ['a', 'page-1', 'A.b_c:d@e/f', longId(1)]) assert.ok(HISTORY_THING_ID_PATTERN.test(id), id);
	for (const id of ['', '-page', '.page', 'page 1', 'page\n1', `${longId(1)}x`, 'pa$ge']) assert.equal(HISTORY_THING_ID_PATTERN.test(id), false, id);
});

test('patch validation is strict about keys, types, ids, list size and no-op patches', () => {
	assert.deepEqual(parseHistoryPrefsPatch({ syncHold: true }), { syncHold: true });
	assert.deepEqual(parseHistoryPrefsPatch({ retention: 'named', pause: ['page-1', 'page-1', 'page-2'], resume: ['page-3'] }), { retention: 'named', pause: ['page-1', 'page-2'], resume: ['page-3'] });
	assert.deepEqual(parseHistoryPrefsPatch({ pause: ids(HISTORY_PAUSED_THINGS_MAX) }).pause?.length, HISTORY_PAUSED_THINGS_MAX);
	const refused: Array<[unknown, RegExp]> = [
		[undefined, /prefs must be an object/], [null, /prefs must be an object/], [[], /prefs must be an object/], ['held', /prefs must be an object/],
		[{}, /patch is empty/], [{ pause: [] }, /patch is empty/], [{ pause: [], resume: [] }, /patch is empty/],
		[{ pausedThingIds: ['page-1'] }, /Unknown history preference: pausedThingIds/], [{ syncHold: true, [`${'k'.repeat(60)}`]: 1 }, new RegExp(`Unknown history preference: ${'k'.repeat(40)}$`)],
		[{ syncHold: 'true' }, /syncHold must be true or false/], [{ syncHold: null }, /syncHold must be true or false/],
		[{ retention: 'weekly' }, /retention must be one of forever, 90d, named/], [{ retention: null }, /retention must be one of/],
		[{ pause: 'page-1' }, /pause must be a list of Thing ids/], [{ resume: { id: 'page-1' } }, /resume must be a list of Thing ids/],
		[{ pause: ['page-1', '-bad'] }, /pause contains an invalid Thing id/], [{ resume: [7] }, /resume contains an invalid Thing id/], [{ pause: [`${longId(1)}x`] }, /pause contains an invalid Thing id/],
		[{ pause: ids(HISTORY_PAUSED_THINGS_MAX + 1) }, /pause lists at most 200 Thing ids/], [{ resume: ids(HISTORY_PAUSED_THINGS_MAX + 1) }, /resume lists at most 200 Thing ids/]
	];
	for (const [input, pattern] of refused) assert.throws(() => parseHistoryPrefsPatch(input), (error: any) => error instanceof TypeError && pattern.test(error.message), JSON.stringify(input)?.slice(0, 80));
	assert.throws(() => parseHistoryPrefsPatch({ pause: ids(HISTORY_PAUSED_THINGS_MAX + 1) }), (error: any) => !(error instanceof RangeError));
});

test('applying a patch merges scalars and computes union(pause) minus resume in first-seen order, without touching the input', () => {
	const current = { syncHold: false, retention: 'forever' as const, pausedThingIds: ['page-1', 'page-2'] };
	const next = applyHistoryPrefsPatch(current, { syncHold: true, pause: ['page-3', 'page-1', 'page-4'], resume: ['page-2', 'page-4', 'missing'] });
	assert.deepEqual(next, { syncHold: true, retention: 'forever', pausedThingIds: ['page-1', 'page-3'] });
	assert.deepEqual(current, { syncHold: false, retention: 'forever', pausedThingIds: ['page-1', 'page-2'] });
	assert.deepEqual(applyHistoryPrefsPatch(current, { retention: '90d' }), { syncHold: false, retention: '90d', pausedThingIds: ['page-1', 'page-2'] });
	assert.deepEqual(applyHistoryPrefsPatch(current, { syncHold: false }), current);
	assert.deepEqual(applyHistoryPrefsPatch(current, { resume: ['page-1', 'page-2'] }).pausedThingIds, []);
	assert.deepEqual(applyHistoryPrefsPatch(DEFAULT_HISTORY_PREFS, { pause: ['page-9'] }), { syncHold: false, retention: 'forever', pausedThingIds: ['page-9'] });
	assert.deepEqual(DEFAULT_HISTORY_PREFS.pausedThingIds, []);
});

test('the paused list is capped at 200 across the stored and patched ids; a refused patch applies nothing', () => {
	const full = { ...DEFAULT_HISTORY_PREFS, pausedThingIds: ids(HISTORY_PAUSED_THINGS_MAX) };
	assert.equal(applyHistoryPrefsPatch(full, { pause: ['thing-0', 'thing-199'] }).pausedThingIds.length, HISTORY_PAUSED_THINGS_MAX);
	assert.equal(applyHistoryPrefsPatch(full, { pause: ['thing-200'], resume: ['thing-0'] }).pausedThingIds.length, HISTORY_PAUSED_THINGS_MAX);
	assert.throws(() => applyHistoryPrefsPatch(full, { pause: ['thing-200'] }), (error: any) => error instanceof RangeError && /Too many paused Things \(max 200\)/.test(error.message));
	assert.throws(() => applyHistoryPrefsPatch({ ...DEFAULT_HISTORY_PREFS, pausedThingIds: ids(150) }, { pause: ids(51, 'other'), resume: ['none'] }), RangeError);
	assert.equal(full.pausedThingIds.length, HISTORY_PAUSED_THINGS_MAX);
	assert.equal(applyHistoryPrefsPatch({ ...DEFAULT_HISTORY_PREFS, pausedThingIds: ids(150) }, { pause: ids(50, 'other') }).pausedThingIds.length, HISTORY_PAUSED_THINGS_MAX);
});
