import { libraryArchiveNeedsMinimalPresentation } from './libraryArchiveEligibility';
import { createHash, randomUUID } from 'node:crypto';
import { THING_BROWSER_PIN_KIND as PIN, THING_BROWSER_PIN_SCOPE_KIND as SCOPE, type ThingBrowserPinChange, type ThingBrowserPins } from '../../../utils/thingBrowserPins';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry';
import { getThingsCollection, getHomeThingsCollection, withMongoTransaction } from '../mongodb/collections';
import { mongoDataPlane } from '../mongodb/dataPlane';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { thingUniqueKey, thingUniqueKeyFilter } from '../mongodb/uniqueKeys';
import { applyUserStorageDelta } from '../storage/userStorage';
import { StorageMutationError, USER_STORAGE_ACCOUNTING_VERSION, currentContentStorageSizeBytes, thingStorageSizeBytes } from '../storage/storageCore';
import { findThingMetadataSource, readOwnedArchivedLibraryCard, parseChronoCursor, type PublicThing, type Viewer, type Fail } from './things';

const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const conflict = () => fail(409, 'Pins changed. Refresh before trying again.');
export const thingBrowserPinScope = (origin: string, ownerId: string, dataPlane: string, path: readonly string[]) =>
  createHash('sha256').update(JSON.stringify([new URL(origin).origin, ownerId, dataPlane, path])).digest('hex');
const ownerFilter = (ownerId: string, scope: string) => ({ ownerId, targetId: scope, thingtime: PIN });
const revisionFilter = (ownerId: string, scope: string) => ({ ownerId, thingtime: SCOPE, ...thingUniqueKeyFilter(SCOPE, scope) });
export const thingBrowserPinCursorClause = (cursor: { createdAt: Date; id: string }) => ({
  $or: [{ createdAt: { $gt: cursor.createdAt } }, { createdAt: cursor.createdAt, shareId: { $gt: cursor.id } }]
});
const compare = (a: any, b: any) => a.crystal.order - b.crystal.order || a.shareId.localeCompare(b.shareId);

/** Browser metadata families must use the archive card even when an older
 * generic source reader accepts their owner envelope. That never grants body
 * disclosure or active protected-content pinning. */
export const createThingBrowserPinTargetReader = (dependencies = {
  source: findThingMetadataSource,
  archivedCard: readOwnedArchivedLibraryCard,
  customPlane: isCustomMongoEndpointActive,
  device: async (viewer: Viewer, id: string, session?: any) => {
    const home = await getHomeThingsCollection();
    return !!await home.findOne({ shareId: id, ownerId: viewer!.id, thingtime: ['device'] } as any,
      { ...(session ? { session } : {}), projection: { _id: 1 } });
  }
}) => async (viewer: Viewer, id: string, session?: any): Promise<false | { presentation?: PublicThing }> => {
  const source = await dependencies.source(id, viewer, session);
  if (source && !libraryArchiveNeedsMinimalPresentation(source)) return {};
  // Dedicated identities and archive metadata never borrow the home plane.
  if (dependencies.customPlane()) return false;
  const presentation = await dependencies.archivedCard(viewer, id, session);
  if (presentation) return { presentation };
  if (source && libraryArchiveNeedsMinimalPresentation(source)) return false;
  return await dependencies.device(viewer, id, session) ? {} : false;
};
const readable = createThingBrowserPinTargetReader();
async function project(viewer: Viewer, rows: any[], revision: string, session?: any): Promise<ThingBrowserPins> {
  const pins: ThingBrowserPins['pins'] = [];
  // Sequential reads preserve the Mongo transaction contract. No source bytes
  // or existence reasons are returned. Dedicated archived sources may return
  // only their existing allowlisted browser card, never their protected body.
  for (const row of rows.sort(compare)) {
    const target = await readable(viewer, row.crystal.thingId, session);
    if (target) pins.push({ thingId: row.crystal.thingId, order: row.crystal.order, ...(target.presentation ? { presentation: target.presentation } : {}) });
  }
  return { ok: true, revision, pins, nextCursor: null };
}
export async function readThingBrowserPins(viewer: Viewer, origin: string, path: string[], page: { cursor?: string; revision?: string } = {}): Promise<ThingBrowserPins | Fail> {
  if (!viewer?.id || viewer.pat) return fail(401, 'A full user session is required.');
  const cursor = parseChronoCursor(page.cursor);
  if (page.cursor && (!cursor || !page.revision)) return fail(400, 'Invalid pin cursor.');
  const scope = thingBrowserPinScope(origin, viewer.id, mongoDataPlane(), path), things = await getThingsCollection();
  return withMongoTransaction(async session => {
    const header = await things.findOne(revisionFilter(viewer.id, scope), { session });
    const revision = header?.crystal?.revision ?? '0';
    if (page.revision !== undefined && page.revision !== revision) return conflict();
    // Reuses targetId+thingtime+createdAt+shareId, one bounded page. Authorization
    // is repeated for each target; an empty authorized page may still continue.
    const pageSize = 64;
    const found = await things.find({ ...ownerFilter(viewer.id, scope), ...(cursor ? thingBrowserPinCursorClause(cursor) : {}) }, { session })
      .sort({ createdAt: 1, shareId: 1 }).limit(pageSize + 1).toArray();
    const rows = found.slice(0, pageSize), last = rows.at(-1);
    const result = await project(viewer, rows, revision, session);
    result.nextCursor = found.length > pageSize && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null;
    return result;
  });
}
export async function updateThingBrowserPins(viewer: Viewer, origin: string, input: ThingBrowserPinChange): Promise<ThingBrowserPins | Fail> {
  if (!viewer?.id || viewer.pat) return fail(401, 'A full user session is required.');
  const ownerId = viewer.id, scope = thingBrowserPinScope(origin, ownerId, mongoDataPlane(), input.path), things = await getThingsCollection();
  try {
    return await withMongoTransaction(async session => {
      const header = await things.findOne(revisionFilter(ownerId, scope), { session });
      if ((header?.crystal?.revision ?? '0') !== input.revision) return conflict();
      // Ordinary pin/unpin touches one keyed row. Only the explicit whole-set
      // reorder consumes its current scoped set, never the account library.
      const exact = input.operation === 'reorder' ? null : await things.findOne({ ...ownerFilter(ownerId, scope),
        ...thingUniqueKeyFilter(PIN, JSON.stringify([scope, input.thingId])) }, { session });
      const rows: any[] = input.operation === 'reorder'
        ? (await things.find(ownerFilter(ownerId, scope), { session }).toArray()).sort(compare)
        : exact ? [exact] : [];
      const storedNextOrder = header?.crystal?.nextOrder;
      if (storedNextOrder !== undefined && (!Number.isSafeInteger(storedNextOrder) || storedNextOrder < 0)) return fail(503, 'Pin ordering is unavailable.');
      // Only upgrade pre-nextOrder headers through a scoped max-order read.
      // New headers keep a scalar monotonic sequence, so appending is O(1).
      const last = input.operation !== 'reorder' && header && storedNextOrder === undefined
        ? await things.findOne(ownerFilter(ownerId, scope), { session, sort: { 'crystal.order': -1 }, projection: { 'crystal.order': 1 } }) : null;
      const nextOrder = storedNextOrder ?? (input.operation === 'reorder' ? rows.reduce((max, row) => Math.max(max, row.crystal.order + 1), 0) : (last?.crystal.order ?? -1) + 1);
      const orderOffset = input.operation === 'pin' ? nextOrder : 0;
      const visible = input.operation === 'reorder' ? await project(viewer, rows, input.revision, session) : null;
      if (input.operation === 'pin' && !(await readable(viewer, input.thingId, session))) return fail(404, 'Thing not found.');
      const authorizedIds = new Set(visible?.pins.map(pin => pin.thingId));
      if (input.operation === 'reorder' && (input.thingIds.length !== authorizedIds.size || input.thingIds.some(id => !authorizedIds.has(id)))) return conflict();
      const ids = rows.map(row => row.crystal.thingId as string);
      const reorderIds = input.operation === 'reorder' ? input.thingIds : [];
      let reorderIndex = 0;
      const visibleIds = authorizedIds;
      const nextIds = input.operation === 'pin' ? ids.includes(input.thingId) ? ids : [...ids, input.thingId]
        : input.operation === 'unpin' ? ids.filter(id => id !== input.thingId)
        : ids.map(id => visibleIds.has(id) ? reorderIds[reorderIndex++] : id);
      if (ids.length === nextIds.length && ids.every((id, i) => id === nextIds[i])) return { ok: true, revision: input.revision, pins: [], nextCursor: null };
      const now = new Date(), revision = randomUUID(), home = !isCustomMongoEndpointActive();
      const headerCrystal = { revision, nextOrder: nextOrder + (input.operation === 'pin' ? 1 : 0) }, headerBytes = thingStorageSizeBytes({ crystal: headerCrystal, tags: [], extended: null });
      const previousHeaderBytes = header?.storageClass === 'content' ? currentContentStorageSizeBytes(header) : 0;
      if (home && previousHeaderBytes === null) throw new StorageMutationError(503, 'accounting_unavailable', 'Pin storage accounting is unavailable.');
      let delta = home ? headerBytes - (previousHeaderBytes ?? 0) : 0;
      // One scalar scope fence serializes pin/reorder/unpin across all clients.
      // The shared sparse uniqueKeys index also serializes first creation.
      if (header) {
        const updated = await things.updateOne({ _id: header._id, 'crystal.revision': input.revision }, { $set: { crystal: headerCrystal, extended: null, updatedAt: now, ...(home ? { storageClass: 'content', sizeBytes: headerBytes, storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION } : {}) } }, { session });
        if (updated.matchedCount !== 1) throw new StorageMutationError(409, 'storage_conflict', 'Pins changed.');
      } else await things.insertOne({ shareId: randomUUID(), ownerId, thingtime: [SCOPE], uniqueKeys: [thingUniqueKey(SCOPE, scope)], targetId: scope,
        acl: [ACL_OWNER], schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, crystal: headerCrystal, extended: null, tags: [], createdAt: now, updatedAt: now,
        ...(home ? { storageClass: 'content', sizeBytes: headerBytes, storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION } : {}) }, { session });
      const byId = new Map<string, any>(rows.map(row => [row.crystal.thingId, row]));
      for (let index = 0; index < nextIds.length; index++) {
        const order = orderOffset + index;
        const thingId = nextIds[index], old = byId.get(thingId), crystal = { thingId, order };
        const sizeBytes = thingStorageSizeBytes({ crystal, tags: [], extended: null });
        if (old) {
          if (old.crystal.order !== order) {
            if (home) delta += sizeBytes - old.sizeBytes;
            await things.updateOne({ _id: old._id }, { $set: { crystal, updatedAt: now, ...(home ? { sizeBytes } : {}) } }, { session });
          }
        } else {
          const row = { shareId: randomUUID(), ownerId, targetId: scope, thingtime: [PIN], uniqueKeys: [thingUniqueKey(PIN, JSON.stringify([scope, thingId]))],
            acl: [ACL_OWNER], schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, crystal, extended: null, tags: [], createdAt: now, updatedAt: now,
            ...(home ? { storageClass: 'content', sizeBytes, storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION } : {}) };
          if (home) delta += sizeBytes;
          await things.insertOne(row, { session });
        }
      }
      const retainedIds = new Set(nextIds);
      for (const old of rows) if (!retainedIds.has(old.crystal.thingId)) {
        if (home) delta -= old.sizeBytes;
        await things.deleteOne({ _id: old._id }, { session });
      }
      if (home && delta) await applyUserStorageDelta(ownerId, delta, session);
      return { ok: true, revision, pins: [], nextCursor: null };
    });
  } catch (error: any) {
    if (error?.code === 11000 || (error instanceof StorageMutationError && error.status === 409)) return conflict();
    if (error instanceof StorageMutationError) return fail(error.status, error.message);
    throw error;
  }
}
