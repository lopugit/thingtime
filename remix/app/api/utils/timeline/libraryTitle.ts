import { parseTimelineEvent } from '../../../timeline/contract.ts';
import { libraryTitleSnapshot } from '../../../timeline/libraryTitle.ts';
import { StorageMutationError } from '../storage/storageCore';
import { appendTimelineEvent } from './repository.ts';
import type { ThingMutationCapture } from './recordMutation.ts';

const names: Record<string, string> = { theme: 'theme', 'feed-algorithm': 'algorithm', 'custom-emoji': 'emoji', 'chat-archive': 'chat archive' };

export function libraryTitleMutationEvent(before: any, after: any, capture: ThingMutationCapture) {
	const kind = before?.thingtime?.[0];
	if (!before?.shareId || !before?.ownerId || before.ownerId !== after?.ownerId || before.shareId !== after?.shareId ||
		!Array.isArray(before.thingtime) || before.thingtime.length !== 1 || !Object.prototype.hasOwnProperty.call(names, kind) ||
		JSON.stringify(before.thingtime) !== JSON.stringify(after.thingtime)) {
		throw new StorageMutationError(409, 'storage_conflict', 'This Thing needs its dedicated history writer');
	}
	const previous = libraryTitleSnapshot(before.crystal?.title);
	const next = libraryTitleSnapshot(after.crystal?.title);
	if (JSON.stringify(previous) === JSON.stringify(next)) return null;
	return parseTimelineEvent({ formatVersion: 1, id: capture.id, ownerId: before.ownerId, thingId: before.shareId,
		branchId: 'main', parentIds: before.timelineHeadId ? [before.timelineHeadId] : [], operationId: capture.operationId,
		actorId: capture.actorId, source: capture.source, clientId: null, occurredAt: capture.now.toISOString(),
		mode: 'revision', operation: 'update', label: `Renamed ${names[kind]}`,
		before: previous, after: next, dependencies: [] });
}

/** Called after the display-title CAS, inside that same transaction. Appending
 * history or updating the head must roll back with the title on any failure. */
export async function recordLibraryTitle(things: any, before: any, after: any, capture: ThingMutationCapture, session: any) {
	if (!session) throw new Error('Library title history requires a transaction');
	const event = libraryTitleMutationEvent(before, after, capture);
	if (!event) return null;
	const entry = await appendTimelineEvent(things, event, session);
	const result = await things.updateOne({ _id: after._id, shareId: after.shareId, ownerId: after.ownerId, updatedAt: after.updatedAt },
		{ $set: { timelineHeadId: event.id } }, { session });
	if (result.matchedCount !== 1) throw new StorageMutationError(409, 'storage_conflict', 'Thing changed while its title history was being saved');
	after.timelineHeadId = event.id;
	return entry;
}
