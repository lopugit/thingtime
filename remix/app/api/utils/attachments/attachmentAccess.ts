import { ObjectId } from 'mongodb';

import { getHomeThingsCollection, getUsersCollection } from '../mongodb/collections';
import { ACL_ALL, ACL_INHERIT, ACL_OWNER, aclAllows, aclFromVisibility, type ThingVisibility } from '../../../schemas/registry';
import type { AttachmentPurpose, ProfileAttachmentSlot } from './attachmentCore';

export type AttachmentAccessViewer = { id: string; username?: string | null; isAdmin?: boolean } | null;

type AttachmentTargetAclDoc = {
	shareId: string;
	ownerId: string;
	thingtime?: unknown;
	targetId?: unknown;
	acl?: unknown;
	visibility?: ThingVisibility;
};

export type AttachmentAccessDocument = {
	shareId: string;
	ownerId: string;
	targetId?: string;
	attachmentPurpose?: AttachmentPurpose;
	attachmentProfileSlot?: ProfileAttachmentSlot;
};

type ProfileAttachmentTargetDoc = {
	shareId: string;
	ownerId?: string;
	thingtime?: unknown;
	targetId?: unknown;
	acl?: unknown;
	legacy?: boolean;
	avatarAttachmentId?: unknown;
	bannerAttachmentId?: unknown;
};

export const attachmentTargetAclAllows = (doc: AttachmentTargetAclDoc | null, viewer: AttachmentAccessViewer): boolean => {
	// exactly a top-level post OR a webpage (builder saves bind post-purpose
	// media to page things) — anything else fails closed
	if (
		!doc ||
		!Array.isArray(doc.thingtime) ||
		doc.thingtime.length !== 1 ||
		(doc.thingtime[0] !== 'post' && doc.thingtime[0] !== 'webpage') ||
		(doc.targetId !== undefined && doc.targetId !== null)
	) {
		return false;
	}
	if (viewer?.id === doc.ownerId) return true;
	const acl =
		Array.isArray(doc.acl) && doc.acl.length && doc.acl.every((entry) => typeof entry === 'string')
			? (doc.acl as string[])
			: aclFromVisibility(doc.visibility) || [ACL_OWNER];
	if (acl.includes(ACL_INHERIT)) return false;
	return aclAllows(acl, viewer, doc.ownerId);
};

export const profileAttachmentTargetAllows = (attachment: AttachmentAccessDocument, target: ProfileAttachmentTargetDoc | null): boolean => {
	if (
		attachment.attachmentPurpose !== 'profile' ||
		(attachment.attachmentProfileSlot !== 'avatar' && attachment.attachmentProfileSlot !== 'banner') ||
		!attachment.targetId ||
		attachment.ownerId !== attachment.targetId ||
		!target ||
		target.shareId !== attachment.targetId
	) {
		return false;
	}

	if (!target.legacy) {
		if (
			target.ownerId !== target.shareId ||
			!Array.isArray(target.thingtime) ||
			target.thingtime.length !== 1 ||
			target.thingtime[0] !== 'user' ||
			target.targetId !== null ||
			!Array.isArray(target.acl) ||
			target.acl.length !== 1 ||
			target.acl[0] !== ACL_ALL
		) {
			return false;
		}
	}

	const currentId = attachment.attachmentProfileSlot === 'avatar' ? target.avatarAttachmentId : target.bannerAttachmentId;
	return currentId === attachment.shareId;
};

type AttachmentTargetAccessDependencies = {
	getThings: typeof getHomeThingsCollection;
	getUsers: typeof getUsersCollection;
};

const exactThingtime = (value: unknown, expected: readonly string[]): boolean =>
	Array.isArray(value) && value.length === expected.length && expected.every((entry, index) => value[index] === entry);

const attachmentRootAclAllows = (doc: AttachmentTargetAclDoc | null, viewer: AttachmentAccessViewer): boolean => {
	if (!doc || !doc.shareId || !doc.ownerId || !Array.isArray(doc.thingtime) || !doc.thingtime.length) return false;
	if (doc.targetId !== undefined && doc.targetId !== null) return false;
	if (viewer?.id === doc.ownerId) return true;
	const acl =
		Array.isArray(doc.acl) && doc.acl.length && doc.acl.every((entry) => typeof entry === 'string')
			? (doc.acl as string[])
			: aclFromVisibility(doc.visibility) || [ACL_OWNER];
	if (acl.includes(ACL_INHERIT)) return false;
	return aclAllows(acl, viewer, doc.ownerId);
};

const canViewCommentAttachment = async (
	things: Awaited<ReturnType<typeof getHomeThingsCollection>>,
	viewer: AttachmentAccessViewer,
	attachment: AttachmentAccessDocument
): Promise<boolean> => {
	let targetId = attachment.targetId;
	if (!targetId) return false;
	const visited = new Set<string>();
	for (let depth = 0; depth < 64; depth += 1) {
		if (visited.has(targetId)) return false;
		visited.add(targetId);
		const target = (await things.findOne({ shareId: targetId } as any, {
			projection: { shareId: 1, ownerId: 1, thingtime: 1, targetId: 1, acl: 1, visibility: 1 }
		})) as AttachmentTargetAclDoc | null;
		if (!target) return false;
		const isComment = exactThingtime(target.thingtime, ['comment']) || exactThingtime(target.thingtime, ['post', 'comment']);
		if (!isComment) return attachmentRootAclAllows(target, viewer);
		if (depth === 0 && target.ownerId !== attachment.ownerId) return false;
		if (typeof target.targetId !== 'string' || !target.targetId) return false;
		targetId = target.targetId;
	}
	return false;
};

const canViewMessageAttachment = async (
	things: Awaited<ReturnType<typeof getHomeThingsCollection>>,
	viewer: AttachmentAccessViewer,
	attachment: AttachmentAccessDocument
): Promise<boolean> => {
	if (!viewer?.id || !attachment.targetId) return false;
	const message = (await things.findOne({ shareId: attachment.targetId } as any, {
		projection: { shareId: 1, ownerId: 1, thingtime: 1, targetId: 1, 'crystal.deletedAt': 1 }
	})) as any;
	if (
		!message ||
		!exactThingtime(message.thingtime, ['chat-message']) ||
		message.ownerId !== attachment.ownerId ||
		typeof message.targetId !== 'string' ||
		!message.targetId ||
		message.crystal?.deletedAt
	) {
		return false;
	}
	const memberKey = `${message.targetId}:${viewer.id}`;
	const member = await things.findOne(
		{
			thingtime: 'chat-member',
			targetId: message.targetId,
			ownerId: viewer.id,
			'crystal.memberKey': memberKey,
			'crystal.state': { $in: ['active', 'pending'] }
		} as any,
		{ projection: { shareId: 1 } }
	);
	return !!member;
};

const canViewEmojiAttachment = async (
	things: Awaited<ReturnType<typeof getHomeThingsCollection>>,
	viewer: AttachmentAccessViewer,
	attachment: AttachmentAccessDocument
): Promise<boolean> => {
	if (!viewer?.id || !attachment.targetId) return false;
	const emoji = (await things.findOne({ shareId: attachment.targetId } as any, {
		projection: { shareId: 1, ownerId: 1, thingtime: 1, targetId: 1, emojiAttachmentId: 1 }
	})) as any;
	if (
		!emoji ||
		!exactThingtime(emoji.thingtime, ['custom-emoji']) ||
		emoji.ownerId !== attachment.ownerId ||
		emoji.emojiAttachmentId !== attachment.shareId
	) {
		return false;
	}
	if (emoji.targetId === null || emoji.targetId === undefined) return true;
	if (typeof emoji.targetId !== 'string' || !emoji.targetId) return false;
	const member = await things.findOne(
		{
			thingtime: 'community-member',
			targetId: emoji.targetId,
			ownerId: viewer.id,
			'crystal.memberKey': `${emoji.targetId}:${viewer.id}`,
			'crystal.state': { $ne: 'left' }
		} as any,
		{ projection: { shareId: 1 } }
	);
	return !!member;
};

// Bound attachments authorize against one exact home target: either a
// top-level post ACL or a canonical/legacy user's current managed-media slot.
// Keep this lean: no post projection, comments, reactions, shares, graph
// lookup, attachment aggregation, recursion, or caller-selected data plane.
export const createCanViewHomeAttachmentTarget = (overrides: Partial<AttachmentTargetAccessDependencies> = {}) => {
	const dependencies: AttachmentTargetAccessDependencies = {
		getThings: getHomeThingsCollection,
		getUsers: getUsersCollection,
		...overrides
	};
	return async (viewer: AttachmentAccessViewer, attachment: AttachmentAccessDocument): Promise<boolean> => {
		const targetId = attachment.targetId;
		if (!targetId) return false;
		const things = await dependencies.getThings();

		if (attachment.attachmentPurpose === 'profile') {
			// Query by globally unique shareId first, then validate the exact canonical
			// user shape. A colliding/malformed home Thing must not fall through to a
			// legacy user row and authorize a different object.
			const thing = (await things.findOne({ shareId: targetId } as any, {
				projection: {
					shareId: 1,
					ownerId: 1,
					thingtime: 1,
					targetId: 1,
					acl: 1,
					avatarAttachmentId: 1,
					bannerAttachmentId: 1
				}
			})) as ProfileAttachmentTargetDoc | null;
			if (thing) return profileAttachmentTargetAllows(attachment, thing);
			if (!ObjectId.isValid(targetId)) return false;
			const legacy = (await (
				await dependencies.getUsers()
			).findOne({ _id: new ObjectId(targetId) }, { projection: { avatarAttachmentId: 1, bannerAttachmentId: 1 } })) as any;
			return profileAttachmentTargetAllows(
				attachment,
				legacy
					? {
							shareId: String(legacy._id),
							legacy: true,
							avatarAttachmentId: legacy.avatarAttachmentId,
							bannerAttachmentId: legacy.bannerAttachmentId
					  }
					: null
			);
		}

		if (attachment.attachmentPurpose === 'comment') {
			return canViewCommentAttachment(things, viewer, attachment);
		}
		if (attachment.attachmentPurpose === 'message') {
			return canViewMessageAttachment(things, viewer, attachment);
		}
		if (attachment.attachmentPurpose === 'emoji') {
			return canViewEmojiAttachment(things, viewer, attachment);
		}
		if (attachment.attachmentPurpose !== undefined && attachment.attachmentPurpose !== 'post') return false;
		// post-purpose media binds to top-level posts AND to webpages (builder
		// saves) — both authorize by the target's own top-level ACL
		const target = (await things.findOne(
			{ shareId: targetId, thingtime: { $in: ['post', 'webpage'] }, targetId: null } as any,
			{
				projection: { shareId: 1, ownerId: 1, thingtime: 1, targetId: 1, acl: 1, visibility: 1 }
			}
		)) as AttachmentTargetAclDoc | null;
		return attachmentTargetAclAllows(target, viewer);
	};
};

export const canViewHomeAttachmentTarget = createCanViewHomeAttachmentTarget();
