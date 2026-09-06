import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { compareCommentsFor, controversyScore, hotScore, orderCommentPage, parseCommentSort, parseUpdownDirection, risingScore, tallyUpdown, updownKeyOf } from './updownCore.ts';

test('tallyUpdown counts ups/downs, nets the score, and reports the viewer vote', () => {
	const votes = tallyUpdown(
		[
			{ userId: 'a', direction: 'up' },
			{ userId: 'b', direction: 'up' },
			{ userId: 'c', direction: 'down' },
			// malformed doc — ignored, never NaN
			{ userId: 'd', direction: 'sideways' as any }
		],
		'c'
	);
	assert.deepEqual(votes, { up: 2, down: 1, score: 1, viewerVote: 'down' });
	assert.deepEqual(tallyUpdown([], null), { up: 0, down: 0, score: 0, viewerVote: null });
	assert.equal(tallyUpdown([{ userId: 'a', direction: 'up' }], 'zed').viewerVote, null);
});

test('updownKeyOf is the <target>~<user> pair (disjoint from poll voteKey namespaces by field name)', () => {
	assert.equal(updownKeyOf('post-1', 'user-9'), 'post-1~user-9');
});

test('parseUpdownDirection accepts up/down, clears on null-ish, rejects anything else', () => {
	assert.deepEqual(parseUpdownDirection('up'), { ok: true, direction: 'up' });
	assert.deepEqual(parseUpdownDirection('down'), { ok: true, direction: 'down' });
	for (const clear of [null, undefined, '', 'none', 'clear']) assert.deepEqual(parseUpdownDirection(clear), { ok: true, direction: null });
	for (const bad of ['UP', 'upvote', 1, true, {}, []]) assert.equal(parseUpdownDirection(bad).ok, false, JSON.stringify(bad));
});

test('hotScore favours score by orders of magnitude and newer posts at equal score', () => {
	const now = Date.UTC(2026, 8, 5, 12, 0, 0);
	const hourAgo = now - 3_600_000;
	assert.ok(hotScore(10, now) > hotScore(1, now));
	assert.ok(hotScore(0, now) > hotScore(0, hourAgo));
	// 10× the score is worth one order (1.0); 12.5h of age is worth one order too
	assert.ok(Math.abs(hotScore(10, now) - hotScore(1, now) - 1) < 1e-9);
	assert.ok(hotScore(-5, now) < hotScore(0, now));
});

test('controversyScore needs both sides and peaks when split evenly', () => {
	assert.equal(controversyScore(10, 0), 0);
	assert.equal(controversyScore(0, 10), 0);
	assert.ok(controversyScore(10, 10) > controversyScore(19, 1));
	assert.ok(controversyScore(100, 100) > controversyScore(10, 10));
});

test('risingScore decays with age and never rewards negative scores', () => {
	const now = Date.UTC(2026, 8, 5, 12, 0, 0);
	assert.ok(risingScore(5, now, now) > risingScore(5, now - 6 * 3_600_000, now));
	assert.equal(risingScore(-3, now, now), risingScore(0, now, now));
	assert.ok(risingScore(0, now, now) > 0);
});

test('parseCommentSort: absent → the default page (null), top/new/old → itself, anything else → an error the route 400s', () => {
	for (const empty of [null, undefined, '']) assert.deepEqual(parseCommentSort(empty), { ok: true, sort: null });
	for (const sort of ['top', 'new', 'old']) assert.deepEqual(parseCommentSort(sort), { ok: true, sort });
	for (const bad of ['best', 'TOP', 'hot', 1, {}]) assert.equal(parseCommentSort(bad).ok, false, String(bad));
});

test('orderCommentPage: null ships the newest `limit` oldest-first (unchanged), old/new/top order the WHOLE level and ship the first `limit`', () => {
	// arrival order is chronological (the merge's order); scores are the
	// relational tallies — the highest-scoring comment is the OLDEST here so a
	// "top" page can never be the newest page re-shuffled
	const level = [
		{ id: 'c1', createdAtMs: 1000, score: 5 },
		{ id: 'c2', createdAtMs: 2000, score: -1 },
		{ id: 'c3', createdAtMs: 3000, score: 2 },
		{ id: 'c4', createdAtMs: 4000, score: 2 },
		{ id: 'c5', createdAtMs: 5000, score: 0 }
	];
	const ids = (entries: { id: string }[]) => entries.map((entry) => entry.id);
	assert.deepEqual(ids(orderCommentPage(level, null, 3)), ['c3', 'c4', 'c5'], 'default: the trailing slice, oldest → newest');
	assert.deepEqual(ids(orderCommentPage(level, 'old', 3)), ['c1', 'c2', 'c3']);
	assert.deepEqual(ids(orderCommentPage(level, 'new', 3)), ['c5', 'c4', 'c3']);
	// top: score desc, then the older of a tie first, then id — c1 (5), c3 (2, older), c4 (2), c5 (0), c2 (-1)
	assert.deepEqual(ids(orderCommentPage(level, 'top', 5)), ['c1', 'c3', 'c4', 'c5', 'c2']);
	assert.deepEqual(ids(orderCommentPage(level, 'top', 2)), ['c1', 'c3'], 'top ships the best of the level, not the newest');
	// the input is never mutated and the order does not depend on arrival order
	const shuffled = [level[4], level[1], level[3], level[0], level[2]];
	assert.deepEqual(ids(orderCommentPage(shuffled, 'top', 5)), ['c1', 'c3', 'c4', 'c5', 'c2']);
	assert.deepEqual(ids(shuffled), ['c5', 'c2', 'c4', 'c1', 'c3']);
	assert.deepEqual(ids(orderCommentPage([], 'top', 20)), []);
});

test('compareCommentsFor(top) breaks a score tie by age, never by arrival', () => {
	const compare = compareCommentsFor('top');
	assert.ok(compare({ id: 'b', createdAtMs: 1, score: 1 }, { id: 'a', createdAtMs: 2, score: 1 }) < 0, 'older first at equal score');
	assert.ok(compare({ id: 'a', createdAtMs: 9, score: 3 }, { id: 'b', createdAtMs: 1, score: 1 }) < 0, 'higher score first regardless of age');
	assert.ok(compare({ id: 'a', createdAtMs: 1, score: 0 }, { id: 'b', createdAtMs: 1, score: 0 }) < 0, 'id is the last resort');
});
