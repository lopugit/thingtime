import { getHomeThingsCollection } from '../mongodb/collections';
import { ACL_INHERIT, ACL_OWNER, aclAllows, aclFromVisibility, type ThingVisibility } from '../../../schemas/registry';

export type AttachmentAccessViewer = { id: string; username?: string | null } | null;

type AttachmentTargetAclDoc = {
	shareId: string;
	ownerId: string;
	thingtime?: unknown;
	targetId?: unknown;
	acl?: unknown;
	visibility?: ThingVisibility;
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

// Attachments bind only to exact top-level post Things, so their audience is
// one direct ACL evaluation. Keep this authorization home-pinned and lean: no
// post projection, profile hydration, comments, reactions, shares, graph
// lookup, attachment aggregation, recursion, or caller-selected data plane.
export const canViewHomeAttachmentTarget = async (viewer: AttachmentAccessViewer, targetId: string): Promise<boolean> => {
	const target = (await (
		await getHomeThingsCollection()
	).findOne({ shareId: targetId, thingtime: 'post', targetId: null } as any, {
		projection: { shareId: 1, ownerId: 1, thingtime: 1, targetId: 1, acl: 1, visibility: 1 }
	})) as AttachmentTargetAclDoc | null;
	return attachmentTargetAclAllows(target, viewer);
};
