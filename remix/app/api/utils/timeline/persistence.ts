import { TIMELINE_EVENT_KIND, TIMELINE_LINK_KIND } from '../../../timeline/contract';
import type { TIMELINE_SNAPSHOT_PART_KIND } from '../../../timeline/snapshotParts';
import type { TIMELINE_BRANCH_KIND, TIMELINE_BRANCH_HEAD_KIND } from '../../../timeline/branches';
import { TIMELINE_NOTE_KIND } from '../../../timeline/notes';
import type { TIMELINE_VERSION_NAME_KIND } from '../../../timeline/versionNames';

export type TimelineRecordKind = typeof TIMELINE_EVENT_KIND | typeof TIMELINE_LINK_KIND | typeof TIMELINE_SNAPSHOT_PART_KIND |
 typeof TIMELINE_BRANCH_KIND | typeof TIMELINE_BRANCH_HEAD_KIND | typeof TIMELINE_NOTE_KIND | typeof TIMELINE_VERSION_NAME_KIND;
export type TimelineRecord = Record<string, any>;
export type TimelineProjection = 'full' | 'node' | 'target' | 'identity-target' | 'link';
export type TimelineHeaderRequest = { ownerId: string; targetIds: string[] | null; before: number | null; after: number | null; limit: number };
export interface TimelineMutationIntegrity {
 vaultGroup(ownerId: string, groupId: string): Promise<TimelineRecord | null>;
 vaultHasChildren(ownerId: string, groupId: string): Promise<boolean>;
 creationRoot(ownerId: string, hold: { rootId: string; binding: string; operationId: string }): Promise<TimelineRecord | null>;
 advanceCreationEpoch(ownerId: string, hold: { rootId: string; binding: string; operationId: string }, epoch: number | undefined): Promise<boolean>;
}

/** Storage vocabulary for immutable history and its bounded control records.
 * The algorithms, envelope validation and accounting remain in the canonical
 * Timeline modules. This is neither a Mongo collection nor a driver session.
 * Native implementations are bound to one actual content transaction. */
export interface TimelinePersistence {
 readonly timelinePersistence: true;
 readonly integrity?: TimelineMutationIntegrity;
 assertTransaction(session: unknown): void;
 guard<T>(ownerId: string, session: unknown, work: () => Promise<T>): Promise<T>;
 record(ownerId: string, kind: TimelineRecordKind, id: string): Promise<TimelineRecord | null>;
 records(ownerId: string, kind: TimelineRecordKind, ids: string[], projection?: TimelineProjection): Promise<TimelineRecord[]>;
 related(ownerId: string, kind: typeof TIMELINE_LINK_KIND | typeof TIMELINE_NOTE_KIND, eventThingIds: string[], limit: number): Promise<TimelineRecord[]>;
 headers(request: TimelineHeaderRequest): Promise<TimelineRecord[]>;
 recordByIdentity(shareId: string): Promise<TimelineRecord | null>;
 insert(records: TimelineRecord[]): Promise<void>;
 ensureOwnerFolder(record: TimelineRecord): Promise<void>;
 advanceOwnerPosition(folder: TimelineRecord, position: number): Promise<boolean>;
 advanceBranchHead(shareId: string, ownerId: string, revision: number, fields: TimelineRecord): Promise<boolean>;
 setThingHead(shareId: string, ownerId: string, eventId: string, expectedId?: unknown): Promise<boolean>;
 readonly billable: boolean;
}

export const isTimelinePersistence = (value: any): value is TimelinePersistence => value?.timelinePersistence === true;
const projections = {
 node: { shareId: 1, targetId: 1, timelineNode: 1, timelineEnvelopeVersion: 1 },
 target: { targetId: 1 }, 'identity-target': { shareId: 1, targetId: 1 },
 link: { shareId: 1, targetId: 1, thingtime: 1, timelineLinkVersion: 1, secure: 1, 'crystal.targetId': 1, 'crystal.linkKind': 1 }
};

/** Compatibility adapter for existing Mongo callers. It alone translates
 * semantic persistence operations into driver filters and updates. */
export function timelinePersistence(things: any, session?: any): TimelinePersistence {
 if (isTimelinePersistence(things)) return things;
 const options = () => session ? { session } : {};
 return {
  timelinePersistence: true,
  billable: true,
  assertTransaction: current => { if (!(current as any)?.inTransaction?.()) throw new Error('Published history requires the content transaction'); },
  guard: async (_ownerId, _session, work) => work(),
  record: (ownerId, kind, id) => things.findOne({ ownerId, thingtime: kind, shareId: id }, options()),
  records: async (ownerId, kind, ids, projection = 'full') => !ids.length ? [] : things.find({ ownerId, thingtime: kind, shareId: { $in: ids } },
   { ...options(), ...(projection === 'full' ? {} : { projection: projections[projection] }) }).toArray(),
  related: async (ownerId, kind, eventThingIds, limit) => {
   if (!eventThingIds.length) return [];
   const cursor = things.find({ ownerId, thingtime: kind, targetId: { $in: eventThingIds } }, { ...options(), ...(kind === TIMELINE_LINK_KIND ? { projection: projections.link } : {}) });
   return (kind === TIMELINE_NOTE_KIND ? cursor.sort({ createdAt: 1 }) : cursor).limit(limit).toArray();
  },
  headers: async request => things.find({ ownerId: request.ownerId, thingtime: TIMELINE_EVENT_KIND,
   ...(request.targetIds ? { targetId: { $in: request.targetIds } } : {}),
   ...(request.before !== null ? { createdAt: { $lt: new Date(request.before) } } : {}),
   ...(request.after !== null ? { createdAt: { $gt: new Date(request.after) } } : {}) },
   { ...options(), projection: { _id: 0, shareId: 1, createdAt: 1, timelineEntryBytes: 1, timelineLinkBytes: 1 } })
   .sort({ createdAt: request.after !== null ? 1 : -1 }).limit(request.limit).toArray(),
  recordByIdentity: shareId => things.findOne({ shareId }, options()),
  insert: async records => { if (records.length === 1) await things.insertOne(records[0], options()); else if (records.length) await things.insertMany(records, options()); },
  ensureOwnerFolder: async record => { await things.updateOne({ shareId: record.shareId }, { $setOnInsert: record }, { ...options(), upsert: true }); },
  advanceOwnerPosition: async (folder, position) => (await things.updateOne({ _id: folder._id, timelinePosition: folder.timelinePosition }, { $set: { timelinePosition: position } }, options())).matchedCount === 1,
  advanceBranchHead: async (shareId, ownerId, revision, fields) => (await things.updateOne({ shareId, ownerId, branchRevision: revision }, { $set: fields }, options())).matchedCount === 1,
  setThingHead: async (shareId, ownerId, eventId, expectedId) => (await things.updateOne({ shareId, ownerId, ...(expectedId !== undefined ? { _id: expectedId } : {}) }, { $set: { timelineHeadId: eventId } }, options())).matchedCount === 1
 };
}
