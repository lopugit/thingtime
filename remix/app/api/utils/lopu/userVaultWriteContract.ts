import { copyBoundedJson } from '../../../utils/boundedJson';
import {
 normalizeUserVaultGroup, normalizeUserVaultSecret, normalizeUserVaultProvider,
 normalizeUserVaultGroupId, safeVaultId, validUserVaultSnapshotVersion,
 type UserVaultGroupFields, type UserVaultSecretFields, type UserVaultProviderFields
} from './userVaultModel';

export const USER_VAULT_WRITE_MAX_BYTES = 40 * 1024;
type Identity = { id: string; writeId: string; expectedVersion: string | null };
export type UserVaultWrite = Identity & (
 | ({ action: 'create-group' } & UserVaultGroupFields)
 | ({ action: 'save-secret' } & UserVaultSecretFields)
 | ({ action: 'save-provider' } & UserVaultProviderFields)
 | { action: 'move-entry'; groupId: string | null }
 | { action: 'delete' }
);
export type UserVaultWriteAcknowledgment = Identity & { action: UserVaultWrite['action']; resultVersion: string | null };
const fields = {
 'create-group': ['name'], 'save-secret': ['name', 'key', 'value', 'groupId'],
 'save-provider': ['name', 'provider', 'endpoint', 'model', 'token', 'groupId'],
 'move-entry': ['groupId'], 'delete': []
};
const invalid = (): never => { throw new Error('Invalid Vault synchronization command.'); };
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
function identity(value: Record<string, any>): Identity {
 const id = safeVaultId(value.id), writeId = safeVaultId(value.writeId);
 if (!id || id !== value.id || id.startsWith('timeline-') || !writeId || writeId !== value.writeId ||
  (value.expectedVersion !== null && !validUserVaultSnapshotVersion(value.expectedVersion))) return invalid();
 return { id, writeId, expectedVersion: value.expectedVersion };
}

/** Shared detached wire contract. This does not authenticate, authorize a
 * provider endpoint, or determine whether the expected state still exists. */
export function parseUserVaultWrite(input: unknown): UserVaultWrite {
 const value: unknown = copyBoundedJson(input, { maxBytes: USER_VAULT_WRITE_MAX_BYTES, maxDepth: 3, maxNodes: 32 }, 'Vault synchronization');
 if (!object(value) || typeof value.action !== 'string' || !Object.prototype.hasOwnProperty.call(fields, value.action)) return invalid();
 const allowed = ['action', 'id', 'writeId', 'expectedVersion', ...fields[value.action as keyof typeof fields]];
 if (Object.keys(value).some(key => !allowed.includes(key))) return invalid();
 const base = identity(value);
 switch (value.action) {
  case 'create-group':
   if (base.expectedVersion !== null) return invalid();
   return { ...base, action: value.action, ...normalizeUserVaultGroup(value) };
  case 'save-secret': return { ...base, action: value.action, ...normalizeUserVaultSecret(value) };
  case 'save-provider': {
   if (value.model !== undefined && value.model !== null && typeof value.model !== 'string') return invalid();
   const provider = normalizeUserVaultProvider(value);
   if (base.expectedVersion === null && !provider.token) return invalid();
   return { ...base, action: value.action, ...provider };
  }
  case 'move-entry':
   if (base.expectedVersion === null || !Object.prototype.hasOwnProperty.call(value, 'groupId')) return invalid();
   return { ...base, action: value.action, groupId: normalizeUserVaultGroupId(value.groupId) };
  case 'delete':
   if (base.expectedVersion === null) return invalid();
   return { ...base, action: value.action };
  default: return invalid();
 }
}

/** Acknowledges the original operation only. A later remote delete/change may
 * already have happened; this receipt must never replace newer device edits. */
export function parseUserVaultWriteAcknowledgment(input: unknown): UserVaultWriteAcknowledgment {
 const value: unknown = copyBoundedJson(input, { maxBytes: 2048, maxDepth: 2, maxNodes: 8 }, 'Vault acknowledgment');
 if (!object(value) || Object.keys(value).length !== 5 || !['id', 'writeId', 'expectedVersion', 'action', 'resultVersion'].every(key => Object.prototype.hasOwnProperty.call(value, key)) ||
  typeof value.action !== 'string' || !Object.prototype.hasOwnProperty.call(fields, value.action)) return invalid();
 const base = identity(value);
 if ((value.action === 'create-group' && base.expectedVersion !== null) ||
  (['move-entry', 'delete'].includes(value.action) && base.expectedVersion === null) ||
  (value.action === 'delete' ? value.resultVersion !== null : !validUserVaultSnapshotVersion(value.resultVersion))) return invalid();
 return { ...base, action: value.action as UserVaultWrite['action'], resultVersion: value.resultVersion };
}
