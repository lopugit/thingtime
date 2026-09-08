import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import {
	canPostIn,
	canSeeSubspaceActivity,
	confirmSlugMatches,
	DIRECTORY_RANK_WINDOW,
	isActiveMembershipState,
	isRankedListSort,
	liveUserFlair,
	pickReportQueueSubspace,
	privatizedPostUpdate,
	requestKindOf,
	rankSubspaceDirectory,
	rankSubspacePosts,
	RELEASED_POST_UNSET,
	releaseKindFor,
	releasedPostUpdate,
	removalReasonById,
	removalReasonsOf,
	resolveRemovalReason,
	resolveUserFlair,
	ruleCitation,
	rulesOf,
	sanitizeBranding,
	sanitizeFlairs,
	sanitizeListSort,
	subspaceModHoldsPost,
	sanitizeRemovalReasons,
	sanitizeReportNote,
	sanitizeReportReason,
	sanitizeRules,
	sanitizeSlug,
	sanitizeTopRange,
	sanitizeUserFlairs,
	sliceRankedPage,
	slugHoldState,
	slugifyFlairId,
	SUBSPACE_ACTIVE_WINDOW_MS,
	SUBSPACE_SLUG_HOLD_MS,
	tallyReportReasons,
	toPublicUserFlair,
	topRangeSince,
	userFlairOfCrystal,
	userFlairSettingsOf,
	userFlairSurvivesDemotion
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

test('slugifyFlairId falls back to a stable hashed id when the label has no Latin letters or digits (S4 review)', () => {
	// CJK / Cyrillic / Arabic / emoji-only titles used to slug to '' and be
	// refused with 400 — the editors expose no id field, so they mint one
	for (const label of ['宣伝禁止', 'Без спама', 'ممنوع الإعلانات', '🚫🚫', '---']) {
		const id = slugifyFlairId(label, 'reason');
		assert.match(id, /^reason-[0-9a-z]{1,7}$/, label);
		assert.equal(slugifyFlairId(label, 'reason'), id, 'deterministic');
	}
	assert.notEqual(slugifyFlairId('宣伝禁止', 'reason'), slugifyFlairId('荒らし禁止', 'reason'));
	assert.match(slugifyFlairId('😀'), /^id-[0-9a-z]+$/, 'default prefix');
	// a label with any Latin content keeps its slug
	assert.equal(slugifyFlairId('宣伝禁止 (no ads)', 'reason'), 'no-ads');
	// through the sanitizers: saved with the minted id, deduped like any other
	const flairs = sanitizeFlairs([{ label: '写真' }]) as any;
	assert.match(flairs[0].id, /^flair-[0-9a-z]+$/);
	const reasons = sanitizeRemovalReasons([{ title: '宣伝禁止', message: '広告は禁止です。' }, { title: '荒らし禁止' }]) as any;
	assert.match(reasons[0].id, /^reason-[0-9a-z]+$/);
	assert.equal(reasons[0].title, '宣伝禁止');
	assert.notEqual(reasons[0].id, reasons[1].id);
	assert.equal((sanitizeRemovalReasons([{ title: '宣伝禁止' }, { title: '宣伝禁止' }]) as any).ok, false, 'the same title twice is still a duplicate id');
});

test('rulesOf reads a stored crystal defensively (titles required, empty text → null)', () => {
	assert.deepEqual(rulesOf(undefined), []);
	assert.deepEqual(rulesOf({ rules: 'nope' }), []);
	assert.deepEqual(rulesOf({ rules: [{ title: 'Be kind' }, { title: 'No spam', text: 'Ads go elsewhere.' }, { text: 'no title' }, null, { title: '', text: 'x' }, { title: 'Bare', text: '' }] }), [
		{ title: 'Be kind', text: null },
		{ title: 'No spam', text: 'Ads go elsewhere.' },
		{ title: 'Bare', text: null }
	]);
	assert.equal(ruleCitation(1, { title: 'No spam' }), 'Rule 2: No spam');
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

// ── S2: join requests + posting-approval requests ──────────────────────────
const row = (patch: Partial<{ role: 'owner' | 'moderator' | 'member'; approved: boolean; banned: boolean; left: boolean; pending: boolean; approvalRequested: boolean }> = {}) => ({
	role: 'member' as const,
	approved: false,
	banned: false,
	left: false,
	pending: false,
	approvalRequested: false,
	...patch
});

test('isActiveMembershipState: row && !left && !banned && !pending — a pending join request is not a membership', () => {
	assert.equal(isActiveMembershipState(row()), true);
	assert.equal(isActiveMembershipState(row({ role: 'moderator' })), true);
	assert.equal(isActiveMembershipState(row({ pending: true })), false);
	assert.equal(isActiveMembershipState(row({ left: true })), false);
	assert.equal(isActiveMembershipState(row({ banned: true })), false);
	assert.equal(isActiveMembershipState(null), false);
	assert.equal(isActiveMembershipState(undefined), false);
	// a legacy row without the new flags reads active (flags default false)
	assert.equal(isActiveMembershipState({ role: 'member', approved: false, banned: false, left: false }), true);
});

test('canPostIn: mods always; public → anyone not banned; restricted → approved; private → active members only', () => {
	for (const access of ['public', 'restricted', 'private'] as const) {
		assert.equal(canPostIn(access, row({ role: 'owner' })), true, `${access} owner`);
		assert.equal(canPostIn(access, row({ role: 'moderator' })), true, `${access} mod`);
		assert.equal(canPostIn(access, row({ banned: true, role: 'moderator' })), false, `${access} banned mod`);
	}
	assert.equal(canPostIn('public', null), true);
	assert.equal(canPostIn('public', row()), true);
	assert.equal(canPostIn('public', row({ banned: true })), false);
	assert.equal(canPostIn('restricted', null), false);
	assert.equal(canPostIn('restricted', row()), false);
	assert.equal(canPostIn('restricted', row({ approved: true })), true);
	assert.equal(canPostIn('restricted', row({ approved: true, left: true })), false);
	assert.equal(canPostIn('private', null), false);
	assert.equal(canPostIn('private', row()), true);
	// the S7 edge case, pinned now: a pending requester of a private subspace can't post
	assert.equal(canPostIn('private', row({ pending: true })), false);
	assert.equal(canPostIn('private', row({ pending: true, approved: true })), false);
	assert.equal(canPostIn('private', row({ left: true })), false);
});

test('requestKindOf sorts a member row into the join queue, the approval queue, or neither', () => {
	assert.equal(requestKindOf(row({ pending: true })), 'join');
	assert.equal(requestKindOf(row({ approvalRequested: true })), 'approval');
	// an approved poster's stale flag is not a request; a pending row is a JOIN request even if it asked to post
	assert.equal(requestKindOf(row({ approvalRequested: true, approved: true })), null);
	assert.equal(requestKindOf(row({ pending: true, approvalRequested: true })), 'join');
	// banned / left / plain rows sit in no queue
	assert.equal(requestKindOf(row({ pending: true, banned: true })), null);
	assert.equal(requestKindOf(row({ approvalRequested: true, left: true })), null);
	assert.equal(requestKindOf(row()), null);
	assert.equal(requestKindOf(null), null);
});

// ── S3: user flairs ─────────────────────────────────────────────────────────
const templates = [
	{ id: 'prism', label: 'Prism', emoji: '🔮', color: '#7c5cff', modOnly: false },
	{ id: 'staff', label: 'Staff', emoji: '🎩', color: null, modOnly: true }
];
const settings = (patch: Partial<{ userFlairSelfAssign: boolean; allowCustomUserFlair: boolean }> = {}) => ({ userFlairs: templates, userFlairSelfAssign: true, allowCustomUserFlair: false, ...patch });
const member = { moderator: false, self: true };
const mod = { moderator: true, self: false };
const failed = (value: unknown): { status: number } | null => (value && typeof value === 'object' && (value as any).ok === false ? (value as any) : null);

test('userFlairSettingsOf defaults: self-assign on, custom text off, no templates', () => {
	assert.deepEqual(userFlairSettingsOf(undefined), { userFlairs: [], userFlairSelfAssign: true, allowCustomUserFlair: false });
	assert.deepEqual(userFlairSettingsOf({ userFlairSelfAssign: false, allowCustomUserFlair: true, userFlairs: templates }), { userFlairs: templates, userFlairSelfAssign: false, allowCustomUserFlair: true });
	// junk reads as the defaults
	assert.deepEqual(userFlairSettingsOf({ userFlairs: 'nope', userFlairSelfAssign: 'no', allowCustomUserFlair: 1 }), { userFlairs: [], userFlairSelfAssign: true, allowCustomUserFlair: false });
});

test('sanitizeUserFlairs shares the post-flair grammar and prefixes its errors', () => {
	assert.deepEqual(sanitizeUserFlairs([{ label: 'Prism', emoji: '🔮' }]), [{ id: 'prism', label: 'Prism', emoji: '🔮', color: null, modOnly: false }]);
	const bad = sanitizeUserFlairs([{ label: 'A' }, { id: 'a', label: 'B' }]) as any;
	assert.equal(bad.ok, false);
	assert.match(bad.error, /^User flairs: /);
});

test('resolveUserFlair: a member picks a template while self-assign is on, never a mod-only one', () => {
	assert.deepEqual(resolveUserFlair({ flairId: 'prism' }, settings(), member), { id: 'prism', text: 'Prism', emoji: '🔮', color: '#7c5cff' });
	assert.deepEqual(resolveUserFlair({ flairId: ' PRISM ' }, settings(), member), { id: 'prism', text: 'Prism', emoji: '🔮', color: '#7c5cff' }, 'ids are trimmed + lowercased');
	assert.equal(failed(resolveUserFlair({ flairId: 'staff' }, settings(), member))?.status, 403, 'mod-only');
	assert.equal(failed(resolveUserFlair({ flairId: 'ghost' }, settings(), member))?.status, 400, 'unknown template');
	assert.equal(failed(resolveUserFlair({ flairId: 'prism' }, settings({ userFlairSelfAssign: false }), member))?.status, 403, 'self-assign off');
});

test('resolveUserFlair: custom text needs allowCustomUserFlair (members), is bounded, keeps icon/color rules', () => {
	assert.equal(failed(resolveUserFlair({ text: 'Rainbow hunter' }, settings(), member))?.status, 403);
	assert.deepEqual(resolveUserFlair({ text: '  Rainbow   hunter ', emoji: '🌈', color: 'hotpink' }, settings({ allowCustomUserFlair: true }), member), { id: null, text: 'Rainbow hunter', emoji: '🌈', color: 'hotpink' });
	assert.deepEqual(resolveUserFlair({ text: 'x', emoji: '<img>', color: 'javascript:alert(1)' }, settings({ allowCustomUserFlair: true }), member), { id: null, text: 'x', emoji: null, color: null });
	assert.equal(failed(resolveUserFlair({ text: 'x'.repeat(41) }, settings({ allowCustomUserFlair: true }), member))?.status, 400, 'over 40 chars');
	assert.deepEqual(resolveUserFlair({ text: 'x'.repeat(40) }, settings({ allowCustomUserFlair: true }), member), { id: null, text: 'x'.repeat(40), emoji: null, color: null });
	// a template id wins over stray text
	assert.deepEqual(resolveUserFlair({ flairId: 'prism', text: 'ignored' }, settings(), member), { id: 'prism', text: 'Prism', emoji: '🔮', color: '#7c5cff' });
});

test('resolveUserFlair: clearing is always allowed; moderators are bound by neither switch', () => {
	for (const request of [{}, { flairId: null }, { flairId: '', text: '' }, { text: '   ' }]) {
		assert.equal(resolveUserFlair(request, settings({ userFlairSelfAssign: false }), member), null, JSON.stringify(request));
	}
	assert.deepEqual(resolveUserFlair({ flairId: 'staff' }, settings({ userFlairSelfAssign: false }), mod), { id: 'staff', text: 'Staff', emoji: '🎩', color: null });
	assert.deepEqual(resolveUserFlair({ text: 'Verified bee' }, settings({ userFlairSelfAssign: false, allowCustomUserFlair: false }), mod), { id: null, text: 'Verified bee', emoji: null, color: null });
	// a moderator dressing THEMSELVES is still a moderator
	assert.deepEqual(resolveUserFlair({ flairId: 'staff' }, settings(), { moderator: true, self: true }), { id: 'staff', text: 'Staff', emoji: '🎩', color: null });
	assert.equal(failed(resolveUserFlair({ flairId: 'ghost' }, settings(), mod))?.status, 400, 'unknown templates are unknown to mods too');
});

test('userFlairOfCrystal normalizes the stored pick and liveUserFlair follows the live template', () => {
	assert.equal(userFlairOfCrystal({}), null);
	assert.equal(userFlairOfCrystal({ userFlair: null }), null);
	assert.equal(userFlairOfCrystal({ userFlair: { id: 'prism', text: '  ' } }), null, 'empty text reads as none');
	assert.deepEqual(userFlairOfCrystal({ userFlair: { id: 'prism', text: 'Old label', emoji: '🔮', color: '#7c5cff' } }), { id: 'prism', text: 'Old label', emoji: '🔮', color: '#7c5cff' });
	assert.deepEqual(userFlairOfCrystal({ userFlair: { text: 'Custom', color: 'not a color' } }), { id: null, text: 'Custom', emoji: null, color: null });
	// a renamed template reaches every wearer; a deleted one keeps its snapshot; custom text is untouched
	const stored = { id: 'prism', text: 'Old label', emoji: '🔮', color: '#7c5cff' };
	assert.deepEqual(liveUserFlair(stored, [{ ...templates[0], label: 'Prism ✨', color: 'hotpink' }]), { id: 'prism', text: 'Prism ✨', emoji: '🔮', color: 'hotpink' });
	assert.deepEqual(liveUserFlair(stored, []), stored);
	assert.deepEqual(liveUserFlair({ id: null, text: 'Custom', emoji: null, color: null }, templates), { id: null, text: 'Custom', emoji: null, color: null });
	assert.equal(liveUserFlair(null, templates), null);
	// the wire shape renames text → label
	assert.deepEqual(toPublicUserFlair(stored), { id: 'prism', label: 'Old label', emoji: '🔮', color: '#7c5cff' });
	assert.equal(toPublicUserFlair(null), null);
});

test('userFlairSurvivesDemotion: a mod-only template comes off with the hat; ordinary templates, custom text and orphaned snapshots stay', () => {
	assert.equal(userFlairSurvivesDemotion({ id: 'staff', text: 'Staff', emoji: '🎩', color: null }, templates), false, 'mod-only → stripped');
	assert.equal(userFlairSurvivesDemotion({ id: 'prism', text: 'Prism', emoji: '🔮', color: '#7c5cff' }, templates), true, 'an ordinary template stays');
	assert.equal(userFlairSurvivesDemotion({ id: null, text: 'Verified bee', emoji: '🐝', color: null }, templates), true, 'custom text stays');
	// the template was deleted meanwhile — the pick is a plain snapshot now
	assert.equal(userFlairSurvivesDemotion({ id: 'staff', text: 'Staff', emoji: '🎩', color: null }, []), true);
	assert.equal(userFlairSurvivesDemotion(null, templates), true);
});

// ---------------------------------------------------------------------------
// Removal reasons (round 2, S4)

test('sanitizeRemovalReasons mints ids from titles, bounds count / title / message, dedupes', () => {
	assert.deepEqual(sanitizeRemovalReasons(undefined), []);
	assert.deepEqual(sanitizeRemovalReasons(null), []);
	assert.deepEqual(sanitizeRemovalReasons([{ title: 'No Spam!', message: '  Posts that   only advertise are removed. ' }, 'Off topic', { id: 'R1', title: 'Rule 1' }]), [
		{ id: 'no-spam', title: 'No Spam!', message: 'Posts that only advertise are removed.' },
		{ id: 'off-topic', title: 'Off topic', message: '' },
		{ id: 'r1', title: 'Rule 1', message: '' }
	]);
	// the title is bounded (sliced) like a rule title; the message is refused over its cap
	assert.equal((sanitizeRemovalReasons([{ title: 'x'.repeat(81) }]) as any)[0].title.length, 80);
	assert.equal((sanitizeRemovalReasons([{ title: 'ok', message: 'm'.repeat(501) }]) as any).ok, false);
	assert.equal((sanitizeRemovalReasons([{ title: 'ok', message: 'm'.repeat(500) }]) as any)[0].message.length, 500);
	for (const bad of ['nope', [{ message: 'no title' }], [{ title: '   ' }], [42], new Array(21).fill('r'), [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }], [{ id: 'Not Valid', title: 'x' }]]) {
		const result = sanitizeRemovalReasons(bad) as any;
		assert.equal(result.ok, false, JSON.stringify(bad).slice(0, 60));
	}
	assert.equal((sanitizeRemovalReasons(new Array(20).fill(0).map((_, i) => ({ title: `r${i}` }))) as any).length, 20);
});

test('removalReasonsOf reads a stored crystal defensively and removalReasonById finds by id', () => {
	assert.deepEqual(removalReasonsOf(undefined), []);
	assert.deepEqual(removalReasonsOf({ removalReasons: 'nope' }), []);
	const reasons = removalReasonsOf({ removalReasons: [{ id: 'no-spam', title: 'No spam', message: 'Ads go.' }, { id: 'x' }, null, { id: 'bare', title: 'Bare' }] });
	assert.deepEqual(reasons, [
		{ id: 'no-spam', title: 'No spam', message: 'Ads go.' },
		{ id: 'bare', title: 'Bare', message: '' }
	]);
	assert.deepEqual(removalReasonById(reasons, 'bare'), { id: 'bare', title: 'Bare', message: '' });
	assert.equal(removalReasonById(reasons, 'ghost'), null);
	assert.equal(removalReasonById(reasons, null), null);
});

test('resolveRemovalReason: reasonId → title — message · note (headline = the title); free text alone; neither → null; unknown → 400', () => {
	const reasons = [
		{ id: 'no-spam', title: 'No spam', message: 'Posts that only advertise are removed.' },
		{ id: 'bare', title: 'Bare', message: '' }
	];
	const none = { reasonId: null, ruleIndex: null };
	assert.deepEqual(resolveRemovalReason({ reasonId: 'no-spam' }, reasons), { reason: 'No spam — Posts that only advertise are removed.', reasonId: 'no-spam', ruleIndex: null, headline: 'No spam' });
	assert.deepEqual(resolveRemovalReason({ reasonId: ' NO-SPAM ', reason: '  third   time ' }, reasons), {
		reason: 'No spam — Posts that only advertise are removed. · third time',
		reasonId: 'no-spam',
		ruleIndex: null,
		headline: 'No spam'
	});
	assert.deepEqual(resolveRemovalReason({ reasonId: 'bare', reason: 'note' }, reasons), { reason: 'Bare · note', reasonId: 'bare', ruleIndex: null, headline: 'Bare' });
	// free text: the whole text is the reason AND the headline
	assert.deepEqual(resolveRemovalReason({ reason: 'Rule 2' }, reasons), { ...none, reason: 'Rule 2', headline: 'Rule 2' });
	assert.deepEqual(resolveRemovalReason({}, reasons), { ...none, reason: null, headline: null });
	assert.deepEqual(resolveRemovalReason({ reasonId: null, reason: '', ruleIndex: null }, reasons), { ...none, reason: null, headline: null });
	const unknown = resolveRemovalReason({ reasonId: 'ghost' }, reasons) as any;
	assert.equal(unknown.ok, false);
	assert.equal(unknown.status, 400);
	// the free text alone keeps the pre-S4 bound; the composed text has its own
	assert.equal((resolveRemovalReason({ reason: 'x'.repeat(400) }, reasons) as any).reason.length, 300);
	const long = resolveRemovalReason({ reasonId: 'long', reason: 'n'.repeat(300) }, [{ id: 'long', title: 't'.repeat(80), message: 'm'.repeat(500) }]) as any;
	assert.equal(long.reason.length, 80 + 3 + 500 + 3 + 300);
	assert.ok(long.reason.length <= 900);
});

test('resolveRemovalReason: ruleIndex cites a rule server-side — "Rule N: title — text · note", bounded like a canned reason (S4 review)', () => {
	const rules = [
		{ title: 'Be kind', text: null },
		{ title: 'No spam', text: 'Ads go elsewhere.' }
	];
	assert.deepEqual(resolveRemovalReason({ ruleIndex: 0 }, [], rules), { reason: 'Rule 1: Be kind', reasonId: null, ruleIndex: 0, headline: 'Rule 1: Be kind' });
	assert.deepEqual(resolveRemovalReason({ ruleIndex: '1', reason: ' duplicate  thread ' }, [], rules), {
		reason: 'Rule 2: No spam — Ads go elsewhere. · duplicate thread',
		reasonId: null,
		ruleIndex: 1,
		headline: 'Rule 2: No spam'
	});
	// walls: out of range, no rules at all, garbage, and naming both a reason and a rule
	for (const [input, ruleList] of [
		[{ ruleIndex: 2 }, rules],
		[{ ruleIndex: -1 }, rules],
		[{ ruleIndex: 1.5 }, rules],
		[{ ruleIndex: 'two' }, rules],
		[{ ruleIndex: 0 }, []],
		[{ ruleIndex: 0, reasonId: 'bare' }, rules]
	] as const) {
		const result = resolveRemovalReason(input, [{ id: 'bare', title: 'Bare', message: '' }], ruleList) as any;
		assert.equal(result.ok, false, JSON.stringify(input));
		assert.equal(result.status, 400, JSON.stringify(input));
	}
	// the composed text is bounded by the post-removal cap, never the 300 free-text one
	const long = resolveRemovalReason({ ruleIndex: 0, reason: 'n'.repeat(300) }, [], [{ title: 't'.repeat(100), text: 'x'.repeat(500) }]) as any;
	assert.equal(long.reason.length, 900);
	assert.ok(long.reason.startsWith('Rule 1: tttt'));
	// the omitted list reads as no rules
	assert.equal((resolveRemovalReason({ ruleIndex: 0 }, []) as any).status, 400);
});

// --- reports (round 2, S5) ---------------------------------------------------

test('sanitizeReportReason requires a reason and bounds it at 120 collapsed chars', () => {
	assert.equal(sanitizeReportReason('  Rule 2:   No spam '), 'Rule 2: No spam');
	assert.equal(sanitizeReportReason('r'.repeat(200)), 'r'.repeat(120));
	for (const bad of ['', '   ', null, undefined, 42, { reason: 'x' }]) {
		const result = sanitizeReportReason(bad) as any;
		assert.equal(result.ok, false, JSON.stringify(bad));
		assert.equal(result.status, 400);
	}
});

test('sanitizeReportNote is optional, collapses whitespace and refuses more than 500 chars', () => {
	assert.equal(sanitizeReportNote(undefined), null);
	assert.equal(sanitizeReportNote(null), null);
	assert.equal(sanitizeReportNote(''), null);
	assert.equal(sanitizeReportNote('   '), null);
	assert.equal(sanitizeReportNote(' third   ad  this week '), 'third ad this week');
	assert.equal(sanitizeReportNote('n'.repeat(500)), 'n'.repeat(500));
	assert.equal((sanitizeReportNote('n'.repeat(501)) as any).status, 400);
	assert.equal((sanitizeReportNote(12) as any).status, 400);
});

test('tallyReportReasons counts reasons most-cited first, ties alphabetical, blanks dropped', () => {
	assert.deepEqual(tallyReportReasons([]), []);
	assert.deepEqual(
		tallyReportReasons([{ reason: 'Spam' }, { reason: 'Harassment' }, { reason: 'Spam' }, { reason: ' ' }, { reason: 'Abuse' }, { reason: 'Harassment' }]),
		[
			{ reason: 'Harassment', count: 2 },
			{ reason: 'Spam', count: 2 },
			{ reason: 'Abuse', count: 1 }
		]
	);
});

// S5 review: a dismiss without id | slug follows the OPEN rows' own targetId —
// a post that moved after it was reported keeps its rows dismissable in the
// old queue; the post's current subspace decides only when open rows sit
// there, or when none exist anywhere (so the moderator gate still answers)
test('pickReportQueueSubspace prefers the post’s current subspace when open rows sit there, else the queue that holds them, else the post’s', () => {
	assert.equal(pickReportQueueSubspace('b', ['a', 'b']), 'b');
	assert.equal(pickReportQueueSubspace('b', ['a']), 'a');
	assert.equal(pickReportQueueSubspace(null, ['a']), 'a');
	assert.equal(pickReportQueueSubspace('b', []), 'b');
	assert.equal(pickReportQueueSubspace(null, []), null);
	// deterministic across two old queues (lowest-sorted wins), blanks dropped
	assert.equal(pickReportQueueSubspace('z', ['q', 'c', '', 'c']), 'c');
});

// S6 — the directory's sorts: new is the cursor walk, members / active are
// ranked in memory over a bounded window; a typo must not silently reorder
test('sanitizeListSort defaults to new, accepts the three sorts, 400s anything else', () => {
	assert.equal(sanitizeListSort(undefined), 'new');
	assert.equal(sanitizeListSort(null), 'new');
	assert.equal(sanitizeListSort(''), 'new');
	assert.equal(sanitizeListSort('members'), 'members');
	assert.equal(sanitizeListSort('active'), 'active');
	assert.equal(sanitizeListSort('new'), 'new');
	for (const bad of ['hot', 'Members', 'popular', 42, {}]) {
		const result = sanitizeListSort(bad);
		assert.equal(typeof result === 'object' && result.ok === false && result.status === 400, true, JSON.stringify(bad));
	}
	assert.equal(isRankedListSort('new'), false);
	assert.equal(isRankedListSort('members'), true);
	assert.equal(isRankedListSort('active'), true);
	assert.equal(DIRECTORY_RANK_WINDOW, 200);
	assert.equal(SUBSPACE_ACTIVE_WINDOW_MS, 7 * 86_400_000);
});

test('rankSubspaceDirectory orders by the sort’s measure, then newer, then id — deterministic', () => {
	const candidates = [
		{ id: 'b', createdAtMs: 200, memberCount: 3, recentPostCount: 0 },
		{ id: 'a', createdAtMs: 100, memberCount: 3, recentPostCount: 9 },
		{ id: 'c', createdAtMs: 300, memberCount: 1, recentPostCount: 4 },
		{ id: 'd', createdAtMs: 300, memberCount: 1, recentPostCount: 4 }
	];
	// members: 3 (b newer than a) → 1 (c/d tie on time → id)
	assert.deepEqual(rankSubspaceDirectory(candidates, 'members'), ['b', 'a', 'c', 'd']);
	// active: 9, 4 (c before d by id), 0
	assert.deepEqual(rankSubspaceDirectory(candidates, 'active'), ['a', 'c', 'd', 'b']);
	// new: pure createdAt desc with the id tie-break
	assert.deepEqual(rankSubspaceDirectory(candidates, 'new'), ['c', 'd', 'b', 'a']);
	// the input is never mutated
	assert.equal(candidates[0].id, 'b');
	assert.deepEqual(rankSubspaceDirectory([], 'members'), []);
});

test('canSeeSubspaceActivity: a private subspace’s activity is its ACTIVE members’ business; public / restricted activity is everyone’s', () => {
	const active = { role: 'member', approved: false, banned: false, left: false, pending: false, approvalRequested: false } as const;
	// world-readable posts → world-readable counts (a ban there hides nothing the feed shows anyway)
	assert.equal(canSeeSubspaceActivity('public', null), true);
	assert.equal(canSeeSubspaceActivity('public', undefined), true);
	assert.equal(canSeeSubspaceActivity('restricted', null), true);
	assert.equal(canSeeSubspaceActivity('restricted', { ...active, banned: true }), true);
	// private: only an active membership sees the measure
	assert.equal(canSeeSubspaceActivity('private', null), false);
	assert.equal(canSeeSubspaceActivity('private', undefined), false);
	assert.equal(canSeeSubspaceActivity('private', active), true);
	assert.equal(canSeeSubspaceActivity('private', { ...active, role: 'moderator' }), true);
	assert.equal(canSeeSubspaceActivity('private', { ...active, role: 'owner' }), true);
	// a pending requester, a kicked (left) member and a banned member are not members
	assert.equal(canSeeSubspaceActivity('private', { ...active, pending: true }), false);
	assert.equal(canSeeSubspaceActivity('private', { ...active, left: true }), false);
	assert.equal(canSeeSubspaceActivity('private', { ...active, banned: true }), false);
});

test('sliceRankedPage pages a ranked id list by offset and reports the next offset', () => {
	const ids = ['a', 'b', 'c', 'd', 'e'];
	assert.deepEqual(sliceRankedPage(ids, undefined, 2), { ids: ['a', 'b'], nextCursor: '2' });
	assert.deepEqual(sliceRankedPage(ids, '2', 2), { ids: ['c', 'd'], nextCursor: '4' });
	assert.deepEqual(sliceRankedPage(ids, '4', 2), { ids: ['e'], nextCursor: null });
	assert.deepEqual(sliceRankedPage(ids, '5', 2), { ids: [], nextCursor: null });
	// garbage / negative cursors start over
	assert.deepEqual(sliceRankedPage(ids, 'nope', 3), { ids: ['a', 'b', 'c'], nextCursor: '3' });
	assert.deepEqual(sliceRankedPage(ids, '-4', 3), { ids: ['a', 'b', 'c'], nextCursor: '3' });
	assert.deepEqual(sliceRankedPage([], '0', 3), { ids: [], nextCursor: null });
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
