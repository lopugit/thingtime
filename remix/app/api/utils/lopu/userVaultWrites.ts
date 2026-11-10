import { getThingsCollection, withMongoTransaction } from '~/api/utils/mongodb/collections';
import { mongoDataPlane } from '~/api/utils/mongodb/dataPlane';
import { createThing, updateThing, deleteThing, isFail } from '~/api/utils/things/things';
import { readTimelineEntries, appendTimelineEvent } from '~/api/utils/timeline/repository';
import { newThingMutationCapture } from '~/api/utils/timeline/recordMutation';
import { StorageMutationError } from '~/api/utils/storage/storageCore';
import { ACL_OWNER } from '~/schemas/registry';
import { LOPU_USER_VAULT_SYSTEM_TYPE, LOPU_USER_VAULT_SCHEMA_VERSION, normalizeLopuProviderEndpoint, normalizeUserVaultProvider } from '~/api/utils/lopu/userVaultCore';
import { userVaultSourceKey, encryptUserVaultValue } from '~/api/utils/lopu/userVault';
import { userVaultSnapshotVersion, userVaultSnapshotMatch, type VaultSnapshotDocument } from '~/api/utils/lopu/userVaultVersion';
import { parseUserVaultWrite, type UserVaultWrite, type UserVaultWriteAcknowledgment } from './userVaultWriteContract';
import { createUserVaultWriteReceipt, readUserVaultWriteReceipt, userVaultWriteDigest, userVaultWriteEventId } from './userVaultWriteReceipt';

export class UserVaultWriteError extends Error {
 constructor(public status: number, message: string) { super(message); }
}
class ReplayedWrite extends Error {
 constructor(readonly acknowledgment: UserVaultWriteAcknowledgment) { super('Vault write already completed.'); }
}
const conflict = (): never => { throw new UserVaultWriteError(409, 'The account Vault entry changed. Your device changes have been kept.'); };

/** Called only by the full-session, same-origin admission route. The admission
 * callback rechecks that session immediately before canonical mutations.
 * Caller-supplied JSON never grants identity, a data plane, ACL or execution. */
export async function synchronizeUserVaultWrite(ownerId: string, raw: unknown, admit: () => Promise<void>): Promise<UserVaultWriteAcknowledgment> {
 let command: UserVaultWrite;
 try {
  command = parseUserVaultWrite(raw);
  if (command.action === 'save-provider') normalizeUserVaultProvider(command, normalizeLopuProviderEndpoint);
 } catch { throw new UserVaultWriteError(400, 'Invalid Vault synchronization command.'); }
 const key = userVaultSourceKey();
 if (!key) throw new UserVaultWriteError(503, 'Secure Vault encryption is unavailable.');
 const digest = userVaultWriteDigest(key, ownerId, mongoDataPlane(), command), things = await getThingsCollection();
 const capture = newThingMutationCapture(ownerId, 'api'); capture.operationId = command.writeId;
 const occurredAt = capture.now.toISOString();
 // Random IVs and operation identities are prepared once, outside transaction
 // retries. No plaintext or ciphertext is included in the completion effect.
 const encryptedValue = command.action === 'save-secret' ? encryptUserVaultValue(ownerId, command.id, command.value)
  : command.action === 'save-provider' && command.token ? encryptUserVaultValue(ownerId, command.id, command.token) : undefined;
 const replay = async (session?: any) => {
  const entries = await readTimelineEntries(things, ownerId, [userVaultWriteEventId(command.writeId)], session);
  if (!entries.length) return null;
  if (entries.length !== 1) return conflict();
  try { return readUserVaultWriteReceipt(entries[0].event, ownerId, command, digest); } catch { return conflict(); }
 };
 function assertCurrent(doc: any): asserts doc is VaultSnapshotDocument {
  if (!doc || doc.ownerId !== ownerId || doc.shareId !== command.id || !Array.isArray(doc.thingtime) || doc.thingtime.length !== 1 || doc.thingtime[0] !== 'data' || doc.appId ||
   doc.crystal?.systemType !== LOPU_USER_VAULT_SYSTEM_TYPE || !['group','secret','provider'].includes(doc.crystal.recordKind)) return conflict();
  if (command.expectedVersion === null || userVaultSnapshotVersion(doc) !== command.expectedVersion) return conflict();
  if ((command.action === 'save-secret' && doc.crystal.recordKind !== 'secret') || (command.action === 'save-provider' && doc.crystal.recordKind !== 'provider') ||
   (command.action === 'move-entry' && doc.crystal.recordKind === 'group')) return conflict();
 };
 const complete = async (session: any, deleted = false) => {
  const stored = deleted ? null : await things.findOne({ shareId: command.id, ownerId } as any, { session });
  if (!deleted && !stored) throw new Error('Vault write did not retain its target.');
  const acknowledgment: UserVaultWriteAcknowledgment = { id: command.id, writeId: command.writeId, action: command.action, expectedVersion: command.expectedVersion,
   resultVersion: deleted ? null : userVaultSnapshotVersion(stored as unknown as VaultSnapshotDocument) };
  await appendTimelineEvent(things, createUserVaultWriteReceipt(ownerId, acknowledgment, digest, occurredAt), session);
  return acknowledgment;
 };
 const beforeWrite = async (doc: any, session: any) => {
  await admit(); const previous = await replay(session); if (previous) throw new ReplayedWrite(previous);
  assertCurrent(doc);
  // Compare the complete stored BSON document, including unrecognized root
  // fields and physical identity. The subsequent write shares this snapshot.
  if (!await things.findOne(userVaultSnapshotMatch(doc) as any, { session, projection: { _id: 1 } })) return conflict();
 };
 const crystal = (before?: any) => {
  const base = { systemType: LOPU_USER_VAULT_SYSTEM_TYPE, schemaVersion: LOPU_USER_VAULT_SCHEMA_VERSION, createdAt: before?.crystal.createdAt ?? occurredAt, updatedAt: occurredAt };
  if (command.action === 'create-group') return { ...base, recordKind: 'group', name: command.name };
  if (command.action === 'save-secret') return { ...base, recordKind: 'secret', name: command.name, key: command.key, groupId: command.groupId, encryptedValue };
  if (command.action === 'save-provider') {
   const token = encryptedValue ?? before?.crystal.encryptedValue;
   if (!token) return conflict();
   return { ...base, recordKind: 'provider', name: command.name, provider: command.provider, endpoint: command.endpoint,
    ...(command.model ? { model: command.model } : {}), groupId: command.groupId, encryptedValue: token };
  }
  if (command.action === 'move-entry') return { ...before.crystal, groupId: command.groupId, updatedAt: occurredAt };
  throw new Error('Invalid Vault write action.');
 };
 await admit(); const previous = await replay(); if (previous) return previous;
 try {
  if (command.expectedVersion === null) {
   const next = crystal(); let effects: Array<() => Promise<void>> = [];
   const acknowledgment = await withMongoTransaction(async session => {
    effects = []; await admit(); const existingReceipt = await replay(session); if (existingReceipt) return existingReceipt;
    if (await things.findOne({ shareId: command.id } as any, { session, projection: { _id: 1 } })) return conflict();
    const result = await createThing(ownerId, { shareId: command.id, thingtime: ['data'], crystal: next, acl: [ACL_OWNER] }, { id: ownerId }, null,
     { timelineCapture: capture, transaction: { session, afterCommit: effect => effects.push(effect) } });
    if (isFail(result)) throw new UserVaultWriteError(result.status, 'The account Vault save was refused. Your device changes have been kept.');
    return complete(session);
   });
   for (const effect of effects) await effect();
   return acknowledgment;
  }
  if (command.action === 'delete') {
   const result = await deleteThing({ id: ownerId }, command.id, null, {
    timelineCapture: capture,
    beforeDelete: async doc => { await admit(); assertCurrent(doc); },
    beforeRootDelete: beforeWrite,
    afterRootDelete: async (_doc, session) => { await complete(session, true); }
   });
   if (isFail(result)) throw new UserVaultWriteError(result.status, 'The account Vault deletion was refused. Your device changes have been kept.');
  } else {
   const before = await things.findOne({ shareId: command.id, ownerId } as any); assertCurrent(before);
   const result = await updateThing({ id: ownerId }, command.id, { crystal: crystal(before) }, {
    replaceCrystal: true, mutation: { capture, beforeWrite, afterWrite: async session => { await complete(session); } }
   });
   if (isFail(result)) throw new UserVaultWriteError(result.status, 'The account Vault save was refused. Your device changes have been kept.');
  }
  const acknowledgment = await replay(); if (!acknowledgment) return conflict(); return acknowledgment;
 } catch (error) {
  if (error instanceof ReplayedWrite) return error.acknowledgment;
  // A concurrent exact retry may have committed between the preliminary read
  // and a canonical duplicate/CAS refusal. The retained receipt is authoritative.
  const acknowledged = await replay(); if (acknowledged) return acknowledged;
  if (error instanceof StorageMutationError) throw new UserVaultWriteError(error.status, 'The account Vault change was refused. Your device changes have been kept.');
  throw error;
 }
}
