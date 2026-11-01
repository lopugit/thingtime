import assert from 'node:assert/strict';
import test from 'node:test';

import { absoluteThirdPartyProfileMediaUrl, effectiveProfileMediaUrl, linkedProfileMediaUrl, profileAttachmentIdFromRecord } from './profileMediaUrl';

test('managed profile media derives a stable same-origin content path while preserving the linked fallback', () => {
	const user = {
		avatarAttachmentId: 'attachment-avatar',
		avatarUrl: 'https://images.example/fallback.jpg'
	};
	assert.equal(profileAttachmentIdFromRecord(user, 'avatar'), 'attachment-avatar');
	assert.equal(linkedProfileMediaUrl(user, 'avatar'), 'https://images.example/fallback.jpg');
	assert.equal(effectiveProfileMediaUrl(user, 'avatar'), '/api/v1/attachments/content?id=attachment-avatar');
});

test('raw user Things and legacy users share the same effective media projection', () => {
	const thing = {
		bannerAttachmentId: 'banner/unsafe? no',
		crystal: { bannerUrl: 'https://images.example/banner.jpg' }
	};
	// URLSearchParams encodes any historical opaque id before placing it in a
	// same-origin path. New attachment ids are separately bounded at write time.
	assert.equal(effectiveProfileMediaUrl(thing, 'banner'), '/api/v1/attachments/content?id=banner%2Funsafe%3F+no');
	assert.equal(linkedProfileMediaUrl(thing, 'banner'), 'https://images.example/banner.jpg');
	assert.equal(effectiveProfileMediaUrl({ avatarUrl: 'data:image/png;base64,legacy' }, 'avatar'), 'data:image/png;base64,legacy');
});

test('empty or malformed managed references fail back to the linked URL', () => {
	assert.equal(
		effectiveProfileMediaUrl({ avatarAttachmentId: '', avatarUrl: 'https://images.example/avatar.jpg' }, 'avatar'),
		'https://images.example/avatar.jpg'
	);
	assert.equal(effectiveProfileMediaUrl({ avatarAttachmentId: 42, avatarUrl: null }, 'avatar'), null);
});

test('third-party projections absolutize only the managed path against the canonical issuer', () => {
	const managed = '/api/v1/attachments/content?id=avatar-managed';
	assert.equal(
		absoluteThirdPartyProfileMediaUrl(managed, 'https://thingtime.example/oauth/issuer'),
		'https://thingtime.example/api/v1/attachments/content?id=avatar-managed'
	);
	assert.equal(
		absoluteThirdPartyProfileMediaUrl('https://images.example/avatar.jpg?x=1', 'https://thingtime.example'),
		'https://images.example/avatar.jpg?x=1'
	);
	assert.equal(absoluteThirdPartyProfileMediaUrl('data:image/png;base64,legacy', 'https://thingtime.example'), 'data:image/png;base64,legacy');
	assert.equal(absoluteThirdPartyProfileMediaUrl('/relative/user-authored.jpg', 'https://thingtime.example'), null);
	assert.equal(absoluteThirdPartyProfileMediaUrl(`java${'script:'}alert(1)`, 'https://thingtime.example'), null);
	assert.equal(absoluteThirdPartyProfileMediaUrl('https://user:secret@images.example/a.jpg', 'https://thingtime.example'), null);
	assert.equal(absoluteThirdPartyProfileMediaUrl(managed, 'not a canonical URL'), null);
	assert.equal(absoluteThirdPartyProfileMediaUrl(managed, 'https://user:secret@thingtime.example'), null);
});
