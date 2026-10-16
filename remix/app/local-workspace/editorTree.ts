import { decodeThingtime, stringifyThingtimeForStorage } from '../Providers/thingtimeSerialization';
import { type WorkspaceDatabase, WorkspaceError, WORKSPACE_LIMITS, workspaceScopeKey, type WorkspaceScope, type WorkspaceLease } from './storage';

const COLLECTION = 'editor-tree', KEY = 'root', BYTES = 'editor-tree:root:v1';
type Header = { version: 1; bytes: number; hash: string };
export type ThingtimeStorage = { getItem(key: string): Promise<unknown>; setItem(key: string, value: string): Promise<unknown> };
export type LegacyTreeStorage = { getItem(key: string): Promise<unknown>; keys(): Promise<string[]> };

export const editorTreeStorageKey = (scope: WorkspaceScope) => `thingtime:workspace:${workspaceScopeKey(scope)}`;
export const legacyEditorTreeKey = (scope: WorkspaceScope) => scope.kind === 'anonymous' ? 'thingtime' : `thingtime:account:${scope.ownerId}`;

export function decodeEditorTree(raw: unknown) {
 const serialized = typeof raw === 'string' ? raw : stringifyThingtimeForStorage(raw);
 if (typeof serialized !== 'string' || serialized.length > WORKSPACE_LIMITS.binaryBytes) throw new WorkspaceError('EDITOR_TREE_SIZE', 'The earlier editor tree is too large for device storage.', 413);
 const result = decodeThingtime(serialized);
 if (!result.value || typeof result.value !== 'object' || Array.isArray(result.value)) throw new WorkspaceError('INVALID_EDITOR_TREE', 'The saved editor tree could not be read. Its original copy has been kept.');
 return { value: result.value, serialized: stringifyThingtimeForStorage(result.value) };
}
const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), byte => byte.toString(16).padStart(2, '0')).join('');

/** The legacy native tree now shares the workspace transaction, quota and
 * identity boundary. Its canonical storage codec retains Dates and cycles.
 * This internal snapshot is never an account mutation or a public Thing. */
export class LocalEditorTree implements ThingtimeStorage {
 readonly key: string;
 constructor(private db: WorkspaceDatabase, readonly scope: WorkspaceScope, private lease: WorkspaceLease, private legacy?: LegacyTreeStorage) {
  this.key = editorTreeStorageKey(scope);
 }
 private check(key = this.key) {
  this.lease.assertCurrent();
  if (key !== this.key) throw new WorkspaceError('EDITOR_TREE_SCOPE', 'The editor workspace changed. Reopen it before continuing.', 409);
 }
 private async prepare(serialized: string) {
  this.check();
  const decoded = decodeEditorTree(serialized), bytes = new TextEncoder().encode(decoded.serialized);
  if (bytes.byteLength > WORKSPACE_LIMITS.binaryBytes) throw new WorkspaceError('EDITOR_TREE_SIZE', 'The editor tree exceeds the 16 MiB device limit. Export or reduce it before saving.', 413);
  const header: Header = { version: 1, bytes: bytes.byteLength, hash: await digest(bytes) };
  this.check(); return { bytes, header, serialized: decoded.serialized };
 }
 private async read() {
  return this.db.transaction(this.scope, 'readonly', this.lease, async tx => {
   const header = await tx.get<Header>(COLLECTION, KEY), bytes = await tx.getBytes(BYTES);
   if (!header && !bytes) return null;
   if (!header || !bytes || header.version !== 1 || header.bytes !== bytes.byteLength || !/^[a-f0-9]{64}$/.test(header.hash))
    throw new WorkspaceError('EDITOR_TREE_INCOMPLETE', 'The saved editor tree is incomplete. Its original data has been kept.');
   return { header, bytes };
  });
 }
 async getItem(key: string) {
  this.check(key);
  let stored = await this.read();
  // The old anonymous key has known anonymous provenance. Account-only keys
  // have no data-plane provenance and require an explicit reviewed copy.
  if (!stored && this.scope.kind === 'anonymous' && this.legacy) {
   const raw = await this.legacy.getItem(legacyEditorTreeKey(this.scope)); this.check();
   if (raw !== null && raw !== undefined) {
    const prepared = await this.prepare(decodeEditorTree(raw).serialized);
    await this.db.transaction(this.scope, 'readwrite', this.lease, async tx => {
     if (await tx.get(COLLECTION, KEY) || await tx.getBytes(BYTES)) return;
     await tx.putBytes(BYTES, prepared.bytes); await tx.put(COLLECTION, KEY, prepared.header);
    });
    stored = await this.read();
   }
  }
  if (!stored) return null;
  if (await digest(stored.bytes) !== stored.header.hash) throw new WorkspaceError('EDITOR_TREE_INCOMPLETE', 'The saved editor tree is damaged. Its original data has been kept.');
  this.check();
  return decodeEditorTree(new TextDecoder('utf-8', { fatal: true }).decode(stored.bytes)).serialized;
 }
 async setItem(key: string, value: string) {
  this.check(key); const prepared = await this.prepare(value);
  await this.db.transaction(this.scope, 'readwrite', this.lease, async tx => {
   await tx.putBytes(BYTES, prepared.bytes); await tx.put(COLLECTION, KEY, prepared.header);
  });
  return prepared.serialized;
 }
 async hasLegacyAccountTree() {
  this.check();
  if (this.scope.kind !== 'account' || !this.legacy) return false;
  const keys = await this.legacy.keys(); this.check();
  return keys.includes(legacyEditorTreeKey(this.scope));
 }
 async reviewLegacyAccountTree() {
  this.check();
  if (this.scope.kind !== 'account' || !this.legacy) throw new WorkspaceError('LEGACY_TREE_UNAVAILABLE', 'No earlier account editor tree is available here.');
  const raw = await this.legacy.getItem(legacyEditorTreeKey(this.scope)); this.check();
  if (raw === null || raw === undefined) throw new WorkspaceError('LEGACY_TREE_UNAVAILABLE', 'The earlier device tree is no longer available.');
  const decoded = decodeEditorTree(raw);
  this.check(); return decoded;
 }
}
