import { ObjectId } from 'mongodb';

import { getHomeThingsCollection, getUsersCollection } from '../mongodb/collections';
import { ACL_ALL, ACL_INHERIT, ACL_OWNER, aclAllows, aclFromVisibility, type ThingVisibility } from '../../../schemas/registry';

export type AttachmentAccessViewer = { id: string; username?: string | null } | null;

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
	attachmentPurpose?: 'post' | 'profile';
	attachmentProfileSlot?: 'avatar' | 'banner';
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
	if (
		!doc ||
		!Array.isArray(doc.thingtime) ||
		doc.thingtime.length !== 1 ||
		doc.thingtime[0] !== 'post' ||
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

		if (attachment.attachmentPurpose !== undefined && attachment.attachmentPurpose !== 'post') return false;
		const target = (await things.findOne({ shareId: targetId, thingtime: 'post', targetId: null } as any, {
			projection: { shareId: 1, ownerId: 1, thingtime: 1, targetId: 1, acl: 1, visibility: 1 }
		})) as AttachmentTargetAclDoc | null;
		return attachmentTargetAclAllows(target, viewer);
	};
};

export const canViewHomeAttachmentTarget = createCanViewHomeAttachmentTarget();
