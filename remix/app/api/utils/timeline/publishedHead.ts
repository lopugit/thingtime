import { timelinePersistence } from './persistence';
import {
	TIMELINE_BRANCH_KIND,
	TIMELINE_BRANCH_HEAD_KIND,
	parseTimelineBranch,
	parseTimelineBranchHead,
	timelineBranchHeadId
} from '../../../timeline/branches.ts';
import { TIMELINE_RESERVED_PREFIX, type TimelineEntry } from '../../../timeline/contract.ts';
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry.ts';
import { StorageMutationError } from '../storage/storageCore.ts';
import {
	branchFromDoc,
	readTimelineBranchHead,
	timelineBranchThingId,
	timelineBranchHeadThingId,
	packTimelineBranchRecord
} from './branchEnvelope.ts';

export const isPublishedTimelineEvent = (entry: TimelineEntry) =>
	entry.event.mode === 'revision' &&
	entry.event.source !== 'client' &&
	entry.event.branchId === 'main' &&
	!entry.event.thingId.startsWith(TIMELINE_RESERVED_PREFIX);

/** The same canonical branch/head records as private variations. One head per
 * Thing survives deletion; no target, branch or folder accumulates history IDs.
 * Only trusted committed mutations advance Published. */
export async function recordPublishedTimelineHead(things: any, entry: TimelineEntry, folderId: string, session: any) {
	if (!isPublishedTimelineEvent(entry)) return;
	const persistence = timelinePersistence(things, session);
	return persistence.guard(entry.event.ownerId, session, async () => {
		persistence.assertTransaction(session);
		const { event, receipt } = entry;
		const ownerId = event.ownerId,
			branchId = 'main';
		const branchShareId = timelineBranchThingId(ownerId, branchId);
		const priorDoc = await persistence.recordByIdentity(branchShareId);
		const branch = priorDoc
			? branchFromDoc(priorDoc)
			: parseTimelineBranch({ formatVersion: 1, id: branchId, ownerId, name: 'Published', createdAt: receipt.acceptedAt });
		if (branch.ownerId !== ownerId || branch.id !== branchId) throw new Error('Invalid Published branch identity');
		const current = await readTimelineBranchHead(things, ownerId, branchId, event.thingId, session);
		if (current?.eventId === event.id) return;
		if ((current?.revision ?? 0) >= Number.MAX_SAFE_INTEGER)
			throw new StorageMutationError(409, 'storage_conflict', 'Published history revision limit reached.');
		const updatedAt = new Date(Math.max(Date.parse(receipt.acceptedAt), current ? Date.parse(current.updatedAt) + 1 : 0)).toISOString();
		const head = parseTimelineBranchHead({
			formatVersion: 1,
			id: timelineBranchHeadId(branchId, event.thingId),
			ownerId,
			branchId,
			thingId: event.thingId,
			eventId: event.id,
			revision: (current?.revision ?? 0) + 1,
			createdAt: current?.createdAt ?? updatedAt,
			updatedAt
	});
	const common = {
		schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
		ownerId,
		acl: ['tt:user'],
		folderId,
		extended: null,
		tags: [],
		storageClass: 'control'
	};
	if (!priorDoc)
		await persistence.insert([
			{
				...common,
				shareId: branchShareId,
				thingtime: [TIMELINE_BRANCH_KIND],
				targetId: null,
				crystal: { name: branch.name },
				createdAt: new Date(receipt.position),
				updatedAt: new Date(updatedAt),
				...packTimelineBranchRecord(branch)
			}
		]);
	const headId = timelineBranchHeadThingId(ownerId, branchId, event.thingId);
	if (current) {
		const changed = await persistence.advanceBranchHead(headId, ownerId, current.revision, { ...packTimelineBranchRecord(head), branchRevision: head.revision, updatedAt: new Date(updatedAt) });
		if (!changed) throw new StorageMutationError(409, 'storage_conflict', 'Published history changed during this operation.');
	} else
		await persistence.insert([
			{
				...common,
				shareId: headId,
				thingtime: [TIMELINE_BRANCH_HEAD_KIND],
				parentId: branchShareId,
				targetId: event.thingId,
				crystal: { name: 'Published version', targetId: branchShareId, linkKind: TIMELINE_BRANCH_HEAD_KIND },
				branchRevision: head.revision,
				createdAt: new Date(receipt.position),
				updatedAt: new Date(updatedAt),
				...packTimelineBranchRecord(head)
			}
		]);
	});
}
