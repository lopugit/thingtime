import { getHomeThingsCollection } from '../mongodb/collections';
import { MAX_ATTACHMENTS_PER_TARGET } from '../attachments/attachmentStore';
import { orderAttachmentDocsByStoredSort } from '../attachments/attachmentCore';
import type { ThingDoc } from '../things/things';

// Discover relational galleries in one bounded home-store query. Discovery is
// not authorization: the normal copy service rechecks every returned file.
export const createListForkBoundMedia = (collection = getHomeThingsCollection) => async (docs: ThingDoc[]): Promise<{ id: string; targetId: string }[]> => {
	if (!docs.length) return [];
	const targets = new Map(docs.map((doc) => [doc.shareId, doc.ownerId]));
	const limit = docs.length * MAX_ATTACHMENTS_PER_TARGET;
	const found = await (await collection()).find({
		thingtime: 'attachment', attachmentState: 'ready',
		$and: [
			{ $or: docs.map((doc) => ({ targetId: doc.shareId, ownerId: doc.ownerId })) },
			{ $or: [{ attachmentPurpose: 'post' }, { attachmentPurpose: { $exists: false } }] }
		]
	} as any, { projection: { shareId: 1, ownerId: 1, targetId: 1, attachmentSortIndex: 1 } })
		.sort({ createdAt: 1, shareId: 1 }).limit(limit + 1).toArray() as Array<{ shareId: string; ownerId: string; targetId: string; attachmentSortIndex?: unknown }>;
	if (found.length > limit) throw new Error('The copied app has too many attached files');
	return orderAttachmentDocsByStoredSort(found).filter((file) => typeof file.targetId === 'string' && targets.get(file.targetId) === file.ownerId)
		.map((file) => ({ id: file.shareId, targetId: file.targetId as string }));
};

export const listForkBoundMedia = createListForkBoundMedia();
