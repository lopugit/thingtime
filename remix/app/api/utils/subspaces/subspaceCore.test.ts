import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import {
	rankSubspacePosts,
	sanitizeBranding,
	sanitizeFlairs,
	sanitizeRules,
	sanitizeSlug,
	sanitizeTopRange,
	slugifyFlairId,
	subspaceModHoldsPost,
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

// Changing a post's subspace drops its whole subspaceMod stamp, so the write
// path has to refuse the move while a moderator action is live — otherwise an
// author launders a removed/locked post clean by PATCHing it out and back in.
test('subspaceModHoldsPost pins a post only while a removal or lock is live', () => {
	assert.equal(subspaceModHoldsPost({ status: 'removed' }), true);
	assert.equal(subspaceModHoldsPost({ locked: true }), true);
	assert.equal(subspaceModHoldsPost({ status: 'removed', locked: false }), true);
	// cosmetic-only state never holds the post in place
	assert.equal(subspaceModHoldsPost({ status: 'approved', pinned: true, nsfw: true, spoiler: true } as any), false);
	assert.equal(subspaceModHoldsPost({ locked: false }), false);
	assert.equal(subspaceModHoldsPost({}), false);
	assert.equal(subspaceModHoldsPost(null), false);
	assert.equal(subspaceModHoldsPost(undefined), false);
});
