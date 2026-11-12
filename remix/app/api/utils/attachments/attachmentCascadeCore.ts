export type AttachmentCascadeCandidate = {
	thingtime?: unknown;
	kind?: unknown;
	targetId?: unknown;
	ownerId?: unknown;
};

export type AttachmentCascadeCleanupTarget = { shareId: string; ownerId: string };

const isAttachmentCandidate = (doc: AttachmentCascadeCandidate): boolean =>
	doc.kind === 'attachment' || doc.thingtime === 'attachment' || (Array.isArray(doc.thingtime) && doc.thingtime.includes('attachment'));

// Generic Thing cascades may discover protected attachments several levels
// below the requested root (post -> comment -> reply -> attachment). Reduce
// them to exact owner/target pairs so S3 cleanup can run before Mongo refund.
export const attachmentCascadeCleanupTargets = (descendants: readonly AttachmentCascadeCandidate[]): AttachmentCascadeCleanupTarget[] => {
	const targets = new Map<string, AttachmentCascadeCleanupTarget>();
	for (const doc of descendants) {
		if (!isAttachmentCandidate(doc) || typeof doc.targetId !== 'string' || !doc.targetId || typeof doc.ownerId !== 'string' || !doc.ownerId) {
			continue;
		}
		targets.set(`${doc.ownerId}\0${doc.targetId}`, { shareId: doc.targetId, ownerId: doc.ownerId });
	}
	return [...targets.values()].sort((left, right) => left.shareId.localeCompare(right.shareId) || left.ownerId.localeCompare(right.ownerId));
};
