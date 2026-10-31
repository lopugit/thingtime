import { storedSnapshotVersion, storedSnapshotMatch, type StoredSnapshotDocument } from '../things/storedSnapshot';
import { USER_VAULT_VERSION_PREFIX } from './userVaultModel';
export { validUserVaultSnapshotVersion } from './userVaultModel';
export type VaultSnapshotDocument = StoredSnapshotDocument;
/** The shared BSON comparison preserves the existing Vault token bytes. Only
 * stored ciphertext enters this boundary; it never opens credential values. */
export const userVaultSnapshotVersion = (doc: VaultSnapshotDocument) => storedSnapshotVersion(doc, USER_VAULT_VERSION_PREFIX);
export const userVaultSnapshotMatch = (doc: VaultSnapshotDocument) => storedSnapshotMatch(doc, USER_VAULT_VERSION_PREFIX);
