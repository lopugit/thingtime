import { createHash } from 'node:crypto';
import { BSON } from 'mongodb';

import { USER_VAULT_VERSION_PREFIX } from './userVaultModel';
export { validUserVaultSnapshotVersion } from './userVaultModel';
const MAX_VERSION_BYTES = 1024 * 1024;
export type VaultSnapshotDocument = Record<string, unknown> & { shareId: string; ownerId: string; updatedAt: Date | string };

/** Compare the complete stored Thing, including BSON types and unknown envelope
 * fields. This is an opaque comparison token, not a persisted revision or grant.
 * The caller passes stored ciphertext; this helper never decrypts values. */
export function userVaultSnapshotVersion(doc: VaultSnapshotDocument): string {
 if (!doc || typeof doc.shareId !== 'string' || !doc.shareId || typeof doc.ownerId !== 'string' || !doc.ownerId ||
  !doc._id || !Number.isFinite(doc.updatedAt instanceof Date ? doc.updatedAt.getTime() : Date.parse(doc.updatedAt))) throw new Error('Saved Vault state cannot be versioned.');
 if (BSON.calculateObjectSize(doc) > MAX_VERSION_BYTES) throw new Error('Saved Vault state exceeds the synchronization limit.');
 const serialized = BSON.serialize(doc);
 return USER_VAULT_VERSION_PREFIX + createHash('sha256').update(serialized).digest('hex');
}

/** The identity fields use the normal lookup index; the complete literal check
 * rejects added fields too. A field allowlist cannot detect a concurrent generic
 * edit adding a property. $literal keeps dollar-prefixed caller data inert.
 * Use this filter INSIDE the canonical accounted mutation transaction. */
export function userVaultSnapshotMatch(doc: VaultSnapshotDocument) {
 userVaultSnapshotVersion(doc);
 return { _id: doc._id, ownerId: doc.ownerId, $expr: { $eq: ['$$ROOT', { $literal: doc }] } };
}
