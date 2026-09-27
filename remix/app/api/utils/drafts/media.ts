import { getHomeThingsCollection } from '../mongodb/collections';
import { ACL_INHERIT, ACL_OWNER } from '~/schemas/registry';
import { toAttachmentPublicMetadata } from '../attachments/attachmentCore';
import { AttachmentBindingError } from '../attachments/attachmentStore';

/** Only active, private, owned working drafts can donate media to a published post. */
export async function ownedMediaDraftIds(ownerId: string, targetIds: string[], session?: any): Promise<string[]> {
	if (!targetIds.length) return [];
	const rows = await (await getHomeThingsCollection())
		.find(
			{ shareId: { $in: [...new Set(targetIds)] }, ownerId, thingtime: ['draft'], acl: [ACL_OWNER], draftMode: 'draft', draftDeleted: { $ne: true } },
			{ session, projection: { shareId: 1 } }
		)
		.toArray();
	return rows.map((row) => row.shareId);
}
export async function bindDraftAttachments(ownerId: string, draftId: string, ids: string[], session: any, purpose: 'post' | 'comment' = 'post') {
	if (!ids.length) return;
	const things = await getHomeThingsCollection(),
		now = new Date();
	const filter = {
		shareId: { $in: ids },
		ownerId,
		thingtime: 'attachment',
		attachmentState: 'ready',
		attachmentPurpose: purpose,
		attachmentProfileSlot: { $exists: false },
		$or: [
			{ targetId: draftId, attachmentExpiresAt: { $exists: false } },
			{ targetId: { $exists: false }, attachmentExpiresAt: { $gt: now } }
		]
	};
	const result = await things.updateMany(
		filter,
		{ $set: { targetId: draftId, acl: [ACL_INHERIT], updatedAt: now }, $unset: { attachmentExpiresAt: '' } },
		{ session }
	);
	if (result.matchedCount !== ids.length) throw new AttachmentBindingError(409, 'Some draft files are unavailable or belong to another post');
}
export async function releaseDraftAttachments(ownerId: string, draftId: string, kept: string[], session: any) {
	// Rejoin the canonical expiry/reaper lifecycle, which deletes bytes and refunds quota.
	await (
		await getHomeThingsCollection()
	).updateMany(
		{ ownerId, thingtime: 'attachment', targetId: draftId, shareId: { $nin: kept }, attachmentState: 'ready' },
		{ $set: { acl: [ACL_OWNER], attachmentExpiresAt: new Date(Date.now() + 86400000), updatedAt: new Date() }, $unset: { targetId: '' } },
		{ session }
	);
}
export async function draftAttachmentMetadata(ownerId: string, draftId: string, ids: string[]) {
	if (!ids.length) return [];
	const docs = await (await getHomeThingsCollection())
		.find({ ownerId, thingtime: 'attachment', targetId: draftId, shareId: { $in: ids }, attachmentState: 'ready' })
		.toArray();
	const map = new Map<string, any>(docs.map((doc) => [doc.shareId, doc]));
	return ids.flatMap((id) => {
		const doc = map.get(id);
		if (!doc || doc.moderation?.status === 'blocked') return [];
		const metadata = toAttachmentPublicMetadata(id, doc.crystal);
		return metadata ? [{ ...metadata, pending: doc.moderation?.status === 'pending', nsfw: doc.moderation?.status === 'nsfw' }] : [];
	});
}
