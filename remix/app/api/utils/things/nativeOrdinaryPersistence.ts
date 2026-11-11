import { BUILDER_THING_KIND } from '../../../schemas/builderThing';
import { createNativeTimelinePersistence } from '../documentStore/nativeTimelinePersistence';
import { applyUserStorageDelta } from '../storage/userStorage';
import { currentContentStorageSizeBytes, StorageMutationError } from '../storage/storageCore';
import { newThingMutationCapture, recordThingMutation, type ThingMutationCapture } from '../timeline/recordMutation';
import { getThingsTransactionBinding, matchesThingVersion, type StoredThing, type ThingsPersistence, type ThingsTransaction } from './persistence';

/** Temporary admission boundary for the first canonical service vertical slice.
 * Unsupported composition/namespace families remain unavailable until their
 * canonical dependencies have semantic ports; they never fall through to Mongo. */
export const NATIVE_ORDINARY_CONTENT_KINDS = ['data', 'folder', 'component', 'schema', 'webpage'] as const;
export function nativeOrdinaryThingSupported(row: StoredThing): boolean {
 const contentKinds = Array.isArray(row.thingtime) ? row.thingtime.filter((kind: string) => kind !== BUILDER_THING_KIND) : [];
 return contentKinds.length === 1 && NATIVE_ORDINARY_CONTENT_KINDS.some(kind => kind === contentKinds[0]) &&
  row.appId == null && row.sandboxSpace == null && row.sandboxExpiresAt == null && row.targetId == null &&
  row.executionHold == null && row.creationCheckpoint == null && row.libraryArchived !== true && row.subspacePrivate !== true &&
  row.extended?.serviceWorkspaceId == null && row.crystal?.workspaceId == null &&
  (!Array.isArray(row.acl) || !row.acl.some((entry: string) => { const value = entry.startsWith('-') ? entry.slice(1) : entry; return value === 'tt:extsourced' || value.startsWith('tt:extacct/') || value === 'tt:inherit'; }));
}
export const nativeOrdinaryUnavailable = () => ({ ok: false as const, status: 503, error: 'This operation requires canonical dependencies that are not yet available on native storage' });
const conflict = (message = 'Thing changed while it was being updated — try again'): never => { throw new StorageMutationError(409, 'storage_conflict', message); };
const version = (row: StoredThing) => ({ id: row.shareId, identity: row._id, updatedAt: row.updatedAt, headId: row.timelineHeadId ?? null, folderId: row.folderId ?? null, ...(row.sizeBytes !== undefined ? { sizeBytes: row.sizeBytes } : {}) });
function history(tx: ThingsTransaction, ownerId: string) {
 const binding = getThingsTransactionBinding(tx, ownerId);
 if (binding.kind !== 'native') throw new Error('Native Thing mutation requires its actual storage session');
 return { port: createNativeTimelinePersistence(binding.collections, { ownerId, session: binding.session }), session: binding.session };
}
export async function insertNativeOrdinaryThing(repository: ThingsPersistence, document: StoredThing, capture: ThingMutationCapture) {
 return repository.transaction('write', async tx => {
  if (await tx.readExact(document.shareId)) return conflict('A Thing with this id already exists');
  await tx.lockFolder(document.folderId ?? null, document.thingtime.includes('folder') ? document.shareId : undefined);
  const { port, session } = history(tx, document.ownerId);
  await applyUserStorageDelta(document.ownerId, document.sizeBytes, session);
  const inserted = await tx.insert(document);
  await recordThingMutation(port, null, inserted, capture, session, tx);
  return inserted;
 });
}
export async function updateNativeOrdinaryThing(repository: ThingsPersistence, before: StoredThing, after: StoredThing, capture: ThingMutationCapture) {
 return repository.transaction('write', async tx => {
  const current = await tx.readExact(before.shareId);
  if (!current || !matchesThingVersion(current, version(before))) return conflict();
  await tx.lockFolder(after.folderId ?? null, after.thingtime.includes('folder') ? after.shareId : undefined);
  const { port, session } = history(tx, before.ownerId);
  const previousBytes = currentContentStorageSizeBytes(before);
  if (previousBytes === null) throw new StorageMutationError(503, 'accounting_unavailable', 'Thing requires the current storage migration before it can be updated');
  await applyUserStorageDelta(before.ownerId, after.sizeBytes - previousBytes, session);
  if (!await tx.compareAndSwap(version(before), after)) return conflict();
  await recordThingMutation(port, before, after, capture, session, tx);
  return after;
 });
}
/** Match canonical folder draining: each placement and its History commit
 * together while the exact physical root remains a retry anchor. Legacy child
 * baselines use normal quota admission; existing placement-only history uses
 * the deletion lane and remains possible at/above quota. The final deletion
 * retains only the root's matched refund, never funding new child history. */
export async function deleteNativeOrdinaryThing(repository: ThingsPersistence, before: StoredThing, capture: ThingMutationCapture) {
 const assertRoot = async (tx: ThingsTransaction) => {
  const current = await tx.readExact(before.shareId);
  if (!current || !matchesThingVersion(current, version(before))) return conflict('Thing changed while it was being deleted — try again');
  return current;
 };
 const candidates = await repository.transaction('delete', async tx => {
  await assertRoot(tx);
  let cursor: string | null = null;
  do {
   const attached = await tx.readWindow({ targetId: before.shareId, limit: 128, cursor });
   if (attached.documents.some(row => !Array.isArray(row.thingtime) || !row.thingtime.every((kind: string) => kind.startsWith('timeline-')))) throw new StorageMutationError(503, 'accounting_unavailable', 'Native target cascade dependencies are not yet available');
   cursor = attached.nextCursor;
  } while (cursor);
  const children = before.thingtime.includes('folder') ? await tx.folderChildren(before.shareId) : [];
  if (children.some(row => !nativeOrdinaryThingSupported(row))) throw new StorageMutationError(503, 'accounting_unavailable', 'This folder contains a managed item that requires its canonical placement adapter');
  return children;
 });
 for (const candidate of candidates) {
  const move = { ...newThingMutationCapture(capture.actorId, capture.source), operationId: capture.operationId, label: 'Moved out of deleted folder' };
  await repository.transaction(candidate.timelineHeadId ? 'delete' : 'write', async tx => {
   await assertRoot(tx);
   const child = await tx.readExact(candidate.shareId);
   if (!child || child.folderId !== before.shareId) return;
   if (!matchesThingVersion(child, version(candidate))) return conflict('A folder item changed while it was being moved — try again');
   await tx.lockFolder(before.folderId ?? null, child.thingtime.includes('folder') ? child.shareId : undefined);
   const after = { ...child, folderId: before.folderId ?? null, updatedAt: new Date(Math.max(+child.updatedAt + 1, +move.now)) };
   if (!await tx.compareAndSwap(version(child), after)) return conflict();
   const { port, session } = history(tx, before.ownerId);
   await recordThingMutation(port, child, after, move, session, tx);
  });
 }
 return repository.transaction('delete', async tx => {
  await assertRoot(tx);
  if (before.thingtime.includes('folder') && (await tx.folderChildren(before.shareId)).length) return conflict('Folder contents changed during deletion — try again');
  const removed = await tx.remove(version(before));
  if (!removed) return conflict();
  const { port, session } = history(tx, before.ownerId);
  const bytes = currentContentStorageSizeBytes(before);
  // Canonical History marks unknown baselines for reconciliation; no guessed
  // refund makes an unavailable ledger appear ready.
  if (bytes !== null) await applyUserStorageDelta(before.ownerId, -bytes, session);
  await recordThingMutation(port, before, null, capture, session, tx);
 });
}
