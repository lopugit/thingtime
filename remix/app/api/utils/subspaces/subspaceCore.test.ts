import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import {
	confirmSlugMatches,
	privatizedPostUpdate,
	rankSubspacePosts,
	RELEASED_POST_UNSET,
	releaseKindFor,
	releasedPostUpdate,
	sanitizeBranding,
	sanitizeFlairs,
	sanitizeRules,
	sanitizeSlug,
	sanitizeTopRange,
	slugHoldState,
	slugifyFlairId,
	SUBSPACE_SLUG_HOLD_MS,
	topRangeSince
} from './subspaceCore.ts';

test('sanitizeSlug normalizes and enforces the /s/<slug> grammar', () => {
	assert.equal(sanitizeSlug(' Rainbow Makers '), 'rainbow_makers');
	assert.equal(sanitizeSlug('s/tools'), 'tools');
	assert.equal(sanitizeSlug('a-b-c'), 'a_b_c');
	for (const bad of ['ab', 'x'.repeat(31), 'has.dot', 'has/slash', '', 42, null, 'ünïcode']) {
		const result = sanitizeSlug(bad);
		assert.equal(typeof result === 'object' && result.ok === false, true, JSON.stringify(bad));
	}
	// reserved route words can't be claimed
	for (const reserved of ['all', 'mod', 'create', 'popular', 'settings']) {
		const result = sanitizeSlug(reserved);
		assert.equal(typeof result === 'object' && result.ok === false, true, reserved);
	}
});

test('sanitizeRules bounds count and shape, accepting plain strings', () => {
	assert.deepEqual(sanitizeRules(undefined), []);
	assert.deepEqual(sanitizeRules(['Be kind', { title: 'No spam', text: '  Really.  ' }]), [
		{ title: 'Be kind', text: null },
		{ title: 'No spam', text: 'Really.' }
	]);
	assert.equal((sanitizeRules([{ text: 'no title' }]) as any).ok, false);
	assert.equal((sanitizeRules(new Array(16).fill('r')) as any).ok, false);
	assert.equal((sanitizeRules('nope') as any).ok, false);
});

test('sanitizeFlairs mints slug ids, dedupes, and validates colors', () => {
	const flairs = sanitizeFlairs([{ label: 'Photo Post', emoji: '📸', color: '#7c5cff' }, 'Question', { id: 'MODS', label: 'Announcement', modOnly: true, color: 'javascript:alert(1)' }]);
	assert.ok(Array.isArray(flairs));
	assert.deepEqual(flairs, [
		{ id: 'photo-post', label: 'Photo Post', emoji: '📸', color: '#7c5cff', modOnly: false },
		{ id: 'question', label: 'Question', emoji: null, color: null, modOnly: false },
		{ id: 'mods', label: 'Announcement', emoji: null, color: null, modOnly: true }
	]);
	assert.equal((sanitizeFlairs([{ label: 'A' }, { id: 'a', label: 'B' }]) as any).ok, false, 'duplicate ids rejected');
	assert.equal((sanitizeFlairs(new Array(51).fill({ label: 'x' })) as any).ok, false);
	assert.equal(slugifyFlairId('  Hello, World!  '), 'hello-world');
});

test('sanitizeBranding merges over previous branding and rejects non-http URLs', () => {
	const previous = { icon: '🌈', iconUrl: null, bannerUrl: 'https://cdn.example/banner.png', accent: '#111' };
	assert.deepEqual(sanitizeBranding(undefined, previous), previous);
	assert.deepEqual(sanitizeBranding({ accent: 'hotpink' }, previous), { ...previous, accent: 'hotpink' });
	assert.deepEqual(sanitizeBranding({ bannerUrl: '' }, previous), { ...previous, bannerUrl: null });
	assert.equal((sanitizeBranding({ iconUrl: 'javascript:alert(1)' }) as any).ok, false);
	assert.deepEqual(sanitizeBranding({ icon: '<img>' }), { icon: null, iconUrl: null, bannerUrl: null, accent: null });
	assert.deepEqual(sanitizeBranding(null, previous), { icon: null, iconUrl: null, bannerUrl: null, accent: null });
});

test('rankSubspacePosts orders each sort deterministically with pins leading hot/new only', () => {
	const now = Date.UTC(2026, 8, 5, 12, 0, 0);
	const hour = 3_600_000;
	const candidates = [
		{ id: 'old-top', createdAtMs: now - 48 * hour, up: 500, down: 20, pinned: false },
		{ id: 'fresh', createdAtMs: now - 1 * hour, up: 12, down: 1, pinned: false },
		{ id: 'pinned', createdAtMs: now - 30 * hour, up: 3, down: 0, pinned: true },
		{ id: 'split', createdAtMs: now - 5 * hour, up: 40, down: 38, pinned: false },
		{ id: 'sunk', createdAtMs: now - 2 * hour, up: 1, down: 9, pinned: false }
	];
	assert.deepEqual(rankSubspacePosts(candidates, 'new', now).slice(0, 2), ['pinned', 'fresh']);
	assert.equal(rankSubspacePosts(candidates, 'hot', now)[0], 'pinned');
	assert.equal(rankSubspacePosts(candidates, 'top', now)[0], 'old-top');
	assert.notEqual(rankSubspacePosts(candidates, 'top', now)[0], 'pinned', 'top is a pure ranking');
	assert.equal(rankSubspacePosts(candidates, 'controversial', now)[0], 'split');
	assert.equal(rankSubspacePosts(candidates, 'rising', now)[0], 'fresh');
	// hot is time-weighted (Reddit): a fresh positive post outranks a sinking one,
	// and a two-day-old post falls behind newer content regardless of score
	const hot = rankSubspacePosts(candidates, 'hot', now);
	assert.ok(hot.indexOf('fresh') < hot.indexOf('sunk'));
	assert.ok(hot.indexOf('fresh') < hot.indexOf('old-top'));
	// stable across calls
	assert.deepEqual(rankSubspacePosts(candidates, 'hot', now), rankSubspacePosts(candidates, 'hot', now));
});

test('top ranges resolve to a since-date, all/unknown to null', () => {
	const now = Date.UTC(2026, 8, 5, 12, 0, 0);
	assert.equal(sanitizeTopRange('week'), 'week');
	assert.equal(sanitizeTopRange('century'), 'all');
	assert.equal(topRangeSince('all', now), null);
	assert.equal(topRangeSince('day', now)?.getTime(), now - 24 * 3_600_000);
});

test('confirmSlugMatches forgives the s/ prefix, case and whitespace but nothing else', () => {
	assert.equal(confirmSlugMatches('rainbows', 'rainbows'), true);
	assert.equal(confirmSlugMatches(' s/Rainbows ', 'rainbows'), true);
	for (const bad of ['rainbow', 'rainbows2', '', undefined, null, 42, ['rainbows'], 's/']) {
		assert.equal(confirmSlugMatches(bad, 'rainbows'), false, JSON.stringify(bad));
	}
	// an empty slug never matches (a missing subspace can't be "confirmed")
	assert.equal(confirmSlugMatches('', ''), false);
});

test('releasedPostUpdate strips exactly the subspace pointer, flair, mod state and private fence', () => {
	const now = new Date('2026-09-05T00:00:00.000Z');
	assert.deepEqual(releasedPostUpdate(now), {
		$unset: { 'crystal.subspaceId': '', 'crystal.flairId': '', subspaceMod: '', subspacePrivate: '' },
		$set: { updatedAt: now }
	});
	// the shared template is frozen so no caller can widen the strip list
	assert.equal(Object.isFrozen(RELEASED_POST_UNSET), true);
	assert.deepEqual(Object.keys(RELEASED_POST_UNSET), ['crystal.subspaceId', 'crystal.flairId', 'subspaceMod', 'subspacePrivate']);
});

test('privatizedPostUpdate strips the same paths and narrows the acl to the author', () => {
	const now = new Date('2026-09-05T00:00:00.000Z');
	assert.deepEqual(privatizedPostUpdate(now), {
		$unset: { 'crystal.subspaceId': '', 'crystal.flairId': '', subspaceMod: '', subspacePrivate: '' },
		$set: { updatedAt: now, acl: ['tt:user'] }
	});
});

test('releaseKindFor keeps private-subspace posts and moderator-removed posts author-only', () => {
	// a private wall covers every post, removed or not
	assert.equal(releaseKindFor('private', false), 'privatized');
	assert.equal(releaseKindFor('private', true), 'privatized');
	// public / restricted: only what the mods removed stays hidden
	assert.equal(releaseKindFor('public', true), 'privatized');
	assert.equal(releaseKindFor('restricted', true), 'privatized');
	assert.equal(releaseKindFor('public', false), 'released');
	assert.equal(releaseKindFor('restricted', false), 'released');
});

test('slugHoldState frees the slug for the previous owner at once and for others after the hold', () => {
	const deletedAt = new Date('2026-09-05T00:00:00.000Z');
	const tombstone = { ownerId: 'prev', crystal: { deletedAt } };
	const justAfter = deletedAt.getTime() + 60_000;
	assert.deepEqual(slugHoldState(null, 'anyone', justAfter), { held: false, until: null });
	assert.deepEqual(slugHoldState(tombstone, 'prev', justAfter), { held: false, until: new Date(deletedAt.getTime() + SUBSPACE_SLUG_HOLD_MS) });
	assert.equal(slugHoldState(tombstone, 'stranger', justAfter).held, true);
	assert.equal(slugHoldState(tombstone, 'stranger', deletedAt.getTime() + SUBSPACE_SLUG_HOLD_MS - 1).held, true);
	assert.equal(slugHoldState(tombstone, 'stranger', deletedAt.getTime() + SUBSPACE_SLUG_HOLD_MS).held, false);
	// ISO strings (the shape a projection hands back) and a missing date
	// (counts from now — never a free-for-all) both behave
	assert.equal(slugHoldState({ ownerId: 'prev', crystal: { deletedAt: deletedAt.toISOString() } }, 'stranger', justAfter).held, true);
	assert.equal(slugHoldState({ ownerId: 'prev', crystal: {} }, 'stranger', justAfter).held, true);
});
