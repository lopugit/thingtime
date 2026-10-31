// Only the authenticated owner's exact uploads may be classified. Never turn
// another target's binding into permission to rebind or delete its attachment.
export const watchUploadNeedsRestart = (docs: readonly any[], ids: readonly string[], now = new Date()): boolean => {
	if (!ids.length || new Set(ids).size !== ids.length) return false;
	const byId = new Map(docs.map((doc) => [doc.shareId, doc]));
	return ids.every((id) => {
		const doc = byId.get(id);
		if (!doc) return true;
		if (doc.targetId || (doc.attachmentPurpose !== undefined && doc.attachmentPurpose !== 'post') || doc.attachmentProfileSlot !== undefined) return false;
		return doc.attachmentState === 'deleting' ||
			(doc.attachmentExpiresAt instanceof Date && doc.attachmentExpiresAt.getTime() <= now.getTime());
	});
};
