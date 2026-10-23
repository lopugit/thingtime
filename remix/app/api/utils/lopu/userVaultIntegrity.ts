import { LOPU_USER_VAULT_SYSTEM_TYPE, safeVaultId } from './userVaultModel';
import { StorageMutationError } from '../storage/storageCore';

type VaultThing = { shareId: string; ownerId: string; thingtime: string[]; crystal: Record<string, any> };
const vaultThing = (doc: any): doc is VaultThing => !!doc?.shareId && !!doc.ownerId && Array.isArray(doc.thingtime) && doc.thingtime.includes('data') && doc.crystal?.systemType === LOPU_USER_VAULT_SYSTEM_TYPE;
const group = (doc: any): doc is VaultThing => vaultThing(doc) && doc.crystal.recordKind === 'group';

/** Called by the shared ordinary Thing mutation recorder inside the content
 * transaction, before its owner Timeline-folder write. That common write
 * serializes group removal against child creation/moves across generic,
 * dedicated, import and History writers; a snapshot read alone is insufficient.
 * Throwing rolls back content, accounting and History together. */
export async function assertUserVaultMutationIntegrity(things: any, before: unknown, after: unknown, session: any): Promise<void> {
 if (!vaultThing(before) && !vaultThing(after)) return;
 if (!session?.inTransaction()) throw new Error('Vault relationships require the content transaction.');
 if (group(before) && (!group(after) || before.ownerId !== after.ownerId || before.shareId !== after.shareId)) {
  const child = await things.findOne({ ownerId: before.ownerId, thingtime: 'data',
   'crystal.systemType': LOPU_USER_VAULT_SYSTEM_TYPE, 'crystal.groupId': before.shareId },
  { session, projection: { _id: 1 } });
  if (child) throw new StorageMutationError(409, 'storage_conflict', 'Move or delete the entries in this environment first.');
 }
 if (vaultThing(after) && ['secret', 'provider'].includes(after.crystal.recordKind)) {
  const groupId = after.crystal.groupId;
  if (groupId === undefined || groupId === null || groupId === '') return;
  if (!safeVaultId(groupId) || safeVaultId(groupId) !== groupId || groupId === after.shareId)
   throw new StorageMutationError(409, 'storage_conflict', 'Vault environment was not found.');
  const parent = await things.findOne({ shareId: groupId, ownerId: after.ownerId, thingtime: 'data',
   'crystal.systemType': LOPU_USER_VAULT_SYSTEM_TYPE, 'crystal.recordKind': 'group' },
  { session, projection: { _id: 1 } });
  if (!parent) throw new StorageMutationError(409, 'storage_conflict', 'Vault environment was not found.');
 }
}
