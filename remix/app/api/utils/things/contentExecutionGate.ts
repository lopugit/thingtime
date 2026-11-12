import { isTimelinePersistence } from '../timeline/persistence';
import { isDeepStrictEqual } from 'node:util';
import { getThingsCollection } from '../mongodb/collections';
import { readTimelineEntries } from '../timeline/repository';
import type { TimelineEvent } from '../../../timeline/contract';
import { currentContentStorageSizeBytes, thingStorageSizeBytes, StorageMutationError } from '../storage/storageCore';
import { applyUserStorageDelta } from '../storage/userStorage';
import { withBoundTimelineRead } from './persistenceContext';
import { getThingsTransactionBinding, matchesThingVersion, type ThingsTransaction } from './persistence';

export const CREATION_COMPLETION_ADAPTER = 'reviewed-creation-graph-result';
export type ContentExecutionHold = {
	version: 1;
	operationId: string;
	completionEventId: string;
	rootId: string;
	binding: string;
};
export function contentExecutionHold(input: ContentExecutionHold): ContentExecutionHold {
	if (!input || Object.keys(input).sort().join(',') !== 'binding,completionEventId,operationId,rootId,version' || input.version !== 1 ||
		![input.operationId, input.completionEventId, input.rootId].every(value => typeof value === 'string' && !!value) ||
		!/^[a-f0-9]{64}$/.test(input.binding)) throw Error('Invalid content execution hold');
	return { ...input };
}

/** Trusted composition may attach a new hold to an already-restored ordinary
 * folder. Never replace an active hold or change user content/timestamps. The
 * envelope delta and epoch belong to the same current-owner transaction. */
export async function attachContentExecutionHold(things: any, before: any, input: ContentExecutionHold, session: any, transaction?: ThingsTransaction) {
 const hold = contentExecutionHold(input);
 const native = isTimelinePersistence(things);
 if (native) {
  if (!transaction || !before?.ownerId) throw new StorageMutationError(409, 'storage_conflict', 'Execution hold requires its native content transaction');
  const binding = getThingsTransactionBinding(transaction, before.ownerId);
  if (binding.kind !== 'native' || binding.session !== session) throw new StorageMutationError(409, 'storage_conflict', 'Execution hold requires the exact native content session');
  things.assertTransaction(binding.session);
 }
 if ((!native && !session?.inTransaction?.()) || !before?.ownerId || currentContentStorageSizeBytes(before) === null) throw new StorageMutationError(409, 'storage_conflict', 'Execution hold requires accounted owned content');
 const expected = { id: before.shareId, identity: before._id, updatedAt: before.updatedAt, headId: before.timelineHeadId ?? null, sizeBytes: before.sizeBytes };
 if (native) {
  const current = await transaction!.readExact(before.shareId);
  if (!current || current.ownerId !== before.ownerId || !matchesThingVersion(current, expected) || !isDeepStrictEqual(current.executionHold, before.executionHold)) throw new StorageMutationError(409, 'storage_conflict', 'Content changed before attaching execution hold');
 }
 if (before.executionHold && JSON.stringify(before.executionHold) !== JSON.stringify(hold) && await contentExecutionHeld(before, things, session)) throw new StorageMutationError(409, 'storage_conflict', 'Another creation still owns this content');
 const after = { ...before, executionHold: hold }; after.sizeBytes = thingStorageSizeBytes(after);
 await applyUserStorageDelta(before.ownerId, after.sizeBytes - before.sizeBytes, session);
 const changed = native ? await transaction!.compareAndSwap(expected, after) : (await things.updateOne({ _id: before._id, shareId: before.shareId, ownerId: before.ownerId, timelineHeadId: before.timelineHeadId, sizeBytes: before.sizeBytes }, { $set: { executionHold: hold, sizeBytes: after.sizeBytes } }, { session })).matchedCount === 1;
 if (!changed) throw new StorageMutationError(409, 'storage_conflict', 'Content changed before attaching execution hold');
 await recordCreationContentEpoch(things, before, after, session);
}

/** Every canonical ordinary mutation already records its Timeline revision in
 * the content transaction. Touch the active creation root in that same session
 * so a bounded final publication CAS cannot race an edit/move/delete of a held
 * row. Completed operations do not fence subsequent ordinary editing. */
export async function recordCreationContentEpoch(things: any, before: any, after: any, session: any) {
	const seen = new Set<string>();
	for (const doc of [before, after]) {
		if (!doc?.executionHold) continue;
		const hold = contentExecutionHold(doc.executionHold);
		const identity = JSON.stringify([doc.ownerId, hold.rootId, hold.binding]);
		if (seen.has(identity)) continue;
		seen.add(identity);
		const filter = { shareId: hold.rootId, ownerId: doc.ownerId, 'creationCheckpoint.binding': hold.binding,
			'creationCheckpoint.operationId': hold.operationId, 'creationCheckpoint.phase': { $in: ['planning', 'restoring'] } };
		if (isTimelinePersistence(things) && !things.integrity) throw new Error('This Timeline provider cannot fence creation content');
		const root = isTimelinePersistence(things) ? await things.integrity!.creationRoot(doc.ownerId, hold) : await things.findOne(filter, { session, projection: { 'creationCheckpoint.contentEpoch': 1 } });
		if (!root) continue;
		const epoch = root.creationCheckpoint?.contentEpoch ?? 0;
		if (!Number.isSafeInteger(epoch) || epoch < 0 || epoch === Number.MAX_SAFE_INTEGER)
			throw new StorageMutationError(409, 'storage_conflict', 'The active creation content fence requires recovery');
		const updated = isTimelinePersistence(things) ? { modifiedCount: await things.integrity!.advanceCreationEpoch(doc.ownerId, hold, root.creationCheckpoint?.contentEpoch) ? 1 : 0 } : await things.updateOne({ ...filter, ...(root.creationCheckpoint?.contentEpoch === undefined
			? { 'creationCheckpoint.contentEpoch': { $exists: false } } : { 'creationCheckpoint.contentEpoch': epoch }) },
			{ $inc: { 'creationCheckpoint.contentEpoch': 1 } }, { session });
		if (updated.modifiedCount !== 1) throw new StorageMutationError(409, 'storage_conflict', 'The active creation changed during this mutation');
	}
}

/** A server-only envelope, excluded from ordinary content snapshots. Archived
 * receipts/ACLs and an authored crystal property never satisfy this gate. The
 * caller must perform normal current ACL checks before exposing content. */
export async function contentExecutionHeld(doc: { ownerId?: string; executionHold?: ContentExecutionHold }, things?: any, session?: any) {
	if (doc.executionHold === undefined) return false;
	const hold = contentExecutionHold(doc.executionHold);
	if (!doc.ownerId) return true;
	const entries = things != null ? await readTimelineEntries(things, doc.ownerId, [hold.completionEventId], session) :
		await (withBoundTimelineRead(doc.ownerId, port => readTimelineEntries(port, doc.ownerId!, [hold.completionEventId])) ??
			getThingsCollection().then(collection => readTimelineEntries(collection, doc.ownerId!, [hold.completionEventId], session)));
	const accepted = entries[0]?.event;
	return !holdCompleted(doc.ownerId, hold, accepted);
}
function holdCompleted(ownerId: string, hold: ContentExecutionHold, accepted?: TimelineEvent) {
	const value = accepted?.after?.value as any;
	return !!accepted && accepted.source === 'api' && accepted.actorId === ownerId && accepted.ownerId === ownerId &&
		accepted.operationId === hold.operationId && accepted.thingId === hold.rootId && accepted.branchId === 'main' &&
		accepted.before === null && accepted.parentIds.length === 0 && accepted.dependencies.length === 0 && accepted.mode === 'effect' &&
		accepted.operation === 'effect' && accepted.after?.adapter === CREATION_COMPLETION_ADAPTER && accepted.after.version === 1 &&
		value?.binding === hold.binding && Object.keys(value).sort().join(',') === 'binding,count' &&
		Number.isSafeInteger(value.count) && value.count > 0;
}

/** Projection batches group by owner and use bounded canonical Timeline
 * reads, never one extra receipt query for each card in a restored folder. */
export async function contentExecutionStates(docs: { shareId: string; ownerId: string; executionHold?: ContentExecutionHold }[]) {
	const states = new Map<string, boolean>();
	const groups = new Map<string, Map<string, ContentExecutionHold>>();
	for (const doc of docs) if (doc.executionHold !== undefined) {
		const hold = contentExecutionHold(doc.executionHold);
		const group = groups.get(doc.ownerId) ?? new Map();
		group.set(hold.completionEventId, hold); groups.set(doc.ownerId, group);
	}
	if (!groups.size) return states;
	let mongoThings: any;
	for (const [ownerId, group] of groups) {
		const ids = [...group.keys()], entries = new Map<string, TimelineEvent>();
		const read = async (things: any) => {
			for (let offset = 0; offset < ids.length; offset += 128) {
				for (const entry of await readTimelineEntries(things, ownerId, ids.slice(offset, offset + 128))) entries.set(entry.event.id, entry.event);
			}
		};
		const native = withBoundTimelineRead(ownerId, read);
		if (native) await native;
		else { mongoThings ??= await getThingsCollection(); await read(mongoThings); }
		for (const doc of docs) if (doc.ownerId === ownerId && doc.executionHold) {
			const hold = contentExecutionHold(doc.executionHold);
			states.set(doc.shareId, !holdCompleted(ownerId, hold, entries.get(hold.completionEventId)));
		}
	}
	return states;
}
