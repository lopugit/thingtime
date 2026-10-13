import { createHash } from 'node:crypto';
import {
	TIMELINE_VERSION_NAME_KIND, TIMELINE_VERSION_NAME_LABELS, parseTimelineVersionName, parseTimelineVersionNameCommand, timelineVersionNameEventId, timelineVersionNameId,
	type TimelineVersionName, type TimelineVersionNameCommand, type TimelineVersionNameResult
} from '../../../timeline/versionNames.ts';
import { parseTimelineEvent, type TimelineSnapshot } from '../../../timeline/contract.ts';
import { binaryBytes, fromBin, toBin } from '../auth/binary.ts';
import { getThingsCollection, withMongoTransaction } from '../mongodb/collections';
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry.ts';
import { applyUserStorageDelta } from '../storage/userStorage';
import { StorageMutationError } from '../storage/storageCore.ts';
import { appendTimelineEvent, readTimelineEntries, timelineEventThingId, timelineFolderId } from './repository.ts';

/** One protected relational Thing per (owner, event). The event stays immutable:
 * the name points at its event Thing through targetId (shared index), keeps its
 * text only in the secure record, and never becomes a field or array on the
 * event, the Thing or the Timeline folder. The record is unbilled control
 * metadata; every name, rename and clear appends a metered effect event. */
const digest = (parts: unknown) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const refuse = (status: number, message: string): never => { throw new StorageMutationError(status, status === 409 ? 'storage_conflict' : 'storage_invariant', message); };
export const TIMELINE_VERSION_NAME_MAX_BYTES = 4096;
export const timelineVersionNameThingId = (ownerId: string, eventId: string) => `timeline-version-name-${digest([ownerId, eventId])}`;
export const packTimelineVersionName = (name: TimelineVersionName) => ({ timelineVersionNameVersion: 1, secure: toBin(JSON.stringify(name)) });
export const versionNameFromDoc = (doc: any): TimelineVersionName => {
	const bytes = binaryBytes(doc?.secure);
	if (!doc?.thingtime?.includes(TIMELINE_VERSION_NAME_KIND) || doc.timelineVersionNameVersion !== 1 || bytes === null || bytes < 1 || bytes > TIMELINE_VERSION_NAME_MAX_BYTES) throw new Error('Invalid Timeline version name envelope');
	const name = parseTimelineVersionName(JSON.parse(fromBin(doc.secure)));
	const eventShareId = timelineEventThingId(name.ownerId, name.eventId);
	if (doc.ownerId !== name.ownerId || doc.shareId !== timelineVersionNameThingId(name.ownerId, name.eventId) || doc.targetId !== eventShareId || doc.nameRevision !== name.revision ||
		doc.crystal?.name !== 'Version name' || doc.crystal?.targetId !== eventShareId || doc.crystal?.linkKind !== TIMELINE_VERSION_NAME_KIND) throw new Error('Timeline version name envelope does not match its record');
	return name;
};

/** ONE bounded owner-scoped query per batch over deterministic shareIds; at most one name per event.
 * A cleared name leaves a tombstone record (no secure payload, `timelineVersionNameCleared`) so the
 * revision keeps counting across lives; tombstones never read as names. */
export async function readTimelineVersionNames(things: any, ownerId: string, eventIds: string[], session?: any): Promise<TimelineVersionName[]> {
	if (eventIds.length > 128) throw new Error('Too many Timeline version name sources requested.');
	const ids = [...new Set(eventIds)];
	if (!ownerId || !ids.length) return [];
	const docs = await things.find({ ownerId, thingtime: TIMELINE_VERSION_NAME_KIND, shareId: { $in: ids.map(id => timelineVersionNameThingId(ownerId, id)) } },
		{ ...(session ? { session } : {}), projection: { _id: 0, shareId: 1, ownerId: 1, targetId: 1, thingtime: 1, timelineVersionNameVersion: 1, timelineVersionNameCleared: 1, nameRevision: 1, secure: 1, crystal: 1 } })
		.limit(ids.length).toArray();
	return docs.filter((doc: any) => doc.timelineVersionNameCleared !== true).map(versionNameFromDoc).sort((a: TimelineVersionName, b: TimelineVersionName) => a.eventId.localeCompare(b.eventId));
}

const dependencies = {
	collection: getThingsCollection, transaction: withMongoTransaction, debit: applyUserStorageDelta, now: () => new Date(),
	append: appendTimelineEvent, entries: readTimelineEntries
};
export function createVersionNameService(overrides: Partial<typeof dependencies> = {}) {
	const deps = { ...dependencies, ...overrides };
	const snapshot = (name: TimelineVersionName): TimelineSnapshot => ({ adapter: TIMELINE_VERSION_NAME_KIND, version: 1, value: name });
	return async (ownerId: string, input: TimelineVersionNameCommand): Promise<TimelineVersionNameResult> => {
		const command = parseTimelineVersionNameCommand(input); const things = await deps.collection(); const now = deps.now();
		const eventId = timelineVersionNameEventId(command.operationId); const signature = digest(command);
		return deps.transaction(async session => {
			// The operation id is the retry identity: an identical request returns the stored receipt; a different one is refused.
			const prior = (await deps.entries(things, ownerId, [eventId], session))[0];
			if (prior) {
				if (prior.event.operationId !== signature || prior.event.source !== 'api' || prior.event.actorId !== ownerId || (prior.event.after ?? prior.event.before)?.adapter !== TIMELINE_VERSION_NAME_KIND) refuse(409, 'This operation id was already used for another request.');
				return { ok: true, name: prior.event.after ? parseTimelineVersionName(prior.event.after.value) : null, entry: prior };
			}
			// Only a synced saved version can be named: effects, client drafts and deletions are refused.
			const target = (await deps.entries(things, ownerId, [command.eventId], session))[0];
			if (!target || target.event.ownerId !== ownerId || target.event.thingId !== command.thingId) refuse(404, 'Version not found.');
			if (target!.event.mode !== 'revision' || !target!.event.after) refuse(422, 'Only a saved version can be named.');
			const shareId = timelineVersionNameThingId(ownerId, command.eventId);
			const doc = await things.findOne({ ownerId, thingtime: TIMELINE_VERSION_NAME_KIND, shareId }, { session });
			// A tombstone (cleared name) reads as "no name" to clients but keeps the revision counter, so a
			// rename issued against an earlier life (stale expectedRevision) can never land on a later one.
			const current = doc && doc.timelineVersionNameCleared !== true ? versionNameFromDoc(doc) : null;
			const baseRevision: number = Number.isSafeInteger(doc?.nameRevision) && doc.nameRevision >= 0 ? doc.nameRevision : 0;
			if (current ? current.revision !== command.expectedRevision : command.expectedRevision !== 0) refuse(409, 'This version name changed on another device. Refresh and try again.');
			if (command.name === null ? !current : current?.name === command.name) return { ok: true, name: current, entry: null };
			if (baseRevision >= Number.MAX_SAFE_INTEGER) refuse(409, 'This version name revision limit has been reached.');
			const eventShareId = timelineEventThingId(ownerId, command.eventId);
			const updatedAt = new Date(Math.max(now.getTime(), current ? Date.parse(current.updatedAt) + 1 : 0, doc?.updatedAt ? new Date(doc.updatedAt).getTime() + 1 : 0)).toISOString();
			const next = command.name === null ? null : parseTimelineVersionName({ formatVersion: 1, id: timelineVersionNameId(command.eventId), ownerId, eventId: command.eventId, thingId: command.thingId, name: command.name, revision: baseRevision + 1, createdAt: current?.createdAt ?? now.toISOString(), updatedAt });
			// The event is appended FIRST: its Timeline-folder position CAS turns two
			// concurrent first-time names into one transaction write conflict instead
			// of a duplicate-key error on the unique shareId index. The effect sits in
			// the named version's branch lane and is metered like every effect event.
			const entry = await deps.append(things, parseTimelineEvent({
				formatVersion: 1, id: eventId, ownerId, thingId: command.thingId, branchId: target!.event.branchId, parentIds: [],
				operationId: signature, actorId: ownerId, source: 'api', clientId: null, occurredAt: now.toISOString(), mode: 'effect', operation: 'effect',
				label: !next ? TIMELINE_VERSION_NAME_LABELS.cleared : current ? TIMELINE_VERSION_NAME_LABELS.renamed : TIMELINE_VERSION_NAME_LABELS.named,
				before: current ? snapshot(current) : null, after: next ? snapshot(next) : null, dependencies: [{ thingId: command.thingId, eventId: command.eventId }]
			}), session, { debit: deps.debit, now });
			try {
				if (!next) {
					// Clearing keeps a tombstone: the revision advances, the secure payload goes away, reads skip it.
					const removed = await things.updateOne({ shareId, ownerId, nameRevision: baseRevision }, { $set: { nameRevision: baseRevision + 1, timelineVersionNameCleared: true, updatedAt: new Date(updatedAt) }, $unset: { secure: '', timelineVersionNameVersion: '' } }, { session });
					if (removed.matchedCount !== 1) refuse(409, 'This version name changed on another device. Refresh and try again.');
				} else if (doc) {
					const changed = await things.updateOne({ shareId, ownerId, nameRevision: baseRevision }, { $set: { ...packTimelineVersionName(next), nameRevision: next.revision, timelineVersionNameCleared: false, updatedAt: new Date(next.updatedAt) } }, { session });
					if (changed.matchedCount !== 1) refuse(409, 'This version name changed on another device. Refresh and try again.');
				} else {
					await things.insertOne({
						shareId, schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, thingtime: [TIMELINE_VERSION_NAME_KIND], ownerId, acl: ['tt:user'],
						folderId: timelineFolderId(ownerId), parentId: null, targetId: eventShareId, crystal: { name: 'Version name', targetId: eventShareId, linkKind: TIMELINE_VERSION_NAME_KIND },
						extended: null, tags: [], storageClass: 'control', nameRevision: next.revision, timelineVersionNameCleared: false, createdAt: new Date(entry.receipt.position), updatedAt: new Date(next.updatedAt), ...packTimelineVersionName(next)
					}, { session });
				}
			} catch (error: any) {
				if (error?.code === 11000) refuse(409, 'This version name changed on another device. Refresh and try again.');
				throw error;
			}
			return { ok: true, name: next, entry };
		});
	};
}
export const handleVersionNameCommand = createVersionNameService();
export const getTimelineVersionNames = async (ownerId: string, eventIds: string[]) => readTimelineVersionNames(await getThingsCollection(), ownerId, eventIds);
