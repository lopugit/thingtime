import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import {
	EMAIL_DEFAULT_OFF_TYPES,
	NOTIFICATION_TYPES,
	normalizeNotificationPrefs,
	SUBSPACE_NOTIFICATION_TYPES,
	subspaceNotificationDetail,
	subspaceNotificationPreview,
	subspaceSlugFromNotificationPreview
} from './registry.ts';

test('the six subspace notification types are registered and default push ON', () => {
	const expected = ['subspace-join-request', 'subspace-join-accepted', 'subspace-post-removed', 'subspace-report', 'subspace-role', 'subspace-ban'];
	assert.deepEqual([...SUBSPACE_NOTIFICATION_TYPES], expected);
	for (const type of expected) assert.ok((NOTIFICATION_TYPES as readonly string[]).includes(type), type);
	const prefs = normalizeNotificationPrefs(null);
	for (const type of expected) assert.equal(prefs.push[type], true, `push ${type}`);
	// the mod-queue firehose (requests + reports) is email opt-in; the rest of
	// the family emails by default like every other bell type
	assert.equal(prefs.email['subspace-join-request'], false);
	assert.equal(prefs.email['subspace-report'], false);
	for (const type of ['subspace-join-accepted', 'subspace-post-removed', 'subspace-role', 'subspace-ban']) assert.equal(prefs.email[type], true, `email ${type}`);
	assert.ok(EMAIL_DEFAULT_OFF_TYPES.includes('subspace-report'));
	// a stored opt-out still wins
	assert.equal(normalizeNotificationPrefs({ 'subspace-role': false }).push['subspace-role'], false);
});

test('subspace notification previews lead with the slug and round-trip it', () => {
	assert.equal(subspaceNotificationPreview('rainbows', 'you are now a moderator 🎩'), 's/rainbows · you are now a moderator 🎩');
	assert.equal(subspaceNotificationPreview('rainbows', '  was   deleted  '), 's/rainbows · was deleted');
	assert.equal(subspaceNotificationPreview('rainbows', ''), 's/rainbows');
	assert.equal(subspaceSlugFromNotificationPreview('s/rainbows · you are now the owner 👑'), 'rainbows');
	assert.equal(subspaceSlugFromNotificationPreview('s/rain_bows'), 'rain_bows');
	assert.equal(subspaceSlugFromNotificationPreview(' s/rainbows was deleted by its owner'), 'rainbows');
	for (const miss of ['Rule 2', 's/Rainbows · caps are not a slug', 's/', '', null, undefined, 42, 'rainbows']) {
		assert.equal(subspaceSlugFromNotificationPreview(miss), null, JSON.stringify(miss));
	}
});

test('subspaceNotificationDetail strips the slug head so copy never keys off the slug itself', () => {
	assert.equal(subspaceNotificationDetail('s/rainbows · you are now a moderator 🎩'), 'you are now a moderator 🎩');
	// a slug that CONTAINS a keyword must not read as that event
	assert.equal(subspaceNotificationDetail('s/deleted_scenes · you are now a moderator 🎩'), 'you are now a moderator 🎩');
	assert.equal(subspaceNotificationDetail('s/uplifted_minds · you were banned 🚫'), 'you were banned 🚫');
	assert.equal(/deleted/.test(subspaceNotificationDetail('s/deleted_scenes · you are now a moderator 🎩')), false);
	assert.equal(/lifted/.test(subspaceNotificationDetail('s/uplifted_minds · you were banned 🚫')), false);
	assert.equal(subspaceNotificationDetail('s/rainbows'), '');
	assert.equal(subspaceNotificationDetail(' s/rainbows was deleted by its owner'), 'was deleted by its owner');
	// non-subspace previews pass through untouched
	assert.equal(subspaceNotificationDetail('Rule 2'), 'Rule 2');
	assert.equal(subspaceNotificationDetail(null), '');
});
