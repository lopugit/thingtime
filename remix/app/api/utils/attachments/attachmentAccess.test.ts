import assert from 'node:assert/strict';
import test from 'node:test';

import { attachmentTargetAclAllows, createCanViewHomeAttachmentTarget, profileAttachmentTargetAllows } from './attachmentAccess';

const post = (overrides: Record<string, unknown> = {}) => ({
	shareId: 'post-1',
	ownerId: 'owner-1',
	thingtime: ['post'],
	targetId: null,
	acl: ['tt:all'],
	...overrides
});

test('narrow attachment target ACL check handles owners, public grants, exclusions, and fails closed', () => {
	assert.equal(attachmentTargetAclAllows(post(), null), true);
	assert.equal(attachmentTargetAclAllows(post({ acl: ['tt:user'] }), { id: 'reader-1' }), false);
	assert.equal(attachmentTargetAclAllows(post({ acl: ['tt:user'] }), { id: 'owner-1' }), true);
	assert.equal(
		attachmentTargetAclAllows(post({ acl: ['tt:all', '-tt:user/blocked'] }), {
			id: 'reader-1',
			username: 'blocked'
		}),
		false
	);
	assert.equal(
		attachmentTargetAclAllows(post({ acl: ['tt:user/invited'] }), {
			id: 'reader-2',
			username: 'invited'
		}),
		true
	);
	assert.equal(attachmentTargetAclAllows(post({ thingtime: ['post', 'share'], targetId: 'root-1' }), null), false);
	assert.equal(attachmentTargetAclAllows(post({ acl: ['tt:inherit'] }), { id: 'reader-1' }), false);
	assert.equal(attachmentTargetAclAllows(null, { id: 'reader-1' }), false);
});

const profileAttachment = (overrides: Record<string, unknown> = {}) => ({
	shareId: 'attachment-1',
	ownerId: 'user-1',
	targetId: 'user-1',
	attachmentPurpose: 'profile' as const,
	attachmentProfileSlot: 'avatar' as const,
	...overrides
});

test('profile attachment authorization requires canonical public user ownership and the exact current slot reference', () => {
	const target = {
		shareId: 'user-1',
		ownerId: 'user-1',
		thingtime: ['user'],
		targetId: null,
		acl: ['tt:all'],
		avatarAttachmentId: 'attachment-1',
		bannerAttachmentId: 'attachment-2'
	};
	assert.equal(profileAttachmentTargetAllows(profileAttachment(), target), true);
	assert.equal(profileAttachmentTargetAllows(profileAttachment({ shareId: 'stale' }), target), false);
	assert.equal(profileAttachmentTargetAllows(profileAttachment({ ownerId: 'other' }), target), false);
	assert.equal(profileAttachmentTargetAllows(profileAttachment({ attachmentProfileSlot: 'banner' }), target), false);
	assert.equal(profileAttachmentTargetAllows(profileAttachment(), { ...target, acl: ['tt:user'] }), false);
	assert.equal(profileAttachmentTargetAllows(profileAttachment(), { ...target, thingtime: ['post'] }), false);
	assert.equal(
		profileAttachmentTargetAllows(profileAttachment(), {
			shareId: 'user-1',
			legacy: true,
			avatarAttachmentId: 'attachment-1'
		}),
		true
	);
});

test('home target lookup supports exact legacy profile refs but never falls through a colliding home Thing', async () => {
	const legacyId = '664f1c2a9d3e5b0012345678';
	let homeThing: any = null;
	const legacy = { _id: legacyId, avatarAttachmentId: 'attachment-1' };
	const canView = createCanViewHomeAttachmentTarget({
		getThings: async () => ({ findOne: async () => homeThing } as any),
		getUsers: async () => ({ findOne: async () => legacy } as any)
	});
	const attachment = profileAttachment({ ownerId: legacyId, targetId: legacyId });
	assert.equal(await canView(null, attachment), true);

	homeThing = { shareId: legacyId, ownerId: legacyId, thingtime: ['post'], targetId: null, acl: ['tt:all'] };
	assert.equal(await canView(null, attachment), false);

	homeThing = {
		shareId: legacyId,
		ownerId: legacyId,
		thingtime: ['user'],
		targetId: null,
		acl: ['tt:all'],
		avatarAttachmentId: 'attachment-1'
	};
	assert.equal(await canView(null, attachment), true);
});
