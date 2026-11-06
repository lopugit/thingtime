import { getThingsCollection } from '../mongodb/collections';
import { readTimelineEntries } from '../timeline/repository';
import type { TimelineEvent } from '../../../timeline/contract';
import { StorageMutationError } from '../storage/storageCore';

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
		const root = await things.findOne(filter, { session, projection: { 'creationCheckpoint.contentEpoch': 1 } });
		if (!root) continue;
		const epoch = root.creationCheckpoint?.contentEpoch ?? 0;
		if (!Number.isSafeInteger(epoch) || epoch < 0 || epoch === Number.MAX_SAFE_INTEGER)
			throw new StorageMutationError(409, 'storage_conflict', 'The active creation content fence requires recovery');
		const updated = await things.updateOne({ ...filter, ...(root.creationCheckpoint?.contentEpoch === undefined
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
	const collection = things ?? await getThingsCollection();
	const accepted = (await readTimelineEntries(collection, doc.ownerId, [hold.completionEventId], session))[0]?.event;
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
	const things = await getThingsCollection();
	for (const [ownerId, group] of groups) {
		const ids = [...group.keys()], entries = new Map<string, TimelineEvent>();
		for (let offset = 0; offset < ids.length; offset += 128) {
			for (const entry of await readTimelineEntries(things, ownerId, ids.slice(offset, offset + 128))) entries.set(entry.event.id, entry.event);
		}
		for (const doc of docs) if (doc.ownerId === ownerId && doc.executionHold) {
			const hold = contentExecutionHold(doc.executionHold);
			states.set(doc.shareId, !holdCompleted(ownerId, hold, entries.get(hold.completionEventId)));
		}
	}
	return states;
}
