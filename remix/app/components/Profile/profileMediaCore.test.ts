import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import {
	MAX_PROFILE_MEDIA_BYTES,
	initialExternalProfileImageUrl,
	isExternalProfileImageUrl,
	isManagedProfileMediaUrl,
	profileImageFileError,
	profileMediaUpdateFields,
	profileSaveErrorMessage,
	preservedProfileMediaSnapshot
} from './profileMediaCore.ts';

test('managed content paths never become caller-controlled external URLs', () => {
	const managed = '/api/v1/attachments/content?id=att_a%2Fb';
	assert.equal(isManagedProfileMediaUrl(managed), true);
	assert.equal(initialExternalProfileImageUrl(managed), '');
	assert.equal(isManagedProfileMediaUrl('https://thingtime.com/api/v1/attachments/content?id=att'), false);
	assert.equal(isManagedProfileMediaUrl('//evil.example/api/v1/attachments/content?id=att'), false);
	assert.equal(isManagedProfileMediaUrl('/api/v1/attachments/content'), false);
});

test('external image fallbacks are bounded credential-free http(s) URLs', () => {
	assert.equal(isExternalProfileImageUrl('https://images.example/avatar.png'), true);
	assert.equal(isExternalProfileImageUrl('http://images.example/banner.jpg?size=large'), true);
	assert.equal(isExternalProfileImageUrl('https://user:secret@images.example/avatar.png'), false);
	assert.equal(isExternalProfileImageUrl('https://images.example/avatar image.png'), false);
	assert.equal(isExternalProfileImageUrl('https://images.example\\avatar.png'), false);
	assert.equal(isExternalProfileImageUrl('https://images.example/\ud800.png'), false);
	assert.equal(isExternalProfileImageUrl('https://images.example/bidi\u202Ename.png'), false);
	assert.equal(isExternalProfileImageUrl('data:image/png;base64,AAAA'), false);
	assert.equal(isExternalProfileImageUrl('/api/v1/attachments/content?id=att'), false);
	assert.equal(initialExternalProfileImageUrl(' https://images.example/avatar.png '), 'https://images.example/avatar.png');
});

test('profile images accept only non-empty bounded safe raster files', () => {
	assert.equal(profileImageFileError({ type: 'image/jpeg', size: 10 } as File), null);
	assert.equal(profileImageFileError({ type: 'image/avif', size: MAX_PROFILE_MEDIA_BYTES } as File), null);
	assert.match(profileImageFileError({ type: 'image/svg+xml', size: 10 } as File) || '', /JPEG/);
	assert.match(profileImageFileError({ type: 'image/png', size: 0 } as File) || '', /contains data/);
	assert.match(profileImageFileError({ type: 'image/png', size: MAX_PROFILE_MEDIA_BYTES + 1 } as File) || '', /64 MiB/);
});

test('profile update fields keep managed ids separate from external fallbacks', () => {
	assert.deepEqual(preservedProfileMediaSnapshot('/api/v1/attachments/content?id=att'), {
		mutation: { kind: 'preserve' },
		previewUrl: '/api/v1/attachments/content?id=att',
		blocking: false
	});
	assert.deepEqual(profileMediaUpdateFields('avatar', { kind: 'preserve' }), {});
	assert.deepEqual(profileMediaUpdateFields('avatar', { kind: 'attachment', attachmentId: 'att-avatar' }), {
		avatarAttachmentId: 'att-avatar'
	});
	assert.deepEqual(profileMediaUpdateFields('banner', { kind: 'external', url: ' https://images.example/banner.jpg ' }), {
		bannerUrl: 'https://images.example/banner.jpg',
		bannerAttachmentId: null
	});
	assert.deepEqual(profileMediaUpdateFields('avatar', { kind: 'clear' }), {
		avatarUrl: null,
		avatarAttachmentId: null
	});
});

test('profile save failures never echo server or proxy detail', () => {
	const detail = 'private bucket private-example-bucket account 1234';
	for (const status of [400, 401, 403, 404, 409, 413, 429, 503, 507, 500]) {
		const message = profileSaveErrorMessage({ status, error: detail });
		assert.doesNotMatch(message, /private-example-bucket|1234|private bucket/i);
	}
});
