import { validatePasswordEntry, validPasswordId, type PasswordEntry, type PasswordMetadata } from '../passwords/model';
import { parseTotp } from '../passwords/totp';
import { sealDeviceVaultValue, openDeviceVaultValue, deviceVaultWriteDigest } from '../passwords/vaultCrypto';
import type { VaultEnvelope } from '../passwords/vaultEnvelopeContract';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope } from './storage';

import { DeviceVaultSession, deviceVaultCollections } from './deviceVaultSession';
import { anonymousPasswordStorage, devicePasswordStorage, removeDevicePasswordFiles, type PasswordFileHost } from './passwordFiles';
import { passwordFileSyncStatus, synchronizePasswordFiles } from './passwordFileSync';
import type { PasswordFileTransport } from './passwordFileTransport.client';
import { reconcilePasswordFiles } from './passwordFileReconcile';

const { records: RECORDS, commands: COMMANDS } = deviceVaultCollections('passwords');
export type DevicePasswordRecord = { id: string; revision: number; remoteRevision: number; createdAt: string; updatedAt: string;
  encryptedValue?: VaultEnvelope; deleted?: true; writeId?: string; writeDigest?: string };
export type DevicePasswordCommand = { id: string; recordId: string; localRevision: number; operation: 'save' | 'delete';
  encryptedValue: VaultEnvelope; state: 'pending' | 'frozen' | 'refused'; expectedRevision?: number;
  claim?: { token: string; until: number }; attempts?: number; retryAt?: number; status?: number };
export type PasswordVaultRemoteEntry = PasswordMetadata & { entry: PasswordEntry };
export type PasswordVaultTransport = {
  write(command: { operation: 'save' | 'delete'; id: string; writeId: string; revision: number; entry?: PasswordEntry }, signal: AbortSignal): Promise<{ record?: PasswordMetadata }>;
  read(id: string, signal: AbortSignal): Promise<PasswordVaultRemoteEntry | null>;
  page(cursor: string | undefined, signal: AbortSignal): Promise<{ entries: PasswordVaultRemoteEntry[]; nextCursor: string | null }>;
};
type Save = { id: string; writeId: string; revision: number; entry: unknown };
const refuse = (code: string, message: string, status = 409): never => { throw new WorkspaceError(code, message, status); };
const ordered = (a: DevicePasswordRecord, b: DevicePasswordRecord) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
const validRevision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < Number.MAX_SAFE_INTEGER;

/** Caller-supplied content stays in the current device namespace. Unlocking is
 * independent of account login; this class has no network or session access.
 * All content and command payloads use the existing vault envelopes. */
export class LocalPasswordVault extends DeviceVaultSession {
 constructor(db: WorkspaceDatabase, scope: WorkspaceScope, lease: WorkspaceLease, browserOrigin: string) {
  super(db, scope, lease, browserOrigin, 'passwords');
 }
 private fileStorageHost(): PasswordFileHost {
  return { db: this.db, scope: this.scope, lease: this.lease, context: this.context,
   operation: (signal, touch) => this.operation(signal, touch),
   exportPage: async (cursor, signal) => {
    const page = await this.page(cursor, true, signal);
    return { ...page, entries: page.entries.map(record => ({ id: record.id, entry: record.entry! })) };
   }
  };
 }
 anonymousStorage() { return anonymousPasswordStorage(this.fileStorageHost()); }
 fileStorage() { return devicePasswordStorage(this.fileStorageHost()); }
 fileSyncStatus() { return passwordFileSyncStatus(this.fileStorageHost()); }
 synchronizeFiles(transport: PasswordFileTransport, signal?: AbortSignal, now?: () => number) {
  return synchronizePasswordFiles(this.fileStorageHost(), transport, signal, now);
 }
 reconcileFiles(transport: PasswordFileTransport, signal?: AbortSignal) {
  return reconcilePasswordFiles(this.fileStorageHost(), transport, signal);
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
  // Reads also serve automatic list/conflict refreshes. Only user activity
  // (touch) and explicit mutations renew the idle deadline.
  const op = this.operation(signal, false), record = await this.db.transaction(this.scope, 'readonly', op.lease, tx => tx.get<DevicePasswordRecord>(RECORDS, id));
  if (!record) return refuse('PASSWORD_MISSING', 'Password entry not found.', 404);
  const entry = await this.value(record, op); return { ...this.metadata(record, entry), entry };
 }
 async page(cursor?: string, includeValues = false, signal?: AbortSignal) {
  const op = this.operation(signal, false); let after: { id: string; createdAt: string } | null = null;
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
   await removeDevicePasswordFiles(tx, id);
   if (commandValue) await tx.put(COMMANDS, `${id}:${writeId}`, { id: writeId, recordId: id, localRevision: next.revision, operation: 'delete', encryptedValue: commandValue, state: 'pending' } satisfies DevicePasswordCommand);
  });
  op.lease.assertCurrent();
 }
 private accountOperation(signal?: AbortSignal) {
  if (this.scope.kind !== 'account') return refuse('ACCOUNT_REQUIRED', 'Anonymous password vaults never synchronize.', 403);
  return this.operation(signal, false);
 }
 /** Value-free queue state. Do not surface or persist server exception text. */
 async syncStatus() {
  this.check();
  if (this.scope.kind !== 'account') return [];
  return this.db.transaction(this.scope, 'readonly', this.lease, async tx => {
   const records = new Map((await tx.list<DevicePasswordRecord>(RECORDS)).map(row => [row.id, row.value]));
   return (await tx.list<DevicePasswordCommand>(COMMANDS)).map(({ value }) => ({
    id: value.id, recordId: value.recordId, revision: records.get(value.recordId)?.revision ?? value.localRevision,
    canCopy: !!records.get(value.recordId)?.encryptedValue, state: value.state, status: value.status, retryAt: value.retryAt ?? 0
   }));
  });
 }
 /** Freeze before sending, claim across tabs, then advance only from a validated
  * receipt. Later local edits remain independent and cannot change the retry. */
 async synchronize(transport: PasswordVaultTransport, signal?: AbortSignal, now = () => Date.now()) {
  const op = this.accountOperation(signal), controller = new AbortController();
  const off = op.lease.onInvalidate(() => controller.abort());
  const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
  let completed = 0; const attempted = new Set<string>();
  try {
   for (let count = 0; count < 20; count++) {
    op.lease.assertCurrent(); combined.throwIfAborted();
    const claim = await this.db.transaction(this.scope, 'readwrite', op.lease, async tx => {
     const rows = (await tx.list<DevicePasswordCommand>(COMMANDS)).sort((a, b) => a.value.localRevision - b.value.localRevision || a.id.localeCompare(b.id));
     const seen = new Set<string>();
     for (const row of rows) {
      const item = row.value;
      if (seen.has(item.recordId)) continue; seen.add(item.recordId);
      if (attempted.has(item.recordId) || item.state === 'refused' || (item.retryAt ?? 0) > now() || (item.claim?.until ?? 0) > now()) continue;
      const record = await tx.get<DevicePasswordRecord>(RECORDS, item.recordId);
      if (!record) return refuse('VAULT_DAMAGED', 'A queued password entry is missing. Its encrypted command has been kept.', 422);
      const next: DevicePasswordCommand = { ...item, state: 'frozen', expectedRevision: item.expectedRevision ?? record.remoteRevision,
       claim: { token: crypto.randomUUID(), until: now() + 60_000 }, attempts: (item.attempts ?? 0) + 1 };
      await tx.put(COMMANDS, row.id, next); return { key: row.id, command: next };
     }
     return null;
    });
    if (!claim) break;
    const item = claim.command; let dispatched = false;
    try {
     const plain = await openDeviceVaultValue(await this.context, op.key, `command:${item.recordId}:${item.id}`, item.encryptedValue);
     const payload = JSON.parse(plain), entry = item.operation === 'save' ? validatePasswordEntry(payload.entry) : undefined;
     op.lease.assertCurrent(); combined.throwIfAborted();
     dispatched = true;
     const receipt = await transport.write({ operation: item.operation, id: item.recordId, writeId: item.id, revision: item.expectedRevision!, ...(entry ? { entry } : {}) }, combined);
     op.lease.assertCurrent(); combined.throwIfAborted();
     if (item.operation === 'save' && (receipt.record?.id !== item.recordId || receipt.record.revision !== item.expectedRevision! + 1))
      refuse('VAULT_RECEIPT', 'The account returned an invalid save receipt. The encrypted retry has been kept.', 502);
     const accepted = await this.db.transaction(this.scope, 'readwrite', op.lease, async tx => {
      const current = await tx.get<DevicePasswordCommand>(COMMANDS, claim.key);
      if (current?.claim?.token !== item.claim!.token) return;
      const record = await tx.get<DevicePasswordRecord>(RECORDS, item.recordId);
      if (!record || record.remoteRevision !== item.expectedRevision) return refuse('VAULT_DAMAGED', 'The queued password base changed unexpectedly.', 422);
      await tx.put(RECORDS, record.id, { ...record, remoteRevision: item.expectedRevision! + 1 });
      await tx.delete(COMMANDS, claim.key); return true;
     });
     if (accepted) completed++;
    } catch (error) {
     op.lease.assertCurrent(); combined.throwIfAborted(); attempted.add(item.recordId);
     const status = dispatched ? Number((error as any)?.status) || 0 : 422;
     // A response may have been lost after commit. Retain the exact encrypted
     // command, expected revision and write id through every uncertain attempt.
     const refused = status >= 400 && status < 500 && ![408, 429].includes(status);
     await this.db.transaction(this.scope, 'readwrite', op.lease, async tx => {
      const current = await tx.get<DevicePasswordCommand>(COMMANDS, claim.key);
      if (current?.claim?.token !== item.claim!.token) return;
      const retry = Math.max(1000, Math.min(86_400_000, Number((error as any)?.retryAfterMs) || 1000 * 2 ** Math.min(item.attempts ?? 1, 6)));
      await tx.put(COMMANDS, claim.key, { ...current, claim: undefined, state: refused ? 'refused' : 'frozen', status, retryAt: refused ? 0 : now() + retry });
     });
    }
   }
   return { completed };
  } finally { off(); }
 }
 /** Explicit review can keep the account value or preserve the device value
  * as a new independent entry. It never force-overwrites the conflicting entry. */
 async resolveRefused(recordId: string, revision: number, choice: 'account' | 'copy', transport: PasswordVaultTransport, signal?: AbortSignal) {
  if (!validPasswordId(recordId) || !validRevision(revision) || !['account', 'copy'].includes(choice)) refuse('PASSWORD_INPUT', 'Choose a valid conflict resolution.', 400);
  const op = this.accountOperation(signal), controller = new AbortController(), off = op.lease.onInvalidate(() => controller.abort());
  const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
  try {
   const before = await this.db.transaction(this.scope, 'readonly', op.lease, async tx => {
    const record = await tx.get<DevicePasswordRecord>(RECORDS, recordId);
    const commands = (await tx.list<DevicePasswordCommand>(COMMANDS)).filter(row => row.value.recordId === recordId).sort((a,b) => a.value.localRevision - b.value.localRevision);
    if (!record || record.revision !== revision || commands[0]?.value.state !== 'refused') return refuse('PASSWORD_CONFLICT', 'This conflict changed. Review it again.');
    return { record, first: commands[0].value.id };
   });
   const local = choice === 'copy' ? await this.value(before.record, op) : null;
   const remote = await transport.read(recordId, combined); op.lease.assertCurrent(); combined.throwIfAborted();
   if (remote && (remote.id !== recordId || !validRevision(remote.revision) || remote.revision < 1 || new Date(remote.updatedAt).toISOString() !== remote.updatedAt))
    return refuse('VAULT_RESPONSE', 'The account returned an invalid password entry.', 502);
   const owner = await this.context, remoteValue = remote ? await sealDeviceVaultValue(owner, op.key, recordId, JSON.stringify(validatePasswordEntry(remote.entry))) : undefined;
   const id = crypto.randomUUID(), writeId = crypto.randomUUID(), stamp = new Date().toISOString();
   const copy = local ? { value: await sealDeviceVaultValue(owner, op.key, id, JSON.stringify(local)),
    command: await sealDeviceVaultValue(owner, op.key, `command:${id}:${writeId}`, JSON.stringify({ entry: local })), digest: await deviceVaultWriteDigest(op.key, id, JSON.stringify(local)) } : null;
   await this.db.transaction(this.scope, 'readwrite', op.lease, async tx => {
    const record = await tx.get<DevicePasswordRecord>(RECORDS, recordId), commands = (await tx.list<DevicePasswordCommand>(COMMANDS)).filter(row => row.value.recordId === recordId).sort((a,b) => a.value.localRevision - b.value.localRevision);
    if (record?.revision !== revision || commands[0]?.value.id !== before.first || commands[0]?.value.state !== 'refused') return refuse('PASSWORD_CONFLICT', 'This conflict changed. Review it again.');
    for (const command of commands) await tx.delete(COMMANDS, command.id);
    await tx.put(RECORDS, recordId, { id: recordId, revision: revision + 1, remoteRevision: remote?.revision ?? record.remoteRevision,
     createdAt: record.createdAt, updatedAt: remote?.updatedAt ?? stamp, ...(remoteValue ? { encryptedValue: remoteValue } : { deleted: true as const }) } satisfies DevicePasswordRecord);
    if (copy) {
     await tx.put(RECORDS, id, { id, revision: 1, remoteRevision: 0, createdAt: stamp, updatedAt: stamp, encryptedValue: copy.value, writeId, writeDigest: copy.digest } satisfies DevicePasswordRecord);
     await tx.put(COMMANDS, `${id}:${writeId}`, { id: writeId, recordId: id, localRevision: 1, operation: 'save', encryptedValue: copy.command, state: 'pending' } satisfies DevicePasswordCommand);
    }
   });
   return { copiedId: copy ? id : null };
  } finally { off(); }
 }
 /** Pull decrypted pages only while the verified transport and local unlock
  * remain valid. Every retained entry is encrypted before the transaction. */
 async reconcile(transport: PasswordVaultTransport, signal?: AbortSignal) {
  const op = this.accountOperation(signal), controller = new AbortController(), off = op.lease.onInvalidate(() => controller.abort());
  const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
  const baseline = await this.db.transaction(this.scope, 'readonly', op.lease, tx => tx.list<DevicePasswordRecord>(RECORDS));
  const seen = new Set<string>(), cursors = new Set<string>(); let cursor: string | undefined;
  try {
   for (let pages = 0; ; pages++) {
    if (pages >= 200) return refuse('VAULT_LIMIT', 'The account vault exceeds this device workspace limit.', 413);
    op.lease.assertCurrent(); combined.throwIfAborted();
    const page = await transport.page(cursor, combined); op.lease.assertCurrent(); combined.throwIfAborted();
    if (!Array.isArray(page.entries) || page.entries.length > 50 || (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || !page.nextCursor || page.nextCursor.length > 200 || cursors.has(page.nextCursor))))
     return refuse('VAULT_RESPONSE', 'The account returned an invalid password page.', 502);
    const retained = [];
    for (const remote of page.entries) {
     if (!validPasswordId(remote.id) || !validRevision(remote.revision) || remote.revision < 1 || seen.has(remote.id) || new Date(remote.updatedAt).toISOString() !== remote.updatedAt)
      return refuse('VAULT_RESPONSE', 'The account returned an invalid password entry.', 502);
     seen.add(remote.id); const entry = validatePasswordEntry(remote.entry);
     const encryptedValue = await sealDeviceVaultValue(await this.context, op.key, remote.id, JSON.stringify(entry));
     retained.push({ remote, encryptedValue });
    }
    await this.db.transaction(this.scope, 'readwrite', op.lease, async tx => {
     const pending = new Set((await tx.list<DevicePasswordCommand>(COMMANDS)).map(row => row.value.recordId));
     for (const { remote, encryptedValue } of retained) {
      const old = await tx.get<DevicePasswordRecord>(RECORDS, remote.id);
      if (pending.has(remote.id) || (old && (old.deleted || old.remoteRevision >= remote.revision))) continue;
      await tx.put(RECORDS, remote.id, { id: remote.id, revision: (old?.revision ?? 0) + 1, remoteRevision: remote.revision,
       createdAt: old?.createdAt ?? remote.updatedAt, updatedAt: remote.updatedAt, encryptedValue } satisfies DevicePasswordRecord);
     }
    });
    if (page.nextCursor === null) break;
    cursors.add(page.nextCursor); cursor = page.nextCursor;
   }
   // Only a complete traversal can remove vanished account entries. Concurrent
   // local writes or newer pulls are protected by the captured revision pair.
   await this.db.transaction(this.scope, 'readwrite', op.lease, async tx => {
    const pending = new Set((await tx.list<DevicePasswordCommand>(COMMANDS)).map(row => row.value.recordId));
    for (const { value: before } of baseline) {
     if (seen.has(before.id) || pending.has(before.id) || before.deleted || !before.remoteRevision) continue;
     const current = await tx.get<DevicePasswordRecord>(RECORDS, before.id);
     if (current && current.revision === before.revision && current.remoteRevision === before.remoteRevision)
      await tx.put(RECORDS, before.id, { id: before.id, revision: before.revision + 1, remoteRevision: before.remoteRevision, createdAt: before.createdAt, updatedAt: new Date().toISOString(), deleted: true } satisfies DevicePasswordRecord);
    }
   });
   return { retained: seen.size };
  } finally { off(); }
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
