import { BSON } from 'mongodb';
import { normalizeUserVaultGroup, normalizeUserVaultSecretMetadata, normalizeUserVaultProvider, safeVaultId, LOPU_USER_VAULT_SYSTEM_TYPE, type PublicVaultEntry } from './userVaultModel';
import { userVaultSnapshotVersion, type VaultSnapshotDocument } from './userVaultVersion';

export class UserVaultMetadataError extends Error {
 constructor(public status: number, message: string) { super(message); }
}
export const USER_VAULT_SNAPSHOT_LIMIT = 500;
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const invalid = (): never => { throw new UserVaultMetadataError(422, 'Saved Vault metadata is invalid. Existing entries have been kept.'); };
const timestamp = (value: unknown): string => {
 if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return invalid();
 return value;
};

/** Metadata only, without decrypting credentials. Iterate a bounded cursor so
 * malformed generic Things cannot force an unbounded in-memory snapshot. */
export async function projectUserVaultMetadata(ownerId: string, source: AsyncIterable<VaultSnapshotDocument> | Iterable<VaultSnapshotDocument>) {
 const groups: Array<{ id: string; name: string; createdAt: string; updatedAt: string; version: string }> = [];
 const entries: Array<PublicVaultEntry & { version: string }> = [];
 const ids = new Set<string>(); let bytes = 0;
 for await (const doc of source) {
  if (ids.size >= USER_VAULT_SNAPSHOT_LIMIT) throw new UserVaultMetadataError(413, 'The account Vault exceeds the device snapshot limit. No partial snapshot was returned.');
  bytes += BSON.calculateObjectSize(doc);
  if (bytes > MAX_SNAPSHOT_BYTES) throw new UserVaultMetadataError(413, 'The account Vault exceeds the device snapshot byte limit. No partial snapshot was returned.');
  if (doc.ownerId !== ownerId || !safeVaultId(doc.shareId) || ids.has(doc.shareId) || !Array.isArray(doc.thingtime) || !doc.thingtime.includes('data')) return invalid();
  ids.add(doc.shareId);
  const crystal = doc.crystal as Record<string, unknown> | undefined;
  if (!crystal || crystal.systemType !== LOPU_USER_VAULT_SYSTEM_TYPE) return invalid();
  let version: string;
  try { version = userVaultSnapshotVersion(doc); } catch { return invalid(); }
  const base = { id: doc.shareId, createdAt: timestamp(crystal.createdAt), updatedAt: timestamp(crystal.updatedAt), version };
  try {
   if (crystal.recordKind === 'group') groups.push({ ...base, ...normalizeUserVaultGroup(crystal) });
   else if (crystal.recordKind === 'secret' || crystal.recordKind === 'provider') {
    const encrypted = crystal.encryptedValue as Record<string, unknown> | undefined;
    if (!encrypted || !['cipherText', 'iv', 'tag'].every(key => typeof encrypted[key] === 'string' && encrypted[key])) return invalid();
    // Only canonical metadata fields leave this boundary; encrypted values,
    // arbitrary generic fields and ownership/envelope fields are never spread.
    if (crystal.recordKind === 'secret') entries.push({ ...base, kind: 'secret', hasValue: true, ...normalizeUserVaultSecretMetadata(crystal) });
    else {
     const { token: _token, ...metadata } = normalizeUserVaultProvider({ name: crystal.name, provider: crystal.provider, endpoint: crystal.endpoint, model: crystal.model, groupId: crystal.groupId });
     entries.push({ ...base, kind: 'provider', hasValue: true, ...metadata });
    }
   } else return invalid();
  } catch { return invalid(); }
 }
 const groupIds = new Set(groups.map(group => group.id));
 if (entries.some(entry => entry.groupId && !groupIds.has(entry.groupId))) return invalid();
 return { complete: true as const, groups, entries };
}
