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

test('comment attachment authorization walks the exact home comment chain to the root ACL and fails closed on cycles or owner mismatch', async () => {
	const docs = new Map<string, any>([
		['comment-1', { shareId: 'comment-1', ownerId: 'author-1', thingtime: ['post', 'comment'], targetId: 'comment-2', acl: ['tt:inherit'] }],
		['comment-2', { shareId: 'comment-2', ownerId: 'author-2', thingtime: ['comment'], targetId: 'post-1', acl: ['tt:inherit'] }],
		['post-1', post()]
	]);
	const canView = createCanViewHomeAttachmentTarget({
		getThings: async () => ({ findOne: async (filter: any) => docs.get(filter.shareId) || null } as any),
		getUsers: async () => ({ findOne: async () => null } as any)
	});
	const attachment = {
		shareId: 'attachment-1',
		ownerId: 'author-1',
		targetId: 'comment-1',
		attachmentPurpose: 'comment' as const
	};
	assert.equal(await canView(null, attachment), true);
	assert.equal(await canView(null, { ...attachment, ownerId: 'attacker' }), false);
	docs.set('comment-2', { ...docs.get('comment-2'), targetId: 'comment-1' });
	assert.equal(await canView(null, attachment), false);
});

test('message attachment authorization requires the exact live message and an active or pending chat membership', async () => {
	let memberState: string | null = 'active';
	const canView = createCanViewHomeAttachmentTarget({
		getThings: async () =>
			({
				findOne: async (filter: any) => {
					if (filter.shareId === 'message-1') {
						return { shareId: 'message-1', ownerId: 'author-1', thingtime: ['chat-message'], targetId: 'chat-1', crystal: {} };
					}
					if (filter.thingtime === 'chat-member' && memberState && filter.ownerId === 'reader-1') {
						return { shareId: 'member-1', crystal: { state: memberState } };
					}
					return null;
				}
			} as any),
		getUsers: async () => ({ findOne: async () => null } as any)
	});
	const attachment = {
		shareId: 'attachment-1',
		ownerId: 'author-1',
		targetId: 'message-1',
		attachmentPurpose: 'message' as const
	};
	assert.equal(await canView({ id: 'reader-1' }, attachment), true);
	assert.equal(await canView(null, attachment), false);
	memberState = null;
	assert.equal(await canView({ id: 'reader-1' }, attachment), false);
});

test('custom emoji attachment authorization requires the exact emoji reference and community membership when scoped', async () => {
	let communityScoped = false;
	let member = true;
	const canView = createCanViewHomeAttachmentTarget({
		getThings: async () =>
			({
				findOne: async (filter: any) => {
					if (filter.shareId === 'emoji-1') {
						return {
							shareId: 'emoji-1',
							ownerId: 'author-1',
							thingtime: ['custom-emoji'],
							targetId: communityScoped ? 'community-1' : null,
							emojiAttachmentId: 'attachment-1'
						};
					}
					if (filter.thingtime === 'community-member' && member) return { shareId: 'community-member-1' };
					return null;
				}
			} as any),
		getUsers: async () => ({ findOne: async () => null } as any)
	});
	const attachment = {
		shareId: 'attachment-1',
		ownerId: 'author-1',
		targetId: 'emoji-1',
		attachmentPurpose: 'emoji' as const
	};
	assert.equal(await canView({ id: 'reader-1' }, attachment), true);
	assert.equal(await canView(null, attachment), false);
	assert.equal(await canView({ id: 'reader-1' }, { ...attachment, shareId: 'stale' }), false);
	communityScoped = true;
	assert.equal(await canView({ id: 'reader-1' }, attachment), true);
	member = false;
	assert.equal(await canView({ id: 'reader-1' }, attachment), false);
});

test('post-purpose media binds to webpage targets too — authorized by the page ACL, filter-shape exact', async () => {
	let captured: any = null;
	let page: any = { shareId: 'page-1', ownerId: 'owner-1', thingtime: ['webpage'], targetId: null, acl: ['tt:all'] };
	const canView = createCanViewHomeAttachmentTarget({
		getThings: async () =>
			({
				findOne: async (filter: any) => {
					captured = filter;
					return page;
				}
			} as any),
		getUsers: async () => ({ findOne: async () => null } as any)
	});
	const attachment = { shareId: 'att-1', ownerId: 'owner-1', attachmentPurpose: 'post', targetId: 'page-1' } as any;
	// public page: anonymous viewer sees the media
	assert.equal(await canView(null, attachment), true);
	assert.deepEqual(captured.thingtime, { $in: ['post', 'webpage'] });
	// private page: only the owner does
	page = { ...page, acl: ['tt:user'] };
	assert.equal(await canView(null, attachment), false);
	assert.equal(await canView({ id: 'owner-1' } as any, attachment), true);
});
