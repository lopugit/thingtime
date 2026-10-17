import { validatePasswordEntry, validPasswordId, type PasswordEntry, type PasswordMetadata } from '../passwords/model';
import { parseTotp } from '../passwords/totp';
import { createDeviceVaultKey, wrapDeviceVaultKey, unwrapDeviceVaultKey, sealDeviceVaultValue, openDeviceVaultValue, deviceVaultWriteDigest, type DeviceVaultKey } from '../passwords/vaultCrypto';
import type { PasswordKeyEnvelope, VaultEnvelope } from '../passwords/vaultEnvelopeContract';
import { WorkspaceError, workspaceScopeKey, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope } from './storage';

const KEYS = 'password-vault-keys', RECORDS = 'password-vault-records', COMMANDS = 'password-vault-commands';
const IDLE_MS = 5 * 60_000;
type KeyHeader = { version: 1; passwordKey: PasswordKeyEnvelope };
export type DevicePasswordRecord = { id: string; revision: number; remoteRevision: number; createdAt: string; updatedAt: string;
  encryptedValue?: VaultEnvelope; deleted?: true; writeId?: string; writeDigest?: string };
export type DevicePasswordCommand = { id: string; recordId: string; localRevision: number; operation: 'save' | 'delete';
  encryptedValue: VaultEnvelope; state: 'pending' | 'frozen' | 'refused'; expectedRevision?: number };
type Save = { id: string; writeId: string; revision: number; entry: unknown };
const refuse = (code: string, message: string, status = 409): never => { throw new WorkspaceError(code, message, status); };
const ordered = (a: DevicePasswordRecord, b: DevicePasswordRecord) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
const validRevision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < Number.MAX_SAFE_INTEGER;

/** Caller-supplied content stays in the current device namespace. Unlocking is
 * independent of account login; this class has no network or session access.
 * All content and command payloads use the existing vault envelopes. */
export class LocalPasswordVault {
 private key: DeviceVaultKey | null = null;
 private generation = 0;
 private disposed = false;
 private unlocking = false;
 private timer?: ReturnType<typeof setTimeout>;
 private listeners = new Set<() => void>();
 private retired: () => void;
 private readonly context: Promise<string>;
 constructor(private db: WorkspaceDatabase, readonly scope: WorkspaceScope, private lease: WorkspaceLease, browserOrigin: string) {
  if (new URL(browserOrigin).origin !== browserOrigin) throw new Error('Invalid device vault origin');
  const identity = JSON.stringify(['thingtime-device-vault', browserOrigin, workspaceScopeKey(scope)]);
  this.context = crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity)).then(hash =>
   'device-vault:' + [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''));
  this.retired = lease.onInvalidate(() => this.lock());
 }
 private check() { this.lease.assertCurrent(); if (this.disposed) refuse('VAULT_CLOSED', 'Reopen the password manager.'); }
 readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
 readonly isUnlocked = () => { try { this.check(); return this.key !== null; } catch { return false; } };
 lock() { clearTimeout(this.timer); this.key?.bytes.fill(0); this.key = null; this.generation++; this.listeners.forEach(listener => listener()); }
 dispose() { this.disposed = true; this.lock(); this.retired(); this.listeners.clear(); }
 touch() { if (this.isUnlocked()) this.arm(); }
 private arm() { clearTimeout(this.timer); this.timer = setTimeout(() => this.lock(), IDLE_MS); (this.timer as any).unref?.(); }
 private guarded(assertCurrent: () => void, signal?: AbortSignal): WorkspaceLease {
  return { assertCurrent, onInvalidate: callback => {
   const changed = () => { try { assertCurrent(); } catch { callback(); } };
   this.listeners.add(changed); signal?.addEventListener('abort', changed, { once: true });
   const unsubscribe = this.lease.onInvalidate(changed);
   return () => { this.listeners.delete(changed); signal?.removeEventListener('abort', changed); unsubscribe(); };
  } };
 }
 private operation(signal?: AbortSignal) {
  this.check(); const key = this.key, generation = this.generation;
  if (!key) return refuse('VAULT_LOCKED', 'Unlock this device vault to continue.', 423);
  this.arm();
  const assertCurrent = () => { this.check(); if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); if (this.generation !== generation || this.key !== key) refuse('VAULT_LOCKED', 'This device vault was locked. Unlock it again.', 423); };
  assertCurrent(); return { key, lease: this.guarded(assertCurrent, signal) };
 }
 async configured() { this.check(); return !!await this.db.transaction(this.scope, 'readonly', this.lease, tx => tx.get(KEYS, 'key')); }
 async unlock(password: string, create = false) {
  this.check(); if (this.unlocking) return refuse('VAULT_BUSY', 'A vault unlock is already in progress.');
  this.unlocking = true; this.lock(); const generation = this.generation;
  const check = () => { this.check(); if (this.generation !== generation) refuse('VAULT_LOCKED', 'Vault unlock was cancelled.', 423); };
  let key: DeviceVaultKey | undefined;
  try {
   const owner = await this.context; check();
   const header = await this.db.transaction(this.scope, 'readonly', this.lease, tx => tx.get<KeyHeader>(KEYS, 'key')); check();
   if (header) {
    if (header.version !== 1) refuse('VAULT_FORMAT', 'This device vault format is not supported.', 422);
    key = await unwrapDeviceVaultKey(owner, password, header.passwordKey, check);
   } else {
    if (!create) refuse('VAULT_MISSING', 'Set up this device vault first.', 404);
    if (typeof password !== 'string' || password.length < 12) refuse('VAULT_PASSPHRASE', 'Use a device vault passphrase of at least 12 characters.', 400);
    key = createDeviceVaultKey(); const passwordKey = await wrapDeviceVaultKey(owner, key, password, check); check();
    await this.db.transaction(this.scope, 'readwrite', this.guarded(check), async tx => {
     if (await tx.get(KEYS, 'key')) refuse('VAULT_EXISTS', 'Another tab set up this vault. Unlock it with its passphrase.');
     // An absent key beside encrypted records is damage, never an empty vault.
     if ((await tx.list(RECORDS)).length || (await tx.list(COMMANDS)).length) refuse('VAULT_DAMAGED', 'The saved device vault key is missing. Existing encrypted entries have been kept.', 422);
     await tx.put(KEYS, 'key', { version: 1, passwordKey } satisfies KeyHeader);
    });
   }
   check(); this.key = key; key = undefined; this.arm(); this.listeners.forEach(listener => listener());
  } finally { key?.bytes.fill(0); this.unlocking = false; }
 }
 private async value(record: DevicePasswordRecord, op: ReturnType<LocalPasswordVault['operation']>) {
  if (record.deleted || !record.encryptedValue) return refuse('PASSWORD_MISSING', 'Password entry not found.', 404);
  const plain = await openDeviceVaultValue(await this.context, op.key, record.id, record.encryptedValue); op.lease.assertCurrent();
  try { return validatePasswordEntry(JSON.parse(plain)); } catch { return refuse('VAULT_DAMAGED', 'This encrypted entry is invalid. Its saved data has been kept.', 422); }
 }
 private metadata(record: DevicePasswordRecord, entry: PasswordEntry): PasswordMetadata {
  return { id: record.id, revision: record.revision, updatedAt: record.updatedAt, title: entry.title, passwordType: entry.passwordType };
 }
 async read(id: string, signal?: AbortSignal) {
  if (!validPasswordId(id)) refuse('PASSWORD_ID', 'Invalid password entry.', 400);
  const op = this.operation(signal), record = await this.db.transaction(this.scope, 'readonly', op.lease, tx => tx.get<DevicePasswordRecord>(RECORDS, id));
  if (!record) return refuse('PASSWORD_MISSING', 'Password entry not found.', 404);
  const entry = await this.value(record, op); return { ...this.metadata(record, entry), entry };
 }
 async page(cursor?: string, includeValues = false, signal?: AbortSignal) {
  const op = this.operation(signal); let after: { id: string; createdAt: string } | null = null;
  if (cursor) {
   try { if (cursor.length > 200) throw Error(); after = JSON.parse(cursor); if (!after || !validPasswordId(after.id) || new Date(after.createdAt).toISOString() !== after.createdAt) throw Error(); }
   catch { return refuse('PASSWORD_CURSOR', 'Invalid password cursor.', 400); }
  }
  const rows = (await this.db.transaction(this.scope, 'readonly', op.lease, tx => tx.list<DevicePasswordRecord>(RECORDS)))
   .map(row => row.value).filter(row => !row.deleted && (!after || ordered(row, after as DevicePasswordRecord) > 0)).sort(ordered).slice(0, 51);
  const entries = [];
  for (const row of rows.slice(0, 50)) { const entry = await this.value(row, op); entries.push({ ...this.metadata(row, entry), ...(includeValues ? { entry } : {}) }); }
  op.lease.assertCurrent(); const last = rows[49];
  return { entries, nextCursor: rows.length > 50 ? JSON.stringify({ createdAt: last.createdAt, id: last.id }) : null };
 }
 async save(input: Save, signal?: AbortSignal) {
  if (!validPasswordId(input.id) || !validPasswordId(input.writeId) || !validRevision(input.revision)) refuse('PASSWORD_INPUT', 'A valid entry id, write id and revision are required.', 400);
  const op = this.operation(signal), entry = validatePasswordEntry(input.entry);
  for (const field of entry.fields) if (field.type === 'totp' && field.value) parseTotp(field.value);
  const owner = await this.context, plain = JSON.stringify(entry), encryptedValue = await sealDeviceVaultValue(owner, op.key, input.id, plain);
  const digest = await deviceVaultWriteDigest(op.key, input.id, plain);
  const commandValue = this.scope.kind === 'account' ? await sealDeviceVaultValue(owner, op.key, `command:${input.id}:${input.writeId}`, JSON.stringify({ entry })) : null;
  op.lease.assertCurrent();
  const record = await this.db.transaction(this.scope, 'readwrite', op.lease, async tx => {
   const previous = await tx.get<DevicePasswordRecord>(RECORDS, input.id);
   if (previous?.deleted) return refuse('PASSWORD_DELETED', 'This entry was deleted. Save a new entry instead.', 410);
   if (previous?.writeId === input.writeId) {
    if (previous.writeDigest !== digest) return refuse('PASSWORD_REPLAY', 'This save id was already used for different content.');
    return previous;
   }
   if ((previous?.revision ?? 0) !== input.revision) return refuse('PASSWORD_CONFLICT', 'This entry changed elsewhere. Reopen it before saving.');
   const now = new Date().toISOString(), next: DevicePasswordRecord = { id: input.id, revision: input.revision + 1, remoteRevision: previous?.remoteRevision ?? 0,
    createdAt: previous?.createdAt ?? now, updatedAt: now, encryptedValue, writeId: input.writeId, writeDigest: digest };
   await tx.put(RECORDS, input.id, next);
   if (commandValue) await tx.put(COMMANDS, `${input.id}:${input.writeId}`, { id: input.writeId, recordId: input.id, localRevision: next.revision, operation: 'save', encryptedValue: commandValue, state: 'pending' } satisfies DevicePasswordCommand);
   return next;
  });
  op.lease.assertCurrent(); return this.metadata(record, entry);
 }
 async remove(id: string, revision: number, signal?: AbortSignal) {
  if (!validPasswordId(id) || !validRevision(revision)) refuse('PASSWORD_INPUT', 'Select an entry and its current revision.', 400);
  const op = this.operation(signal), writeId = crypto.randomUUID();
  const commandValue = this.scope.kind === 'account' ? await sealDeviceVaultValue(await this.context, op.key, `command:${id}:${writeId}`, '{}') : null;
  op.lease.assertCurrent();
  await this.db.transaction(this.scope, 'readwrite', op.lease, async tx => {
   const previous = await tx.get<DevicePasswordRecord>(RECORDS, id);
   if (!previous) return refuse('PASSWORD_MISSING', 'Password entry not found.', 404);
   if (previous.deleted) return;
   if (previous.revision !== revision) return refuse('PASSWORD_CONFLICT', 'This entry changed. Reopen it before deleting.');
   const next: DevicePasswordRecord = { id, revision: revision + 1, remoteRevision: previous.remoteRevision, createdAt: previous.createdAt, updatedAt: new Date().toISOString(), deleted: true };
   await tx.put(RECORDS, id, next);
   if (commandValue) await tx.put(COMMANDS, `${id}:${writeId}`, { id: writeId, recordId: id, localRevision: next.revision, operation: 'delete', encryptedValue: commandValue, state: 'pending' } satisfies DevicePasswordCommand);
  });
  op.lease.assertCurrent();
 }
 async request(body?: Record<string, unknown>, cursor?: string, signal?: AbortSignal) {
  const ownerId = this.scope.kind === 'anonymous' ? 'local-workspace' : this.scope.ownerId;
  if (!body) return { ok: true, ownerId, configured: true, ...await this.page(cursor, false, signal) };
  if (body.operation === 'read') return { ok: true, ownerId, ...await this.read(body.id as string, signal) };
  if (body.operation === 'save') return { ok: true, ownerId, record: await this.save(body as Save, signal) };
  if (body.operation === 'delete') { await this.remove(body.id as string, body.revision as number, signal); return { ok: true, ownerId }; }
  if (body.operation === 'export') return { ok: true, ownerId, ...await this.page(body.cursor as string | undefined, true, signal) };
  return refuse('PASSWORD_OPERATION', 'This password operation is not available on this device.', 422);
 }
}
