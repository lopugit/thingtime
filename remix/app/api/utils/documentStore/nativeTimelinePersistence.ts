import { randomUUID } from 'node:crypto';
import { BSON } from 'mongodb';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { StorageMutationError } from '../storage/storageCore';
import { LOPU_USER_VAULT_SYSTEM_TYPE } from '../lopu/userVaultModel';
import type { CollectionFilter, CollectionTransaction } from './collectionContract';
import { withNativeStorageOperation, type NativeUserStorageSession } from './nativeUserStorage';
import type { TimelinePersistence, TimelineRecord } from '../timeline/persistence';
import { TIMELINE_EVENT_KIND } from '../../../timeline/contract';

const eq = (path: string[], value: any): CollectionFilter => ({ op: 'eq', path, value });
const and = (...filters: CollectionFilter[]): CollectionFilter => ({ op: 'and', filters });
const oneOf = (path: string[], values: string[]): CollectionFilter => ({ op: 'or', filters: values.map(value => eq(path, value)) });
const unavailable = (message: string): never => { throw new StorageMutationError(500, 'storage_invariant', message); };

/** A semantic history adapter over the caller's actual SQLite transaction.
 * Omitting session creates a read-only, owner-bound port: reads need no quota
 * admission and cannot acquire write authority. No collection/session facade,
 * alternative history format, public route or capability is introduced. */
export function createNativeTimelinePersistence(collections: CollectionTransaction,
 binding: { ownerId: string; session?: NativeUserStorageSession }): TimelinePersistence {
 const { ownerId, session } = binding;
 if (!ownerId) return unavailable('Native Timeline requires an owner');
 const things = () => collections.collection(physicalCollectionName('things'));
 const checkOwner = (requested: string) => { if (requested !== ownerId) unavailable('Native Timeline owner mismatch'); };
 const read = async <T>(work: () => T | Promise<T>): Promise<T> => session
  ? withNativeStorageOperation(ownerId, session, collections, work) : work();
 const write = async <T>(work: () => T | Promise<T>): Promise<T> => {
  if (!session) return unavailable('Read-only native Timeline has no mutation authority');
  return withNativeStorageOperation(ownerId, session, collections, work);
 };
 // The native collection has identity-order pages. Explicitly exhaust them;
 // chronology below is Timeline's timestamp order, never identity-key order.
 const scan = (filter: CollectionFilter, typed = false, project: (row: TimelineRecord) => TimelineRecord = row => row): TimelineRecord[] => {
  const rows: TimelineRecord[] = [];
  let after;
  do {
   const page = things().find({ filter, ...(after !== undefined ? { after } : {}), limit: 128 });
   for (const bytes of page.documents) rows.push(project(BSON.deserialize(bytes, typed ? { promoteValues: false } : {})));
   if (page.nextAfter === null) break;
   after = page.nextAfter;
  } while (true);
  return rows;
 };
 const identity = (shareId: string, typed = false) => {
  const records = scan(eq(['shareId'], shareId), typed);
  if (records.length > 1) unavailable('Native Timeline identity is not unique');
  const record = records[0] ?? null;
  if (record && record.ownerId !== ownerId) unavailable('Native Timeline record belongs to another owner');
  return record;
 };
 const ownedKind = (requestedOwner: string, kind: string) => {
  checkOwner(requestedOwner);
  return and(eq(['ownerId'], ownerId), { op: 'contains', path: ['thingtime'], value: kind });
 };
 const creationFilter = (requestedOwner: string, hold: { rootId: string; binding: string; operationId: string }) => {
  checkOwner(requestedOwner);
  return and(eq(['ownerId'], ownerId), eq(['shareId'], hold.rootId), eq(['creationCheckpoint', 'binding'], hold.binding),
   eq(['creationCheckpoint', 'operationId'], hold.operationId), oneOf(['creationCheckpoint', 'phase'], ['planning', 'restoring']));
 };
 const port: TimelinePersistence = {
  timelinePersistence: true,
  billable: true,
  assertTransaction: current => { if (!session || current !== session) unavailable('Native Timeline requires its exact content transaction'); },
  guard: async (requestedOwner, current, work) => write(async () => {
   checkOwner(requestedOwner);
   port.assertTransaction(current);
   return work();
  }),
  record: (requestedOwner, kind, id) => read(() => scan(and(ownedKind(requestedOwner, kind), eq(['shareId'], id)))[0] ?? null),
  records: (requestedOwner, kind, ids, projection = 'full') => read(() => {
   const filter = ownedKind(requestedOwner, kind);
   if (!ids.length) return [];
   const project = projection === 'node' ? ({ shareId, targetId, timelineNode, timelineEnvelopeVersion }: TimelineRecord) => ({ shareId, targetId, timelineNode, timelineEnvelopeVersion }) :
    projection === 'target' ? ({ targetId }: TimelineRecord) => ({ targetId }) :
    projection === 'identity-target' ? ({ shareId, targetId }: TimelineRecord) => ({ shareId, targetId }) : (row: TimelineRecord) => row;
   return scan(and(filter, oneOf(['shareId'], ids)), false, project);
  }),
  related: (requestedOwner, kind, eventThingIds, limit) => read(() => {
   const filter = ownedKind(requestedOwner, kind);
   if (!eventThingIds.length) return [];
   return scan(and(filter, oneOf(['targetId'], eventThingIds)))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.shareId.localeCompare(b.shareId)).slice(0, limit);
  }),
  headers: request => read(() => {
   const filter = ownedKind(request.ownerId, TIMELINE_EVENT_KIND);
   const clauses = [filter];
   if (request.targetIds) clauses.push(oneOf(['targetId'], request.targetIds));
   if (request.before !== null) clauses.push({ op: 'lt', path: ['createdAt'], value: new Date(request.before) });
   if (request.after !== null) clauses.push({ op: 'gt', path: ['createdAt'], value: new Date(request.after) });
   const direction = request.after !== null ? 1 : -1;
   return scan(and(...clauses), false, ({ shareId, createdAt, timelineEntryBytes, timelineLinkBytes }) => ({ shareId, createdAt, timelineEntryBytes, timelineLinkBytes }))
    .sort((a, b) => direction * (a.createdAt.getTime() - b.createdAt.getTime())).slice(0, request.limit);
  }),
  recordByIdentity: shareId => read(() => identity(shareId)),
  insert: records => write(() => { for (const record of records) {
   checkOwner(record.ownerId);
   things().insert(BSON.serialize({ ...record, _id: record._id ?? randomUUID() }));
  } }),
  ensureOwnerFolder: record => write(() => {
   checkOwner(record.ownerId);
   if (!identity(record.shareId)) things().insert(BSON.serialize({ ...record, _id: record._id ?? randomUUID() }));
  }),
  advanceOwnerPosition: (folder, position) => write(() => {
   checkOwner(folder.ownerId);
   const current = identity(folder.shareId, true);
   return !!current && Number(current.timelinePosition) === folder.timelinePosition && things().updateOne(and(eq(['_id'], current._id), eq(['ownerId'], ownerId), eq(['timelinePosition'], current.timelinePosition)),
    [{ op: 'set', path: ['timelinePosition'], value: position }]).matched;
  }),
  advanceBranchHead: (shareId, requestedOwner, revision, fields) => write(() => {
   checkOwner(requestedOwner);
   const current = identity(shareId, true);
   if (!current || Number(current.branchRevision) !== revision) return false;
   return things().updateOne(and(eq(['shareId'], shareId), eq(['ownerId'], ownerId), eq(['branchRevision'], current.branchRevision)),
    Object.entries(fields).map(([field, value]) => ({ op: 'set' as const, path: [field], value }))).matched;
  }),
  setThingHead: (shareId, requestedOwner, eventId, expectedId) => write(() => {
   checkOwner(requestedOwner);
   return things().updateOne(and(eq(['shareId'], shareId), eq(['ownerId'], ownerId), ...(expectedId !== undefined ? [eq(['_id'], expectedId)] : [])), [{ op: 'set', path: ['timelineHeadId'], value: eventId }]).matched;
  }),
  integrity: {
   vaultGroup: (requestedOwner, groupId) => read(() => {
    checkOwner(requestedOwner);
    return scan(and(eq(['ownerId'], ownerId), eq(['shareId'], groupId), { op: 'contains', path: ['thingtime'], value: 'data' },
     eq(['crystal', 'systemType'], LOPU_USER_VAULT_SYSTEM_TYPE), eq(['crystal', 'recordKind'], 'group')))[0] ?? null;
   }),
   vaultHasChildren: (requestedOwner, groupId) => read(() => {
    checkOwner(requestedOwner);
    return things().find({ filter: and(eq(['ownerId'], ownerId), { op: 'contains', path: ['thingtime'], value: 'data' },
     eq(['crystal', 'systemType'], LOPU_USER_VAULT_SYSTEM_TYPE), eq(['crystal', 'groupId'], groupId)), limit: 1 }).documents.length > 0;
   }),
   creationRoot: (requestedOwner, hold) => read(() => scan(creationFilter(requestedOwner, hold))[0] ?? null),
   advanceCreationEpoch: (requestedOwner, hold, epoch) => write(() => {
    const filter = creationFilter(requestedOwner, hold);
    const current = scan(filter, true)[0];
    if (!current) return false;
    const raw = current.creationCheckpoint?.contentEpoch;
    if (raw === undefined ? epoch !== undefined : Number(raw) !== epoch) return false;
    return things().updateOne(and(filter, raw === undefined ? { op: 'exists', path: ['creationCheckpoint', 'contentEpoch'], value: false } : eq(['creationCheckpoint', 'contentEpoch'], raw)),
     [{ op: 'set', path: ['creationCheckpoint', 'contentEpoch'], value: (epoch ?? 0) + 1 }]).modified;
   })
  }
 };
 return port;
}
