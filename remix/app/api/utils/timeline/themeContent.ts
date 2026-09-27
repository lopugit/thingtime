import { parseTimelineEvent } from '../../../timeline/contract.ts';
import { themeContentSnapshot } from '../../../timeline/themeContent.ts';
import { currentContentStorageSizeBytes, thingStorageSizeBytes, StorageMutationError } from '../storage/storageCore';
import { markUserStorageNeedsReconcile, retainDeletedThingStorage } from '../storage/userStorage';
import { appendTimelineEvent } from './repository.ts';
import type { ThingMutationCapture } from './recordMutation.ts';

const snapshot = (doc: any) => doc ? themeContentSnapshot({
	crystal: doc.crystal, tags: doc.tags ?? [],
	visibility: Array.isArray(doc.acl) && doc.acl.includes('tt:all') ? 'public' : 'private',
	folderId: doc.folderId ?? null
}) : null;

export function themeMutationEvent(before: any, after: any, capture: ThingMutationCapture) {
	const target = after ?? before;
	for (const doc of [before, after].filter(Boolean)) {
		if (!doc.shareId || !doc.ownerId || doc.shareId !== target.shareId || doc.ownerId !== target.ownerId ||
			!Array.isArray(doc.thingtime) || doc.thingtime.length !== 1 || doc.thingtime[0] !== 'theme') {
			throw new StorageMutationError(409, 'storage_conflict', 'Theme history identity changed');
		}
	}
	if (!target) throw new Error('Theme history requires a saved theme');
	const previous = snapshot(before), next = snapshot(after);
	if (JSON.stringify(previous) === JSON.stringify(next)) return null;
	const operation = !before ? 'create' : !after ? 'delete' : 'update';
	return parseTimelineEvent({ formatVersion: 1, id: capture.id, ownerId: target.ownerId, thingId: target.shareId,
		branchId: 'main', parentIds: before?.timelineHeadId ? [before.timelineHeadId] : [], operationId: capture.operationId,
		actorId: capture.actorId, source: capture.source, clientId: null, occurredAt: capture.now.toISOString(),
		mode: 'revision', operation, label: { create: 'Created theme', update: 'Edited theme', delete: 'Deleted theme' }[operation],
		before: previous, after: next, dependencies: [] });
}

/** The dedicated HOME writer calls this inside its content transaction. A
 * deletion already refunded its before-image; move only the approved retained
 * payload into history, without admitting new growth at a full allowance. */
export async function recordThemeMutation(things: any, before: any, after: any, capture: ThingMutationCapture, session: any) {
	if (!session) throw new Error('Theme history requires a transaction');
	const event = themeMutationEvent(before, after, capture);
	if (!event) return null;
	const entry = await appendTimelineEvent(things, event, session, { plane: 'home', ...(before && !after ? { debit: async (ownerId: string, bytes: number) => {
		if (bytes > thingStorageSizeBytes(before)) throw new Error('Retained theme history cannot add content during deletion');
		if (currentContentStorageSizeBytes(before) === null) await markUserStorageNeedsReconcile(ownerId, session);
		else await retainDeletedThingStorage(ownerId, bytes, session);
	} } : {}) });
	if (after) {
		const result = await things.updateOne({ _id: after._id, shareId: after.shareId, ownerId: after.ownerId, updatedAt: after.updatedAt },
			{ $set: { timelineHeadId: event.id } }, { session });
		if (result.matchedCount !== 1) throw new StorageMutationError(409, 'storage_conflict', 'Theme changed while its history was being saved');
		after.timelineHeadId = event.id;
	}
	return entry;
}
