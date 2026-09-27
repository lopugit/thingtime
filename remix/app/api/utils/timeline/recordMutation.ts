import { TIMELINE_SNAPSHOT_MAX_BYTES } from '../../../timeline/snapshotParts.ts';
import { splitLargeThingSnapshot, storeTimelineSnapshotParts } from './snapshotParts.ts';
import { randomUUID } from 'node:crypto';
import { copyBoundedJson } from '../../../utils/boundedJson.ts';
import { TIMELINE_RESERVED_PREFIX, parseTimelineEvent, type TimelineEvent, type TimelineSnapshot } from '../../../timeline/contract.ts';
import { appendTimelineEvent } from './repository.ts';
import { isProtectedThingtime } from '../../../schemas/registry.ts';
import { currentContentStorageSizeBytes, thingStorageSizeBytes } from '../storage/storageCore.ts';
import { markUserStorageNeedsReconcile, retainDeletedThingStorage } from '../storage/userStorage';
import { timelineMutationContext } from './mutationContext';

/** Explicit content projection. Never copy a Mongo document wholesale: secure,
 * tokens, hidden-link keys, grants and platform ledger state are not revisions.
 * Dedicated protected families must supply their own approved snapshot adapter. */
export function thingContentSnapshot(doc: any): TimelineSnapshot | null {
	if (!doc) return null;
	return {
		adapter: 'thing-content', version: 1,
		value: copyBoundedJson({
			thingtime: doc.thingtime ?? ['data'], crystal: doc.crystal ?? null, extended: doc.extended ?? null,
			tags: doc.tags ?? [], acl: doc.acl ?? ['tt:user'], folderId: doc.folderId ?? null, targetId: doc.targetId ?? null,
			geo: doc.geo ?? null
		}, { maxBytes: TIMELINE_SNAPSHOT_MAX_BYTES, maxDepth: 90, maxNodes: 90_000, sortKeys: true }, 'Thing revision')
	};
}

export type ThingMutationCapture = {
	id: string;
	operationId: string;
	actorId: string;
	source: TimelineEvent['source'];
	label?: string;
	operation?: TimelineEvent['operation'];
	parentIds?: string[];
	branchId?: string;
	now: Date;
};

/** Create ONCE, outside transaction retry callbacks, preserving operation ids. */
export const newThingMutationCapture = (actorId: string, source?: TimelineEvent['source']): ThingMutationCapture => {
	// Explicit internal captures (restore/merge, for example) retain their own
	// identity contract. Ordinary writes inherit only trusted executor context.
	const context = source === undefined ? timelineMutationContext(actorId) : null;
	return { id: randomUUID(), operationId: context?.operationId ?? randomUUID(), actorId,
		source: source ?? context?.source ?? 'api', now: new Date() };
};

export function prepareThingMutation(before: any, after: any, capture: ThingMutationCapture) {
	const target = after ?? before;
	if (!target?.shareId || !target?.ownerId || target.shareId.startsWith(TIMELINE_RESERVED_PREFIX)) return null;
	// Protected credentials/operational kinds require an explicit outcome
	// adapter; a future generic caller cannot accidentally snapshot their crystal.
	if (isProtectedThingtime(target.thingtime ?? [])) return null;
	if (before && after && (before.shareId !== after.shareId || before.ownerId !== after.ownerId)) throw new Error('A Timeline mutation cannot change Thing identity');
	const previous = thingContentSnapshot(before);
	const next = thingContentSnapshot(after);
	if (JSON.stringify(previous) === JSON.stringify(next) && !capture.operation) return null;
	const operation = capture.operation ?? (!before ? 'create' : !after ? 'delete' : 'update');
	const beforeParts = splitLargeThingSnapshot(previous, target.ownerId, capture.id, 'before');
	const afterParts = splitLargeThingSnapshot(next, target.ownerId, capture.id, 'after');
	const event = parseTimelineEvent({
		formatVersion: 1, id: capture.id, ownerId: target.ownerId, thingId: target.shareId,
		branchId: capture.branchId ?? 'main', parentIds: capture.parentIds ?? (before?.timelineHeadId ? [before.timelineHeadId] : []),
		operationId: capture.operationId, actorId: capture.actorId, source: capture.source, clientId: null,
		occurredAt: capture.now.toISOString(), mode: 'revision', operation,
		label: capture.label ?? ({ create: 'Created Thing', update: 'Edited Thing', delete: 'Deleted Thing', restore: 'Restored version', merge: 'Merged versions', effect: 'Completed action' }[operation]),
		before: beforeParts.snapshot, after: afterParts.snapshot, dependencies: []
	});
	return { event, parts: [...beforeParts.parts, ...afterParts.parts] };
}

export function thingMutationEvent(before: any, after: any, capture: ThingMutationCapture): TimelineEvent | null {
	return prepareThingMutation(before, after, capture)?.event ?? null;
}

/** Call within the content transaction after its successful CAS. A thrown
 * append/accounting error rolls back the content and head as one operation. */
export async function recordThingMutation(things: any, before: any, after: any, capture: ThingMutationCapture, session: any) {
	const prepared = prepareThingMutation(before, after, capture);
	if (!prepared) return null;
	const { event, parts } = prepared;
	// An untrusted legacy byte stamp must not prevent deletion. The old payload
	// moves into a fully stamped history record; the existing delete path and
	// this append fence the ledger for exact reconciliation, never guess a delta.
	const entry = await appendTimelineEvent(things, event, session, before && !after ? { debit: async (ownerId, bytes) => {
		if (bytes !== thingStorageSizeBytes(before)) throw new Error('Retained deletion bytes must equal the removed Thing payload');
		if (currentContentStorageSizeBytes(before) === null) await markUserStorageNeedsReconcile(ownerId, session);
		else await retainDeletedThingStorage(ownerId, bytes, session);
	} } : {});
	await storeTimelineSnapshotParts(things, parts, session, capture.now);
	if (after) {
		const result = await things.updateOne({ shareId: after.shareId, ownerId: after.ownerId }, { $set: { timelineHeadId: event.id } }, { session });
		if (result.matchedCount !== 1) throw new Error('Timeline mutation lost its Thing');
		after.timelineHeadId = event.id;
	}
	return entry;
}
