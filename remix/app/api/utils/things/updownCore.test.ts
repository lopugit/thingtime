import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { controversyScore, hotScore, parseUpdownDirection, risingScore, tallyUpdown, updownKeyOf } from './updownCore.ts';

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
