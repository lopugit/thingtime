import { parseUserVaultWrite, parseUserVaultWriteAcknowledgment, type UserVaultWrite } from '../api/utils/lopu/userVaultWriteContract';
import { DeviceVaultSession, deviceVaultCollections } from './deviceVaultSession';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope } from './storage';
import { deviceVaultWriteDigest, openDeviceVaultValue, sealDeviceVaultValue } from '../passwords/vaultCrypto';
import type { VaultEnvelope } from '../passwords/vaultEnvelopeContract';
import {
 LOPU_PROVIDER_TEMPLATES, validUserVaultSnapshotVersion as validRemoteVersion, normalizeUserVaultSecretMetadata, validUserVaultValue, normalizeUserVaultGroup, normalizeUserVaultSecret, normalizeUserVaultProvider, normalizeUserVaultGroupId, safeVaultId,
 type PublicVaultEntry, type PublicVaultGroup, type UserVaultGroupFields, type UserVaultSecretFields, type UserVaultProviderFields
} from '../api/utils/lopu/userVaultModel';
const collections = deviceVaultCollections('providers');
const MAX_ENTRIES = 500;
type RetainedContent = ({ kind: 'group' } & UserVaultGroupFields) | ({ kind: 'secret' } & UserVaultSecretFields) | ({ kind: 'provider' } & Omit<UserVaultProviderFields, 'token'> & { token: string });
type RemoteContent = (({ kind: 'secret' } & Omit<UserVaultSecretFields, 'value'>) | ({ kind: 'provider' } & Omit<UserVaultProviderFields, 'token'>)) & { remoteOnly: true };
type Content = RetainedContent | RemoteContent;
const remoteOnly = (value: Content): value is RemoteContent => 'remoteOnly' in value && value.remoteOnly === true;
const validTimestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export type ProviderVaultMetadataTransport = {
 metadata(signal: AbortSignal): Promise<{ complete: true; groups: Array<PublicVaultGroup & { version: string }>; entries: Array<PublicVaultEntry & { version: string }> }>;
};
export type DeviceProviderRecord = { id: string; revision: number; remoteRevision: number; remoteVersion?: string; createdAt: string; updatedAt: string; encryptedValue?: VaultEnvelope; deleted?: true; writeId?: string; writeDigest?: string };
export type DeviceProviderCommand = { id: string; recordId: string; localRevision: number; sequence: number; encryptedValue: VaultEnvelope; state: 'pending' | 'frozen' | 'refused'; claim?: string; claimUntil?: number; retryAt?: number; status?: number };
export type DeviceProviderGroup = PublicVaultGroup & { revision: number };
export type DeviceProviderEntry = PublicVaultEntry & { revision: number; valueAvailableOffline: boolean };
const fail = (code: string, message: string, status = 409): never => { throw new WorkspaceError(code, message, status); };
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < Number.MAX_SAFE_INTEGER;
const stamp = (rows: DeviceProviderRecord[]) => JSON.stringify(rows.map(row => [row.id, row.revision, !!row.deleted, row.remoteVersion ?? null, row.remoteRevision]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))));
const fields: Record<string, string[]> = {
 'create-group': ['name'], 'save-secret': ['name','key','value','groupId'], 'save-provider': ['name','provider','endpoint','model','token','groupId'],
 'move-entry': ['groupId'], 'delete': []
};
type CommandFields = { name?: unknown; key?: unknown; value?: unknown; groupId?: unknown; provider?: unknown; endpoint?: unknown; model?: unknown; token?: unknown };
function input(raw: Record<string, unknown>): CommandFields & { action: string; id: string; writeId: string; revision: number } {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.action !== 'string' || !Object.prototype.hasOwnProperty.call(fields, raw.action)) return fail('VAULT_INPUT', 'Choose a supported vault operation.', 400);
 const allowed = new Set(['action','id','writeId','revision',...fields[raw.action]]);
 if (Object.keys(raw).some(key => !allowed.has(key))) return fail('VAULT_INPUT', 'Unsupported vault input field.', 400);
 const id = safeVaultId(raw.id), writeId = safeVaultId(raw.writeId);
 if (!id || !writeId || !revision(raw.revision)) return fail('VAULT_INPUT', 'A valid entry, write id and revision are required.', 400);
 let values: object = {};
 try {
  if (raw.action === 'create-group') values = normalizeUserVaultGroup(raw);
  if (raw.action === 'save-secret') values = normalizeUserVaultSecret(raw);
  if (raw.action === 'save-provider') values = normalizeUserVaultProvider(raw);
  if (raw.action === 'move-entry') {
   if (raw.groupId === undefined) throw new Error('Choose an environment or Ungrouped.');
   values = { groupId: normalizeUserVaultGroupId(raw.groupId) };
  }
 } catch (error) { return fail('VAULT_INPUT', error instanceof Error ? error.message : 'Invalid vault entry.', 400); }
 return { action: raw.action, id, writeId, revision: raw.revision, ...values };
}

/** Local metadata and values are encrypted together. This adapter has no fetch,
 * account credentials, Actions or provider execution. Account intent is retained
 * separately; only the account-bound synchronization layer may transmit it. */
export class LocalProviderVault extends DeviceVaultSession {
 constructor(db: WorkspaceDatabase, scope: WorkspaceScope, lease: WorkspaceLease, origin: string) { super(db, scope, lease, origin, 'providers'); }
 private validateRow(id: string, row: DeviceProviderRecord) {
  try {
   if (!row || row.id !== id || !safeVaultId(id) || !revision(row.revision) || row.revision < 1 || !revision(row.remoteRevision) || ((row.writeId !== undefined || row.writeDigest !== undefined) && (!safeVaultId(row.writeId) || typeof row.writeDigest !== 'string' || !row.writeDigest || row.writeDigest.length > 256)) ||
    (row.remoteVersion !== undefined && (this.scope.kind !== 'account' || !validRemoteVersion(row.remoteVersion))) ||
    new Date(row.createdAt).toISOString() !== row.createdAt || new Date(row.updatedAt).toISOString() !== row.updatedAt ||
    (row.deleted === true ? row.encryptedValue !== undefined : row.deleted !== undefined || !row.encryptedValue)) throw Error();
   return row;
  } catch { return fail('VAULT_DAMAGED', 'Saved vault metadata is invalid. Existing data has been kept.', 422); }
 }
 private async rows(op: ReturnType<LocalProviderVault['operation']>) {
  return (await this.db.transaction(this.scope, 'readonly', op.lease, tx => tx.list<DeviceProviderRecord>(collections.records))).map(row => this.validateRow(row.id, row.value));
 }
 private async decode(row: DeviceProviderRecord, op: ReturnType<LocalProviderVault['operation']>): Promise<Content> {
  if (row.deleted || !row.encryptedValue) return fail('VAULT_MISSING', 'Vault entry not found.', 404);
  let plain: string;
  try { plain = await openDeviceVaultValue(await this.context, op.key, row.id, row.encryptedValue); }
  catch { op.lease.assertCurrent(); return fail('VAULT_DAMAGED', 'The encrypted entry could not be opened. Saved data has been kept.', 422); }
  op.lease.assertCurrent();
  try {
   const value = JSON.parse(plain);
   if (value.kind === 'group') return { kind: 'group', ...normalizeUserVaultGroup(value) };
   if (value.remoteOnly === true) {
    if (this.scope.kind !== 'account' || !validRemoteVersion(row.remoteVersion) || 'value' in value || 'token' in value) throw Error();
    if (value.kind === 'secret') return { kind: 'secret', remoteOnly: true, ...normalizeUserVaultSecretMetadata(value) };
    if (value.kind === 'provider') {
     const { token: _token, ...metadata } = normalizeUserVaultProvider(value);
     return { kind: 'provider', remoteOnly: true, ...metadata };
    }
    throw Error();
   }
   if (value.remoteOnly !== undefined) throw Error();
   if (value.kind === 'secret') return { kind: 'secret', ...normalizeUserVaultSecret(value) };
   if (value.kind === 'provider') {
    const normalized = normalizeUserVaultProvider(value); if (!normalized.token) throw Error();
    return { kind: 'provider', ...normalized, token: normalized.token };
   }
   throw Error();
  } catch { return fail('VAULT_DAMAGED', 'The encrypted entry is invalid. Saved data has been kept.', 422); }
 }
 private metadata(row: DeviceProviderRecord, value: Content): DeviceProviderGroup | DeviceProviderEntry {
  const base = { id: row.id, revision: row.revision, name: value.name, createdAt: row.createdAt, updatedAt: row.updatedAt };
  if (value.kind === 'group') return base;
  return { ...base, kind: value.kind, groupId: value.groupId, hasValue: true, valueAvailableOffline: !remoteOnly(value),
   ...(value.kind === 'secret' ? { key: value.key } : { provider: value.provider, endpoint: value.endpoint, ...(value.model ? { model: value.model } : {}) }) };
 }
 async list(signal?: AbortSignal) {
  const op = this.operation(signal, false), rows = (await this.rows(op)).filter(row => !row.deleted);
  if (rows.length > MAX_ENTRIES) return fail('VAULT_LIMIT', 'The vault exceeds this device entry limit.', 413);
  const groups: DeviceProviderGroup[] = [], entries: DeviceProviderEntry[] = [];
  for (const row of rows) {
   const value = await this.decode(row, op), metadata = this.metadata(row, value);
   if (value.kind === 'group') groups.push(metadata as DeviceProviderGroup); else entries.push(metadata as DeviceProviderEntry);
  }
  op.lease.assertCurrent(); groups.sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)); entries.sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { ok: true as const, vaultConfigured: true, groups, entries, providerTemplates: LOPU_PROVIDER_TEMPLATES };
 }
 async reveal(requestedId: string, signal?: AbortSignal) {
  const id = safeVaultId(requestedId);
  if (!id) return fail('VAULT_INPUT', 'Select a valid vault entry.', 400);
  const op = this.operation(signal, false), row = await this.db.transaction(this.scope, 'readonly', op.lease, tx => tx.get<DeviceProviderRecord>(collections.records, id));
  if (!row) return fail('VAULT_MISSING', 'Vault entry not found.', 404);
  const value = await this.decode(this.validateRow(id, row), op); if (value.kind === 'group') return fail('VAULT_MISSING', 'Vault entry not found.', 404);
  if (remoteOnly(value)) return fail('VAULT_VALUE_REMOTE', 'This value has not been retained on this device. Reconnect and verify the selected value to keep it offline.', 409);
  return { id, revision: row.revision, value: value.kind === 'secret' ? value.value : value.token };
 }
 async mutate(raw: Record<string, unknown>, signal?: AbortSignal) {
  const command = input(raw), op = this.operation(signal), owner = await this.context;
  const digest = await deviceVaultWriteDigest(op.key, command.id, JSON.stringify(command)); op.lease.assertCurrent();
  const rows = await this.rows(op), before = rows.find(row => row.id === command.id);
  if (before?.writeId === command.writeId) {
   if (before.writeDigest !== digest) return fail('VAULT_REPLAY', 'This save id was used for different content.');
   return before.deleted ? { ok: true as const, deleted: true as const } : this.result(before, await this.decode(before, op));
  }
  if ((before?.revision ?? 0) !== command.revision) return fail('VAULT_CONFLICT', 'This vault entry changed. Refresh before saving.');
  if (before?.deleted) return fail('VAULT_DELETED', 'This entry was deleted. Create a new entry instead.', 410);
  const current = before ? await this.decode(before, op) : null;
  let next: Content | null = null;
  if (command.action === 'create-group') {
   if (before) return fail('VAULT_EXISTS', 'This environment already exists.');
   next = { kind: 'group', ...normalizeUserVaultGroup(command) };
  } else if (command.action === 'save-secret') {
   if (current && current.kind !== 'secret') return fail('VAULT_KIND', 'Select a secret entry.', 400);
   next = { kind: 'secret', ...normalizeUserVaultSecret(command) };
  } else if (command.action === 'save-provider') {
   if (current && current.kind !== 'provider') return fail('VAULT_KIND', 'Select a provider entry.', 400);
   const normalized = normalizeUserVaultProvider(command), token = normalized.token ?? (current?.kind === 'provider' && !remoteOnly(current) ? current.token : null);
   if (!token && current?.kind === 'provider' && remoteOnly(current)) {
    const { token: _token, ...metadata } = normalized;
    next = { kind: 'provider', remoteOnly: true, ...metadata };
   } else {
    if (!token) return fail('VAULT_INPUT', 'A provider token is required when creating a connection.', 400);
    next = { kind: 'provider', ...normalized, token };
   }
  } else if (command.action === 'move-entry') {
   if (!current || current.kind === 'group') return fail('VAULT_MISSING', 'Vault entry not found.', 404);
   next = { ...current, groupId: normalizeUserVaultGroupId((command as any).groupId) };
  } else if (command.action === 'delete') {
   if (!current) return fail('VAULT_MISSING', 'Vault entry not found.', 404);
   if (current.kind === 'group') for (const row of rows.filter(row => !row.deleted && row.id !== command.id)) {
    const value = await this.decode(row, op);
    if (value.kind !== 'group' && value.groupId === command.id) return fail('VAULT_NOT_EMPTY', 'Move or delete the entries in this environment first.');
   }
  }
  if (next && next.kind !== 'group' && next.groupId) {
   const groupId = next.groupId, group = rows.find(row => row.id === groupId && !row.deleted);
   if (!group || (await this.decode(group, op)).kind !== 'group') return fail('VAULT_GROUP', 'Vault environment was not found.', 404);
  }
  if (!before && rows.filter(row => !row.deleted).length >= MAX_ENTRIES) return fail('VAULT_LIMIT', 'Keep at most 500 entries in this device vault.', 413);
  const time = new Date().toISOString(), record: DeviceProviderRecord = { id: command.id, revision: command.revision + 1, remoteRevision: before?.remoteRevision ?? 0,
   ...(before?.remoteVersion ? { remoteVersion: before.remoteVersion } : {}), createdAt: before?.createdAt ?? time, updatedAt: time, writeId: command.writeId, writeDigest: digest,
   ...(next ? { encryptedValue: await sealDeviceVaultValue(owner, op.key, command.id, JSON.stringify(next)) } : { deleted: true as const }) };
  const encryptedCommand = this.scope.kind === 'account' ? await sealDeviceVaultValue(owner, op.key, `command:${command.id}:${command.writeId}`, JSON.stringify(command)) : null;
  const expected = stamp(rows);
  await this.db.transaction(this.scope, 'readwrite', op.lease, async tx => {
   if (stamp((await tx.list<DeviceProviderRecord>(collections.records)).map(row => row.value)) !== expected) return fail('VAULT_CONFLICT', 'The vault changed in another operation. Refresh before saving.');
   await tx.put(collections.records, command.id, record);
   if (encryptedCommand) {
    const sequence = ((await tx.get<number>(collections.keys, 'sequence')) ?? 0) + 1;
    if (!revision(sequence)) return fail('VAULT_LIMIT', 'The device sync sequence limit was reached.', 413);
    await tx.put(collections.keys, 'sequence', sequence);
    await tx.put(collections.commands, `${command.id}:${command.writeId}`, { id: command.writeId, recordId: command.id, localRevision: record.revision, sequence, encryptedValue: encryptedCommand, state: 'pending' } satisfies DeviceProviderCommand);
   }
  });
  op.lease.assertCurrent(); return next ? this.result(record, next) : { ok: true as const, deleted: true as const };
 }
 private result(row: DeviceProviderRecord, value: Content) {
  const metadata = this.metadata(row, value); return value.kind === 'group' ? { ok: true as const, group: metadata as DeviceProviderGroup } : { ok: true as const, entry: metadata as DeviceProviderEntry };
 }
 /** A complete metadata snapshot never requests credential values. Prepare every
  * encrypted replacement before one atomic adoption; pending local work wins. */
 async reconcileMetadata(transport: ProviderVaultMetadataTransport, signal?: AbortSignal) {
  if (this.scope.kind !== 'account') return fail('ACCOUNT_REQUIRED', 'Anonymous vaults never synchronize.', 403);
  const op = this.operation(signal, false), controller = new AbortController(), off = op.lease.onInvalidate(() => controller.abort());
  const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
  try {
   const baseline = await this.rows(op), expected = stamp(baseline);
   const dependencies = new Map<string, string>();
   for (const row of baseline.filter(item => !item.deleted)) { const content = await this.decode(row, op); if (content.kind !== 'group' && content.groupId) dependencies.set(row.id, content.groupId); }
   const snapshot = await transport.metadata(combined); op.lease.assertCurrent(); combined.throwIfAborted();
   if (!snapshot || snapshot.complete !== true || !Array.isArray(snapshot.groups) || !Array.isArray(snapshot.entries) || snapshot.groups.length + snapshot.entries.length > MAX_ENTRIES)
    return fail('VAULT_RESPONSE', 'The account returned an incomplete or oversized vault snapshot.', 502);
   if (snapshot.groups.some(row => !row || typeof row !== 'object' || Array.isArray(row) || 'kind' in row) ||
    snapshot.entries.some(row => !row || typeof row !== 'object' || Array.isArray(row) || !['secret','provider'].includes(row.kind)))
    return fail('VAULT_RESPONSE', 'The account returned invalid vault metadata.', 502);
   const seen = new Set<string>(), groups = new Set(snapshot.groups.map(row => row.id)), prepared: DeviceProviderRecord[] = [];
   for (const raw of [...snapshot.groups.map(row => ({ ...row, kind: 'group' as const })), ...snapshot.entries]) {
    const allowed = new Set(['id','kind','version','name','createdAt','updatedAt',...(raw.kind === 'group' ? [] : ['groupId','hasValue',...(raw.kind === 'secret' ? ['key'] : ['provider','endpoint','model'])])]);
    if (!raw || Object.keys(raw).some(key => !allowed.has(key)) || !safeVaultId(raw.id) || seen.has(raw.id) || !validRemoteVersion(raw.version) ||
     !validTimestamp(raw.createdAt) || !validTimestamp(raw.updatedAt))
     return fail('VAULT_RESPONSE', 'The account returned invalid vault metadata.', 502);
    seen.add(raw.id);
    let content: Content;
    try {
     if (raw.kind === 'group') content = { kind: 'group', ...normalizeUserVaultGroup(raw) };
     else if (raw.kind === 'secret') content = { kind: 'secret', remoteOnly: true, ...normalizeUserVaultSecretMetadata(raw) };
     else if (raw.kind === 'provider') {
      const { token: _token, ...metadata } = normalizeUserVaultProvider(raw);
      content = { kind: 'provider', remoteOnly: true, ...metadata };
     } else throw Error();
     if (content.kind !== 'group' && (!('hasValue' in raw) || raw.hasValue !== true || (content.groupId && !groups.has(content.groupId)))) throw Error();
    } catch { return fail('VAULT_RESPONSE', 'The account returned invalid vault metadata.', 502); }
    const before = baseline.find(row => row.id === raw.id);
    if (before?.remoteVersion === raw.version && !before.deleted) { prepared.push(before); continue; }
    const record: DeviceProviderRecord = { id: raw.id, revision: (before?.revision ?? 0) + 1, remoteRevision: before?.remoteRevision ?? 0, remoteVersion: raw.version,
     createdAt: raw.createdAt, updatedAt: raw.updatedAt, encryptedValue: await sealDeviceVaultValue(await this.context, op.key, raw.id, JSON.stringify(content)) };
    this.validateRow(record.id, record); prepared.push(record);
   }
   await this.db.transaction(this.scope, 'readwrite', op.lease, async tx => {
    if (stamp((await tx.list<DeviceProviderRecord>(collections.records)).map(row => row.value)) !== expected) return fail('VAULT_CONFLICT', 'The vault changed while metadata was loading. Local edits have been kept.');
    const pending = new Set((await tx.list<DeviceProviderCommand>(collections.commands)).map(row => row.value.recordId));
    // Keep environment metadata needed by unsent children, including when a
    // generic account edit removed that environment. Sync must review it later.
    for (const id of [...pending]) { const group = dependencies.get(id); if (group) pending.add(group); }
    const adopted = new Map(baseline.map(row => [row.id, row]));
    for (const row of prepared) if (!pending.has(row.id)) adopted.set(row.id, row);
    for (const row of baseline) if (!seen.has(row.id) && row.remoteVersion && !row.deleted && !pending.has(row.id))
     adopted.set(row.id, { ...row, revision: row.revision + 1, deleted: true, encryptedValue: undefined });
    if ([...adopted.values()].filter(row => !row.deleted).length > MAX_ENTRIES) return fail('VAULT_LIMIT', 'Account metadata and pending device entries exceed this device limit. Existing data has been kept.', 413);
    for (const [id, row] of adopted) await tx.put(collections.records, id, row);
   });
   op.lease.assertCurrent(); return { complete: true as const };
  } finally { off(); }
 }
 /** Called only for an explicitly selected, freshly verified reveal response.
  * The response must identify the exact server snapshot; no bulk value API. */
 async retainSelectedValue(id: string, revision: number, response: { id: string; version: string; value: string }, signal?: AbortSignal) {
  if (this.scope.kind !== 'account') return fail('ACCOUNT_REQUIRED', 'Anonymous vaults do not retain account values.', 403);
  const op = this.operation(signal), rows = await this.rows(op), row = rows.find(row => row.id === id);
  if (!row || row.deleted || row.revision !== revision || response.id !== id || !validRemoteVersion(response.version) || row.remoteVersion !== response.version)
   return fail('VAULT_CONFLICT', 'This value belongs to a different account snapshot. Refresh and verify it again.');
  const value = validUserVaultValue(response.value); if (!value) return fail('VAULT_RESPONSE', 'The account returned an invalid selected value.', 502);
  const current = await this.decode(row, op); if (current.kind === 'group') return fail('VAULT_INPUT', 'Select a vault entry.', 400);
  const { remoteOnly: _remoteOnly, ...metadata } = current as Content & { remoteOnly?: true };
  const content = { ...metadata, ...(current.kind === 'secret' ? { value } : { token: value }) };
  const encryptedValue = await sealDeviceVaultValue(await this.context, op.key, id, JSON.stringify(content));
  await this.db.transaction(this.scope, 'readwrite', op.lease, async tx => {
   const latest = await tx.get<DeviceProviderRecord>(collections.records, id);
   const pending = (await tx.list<DeviceProviderCommand>(collections.commands)).some(item => item.value.recordId === id);
   if (pending || !latest || latest.revision !== revision || latest.remoteVersion !== response.version || latest.deleted)
    return fail('VAULT_CONFLICT', 'The vault changed before the selected value could be retained.');
   await tx.put(collections.records, id, { ...latest, revision: revision + 1, encryptedValue });
  });
  op.lease.assertCurrent();
 }
 /** Freeze an encrypted request before its first transmission. Later local
  * edits cannot change that request, and only its exact receipt advances the
  * account comparison token. Global sequence order preserves group dependencies. */
 async synchronize(transport: { write(command: UserVaultWrite, signal: AbortSignal): Promise<unknown> }, signal?: AbortSignal, now = Date.now) {
  if (this.scope.kind !== 'account') return fail('ACCOUNT_REQUIRED', 'Anonymous vaults never synchronize.', 403);
  const op = this.operation(signal, false), controller = new AbortController(), off = op.lease.onInvalidate(() => controller.abort());
  const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
  let completed = 0;
  try {
   for (let batch = 0; batch < 40; batch++) {
    op.lease.assertCurrent(); combined.throwIfAborted();
    const queued = await this.db.transaction(this.scope, 'readonly', op.lease, tx => tx.list<DeviceProviderCommand>(collections.commands));
    const ordered = queued.sort((a,b) => a.value.sequence - b.value.sequence);
    const seen = new Set<number>();
    for (const { id: key, value } of ordered) {
     if (!value || !safeVaultId(value.id) || !safeVaultId(value.recordId) || key !== `${value.recordId}:${value.id}` ||
      !revision(value.localRevision) || value.localRevision < 1 || !revision(value.sequence) || value.sequence < 1 || seen.has(value.sequence) ||
      !['pending','frozen','refused'].includes(value.state) || !value.encryptedValue ||
      (value.claim !== undefined && (typeof value.claim !== 'string' || !value.claim)) ||
      (value.claimUntil !== undefined && (!Number.isSafeInteger(value.claimUntil) || value.claimUntil < 0)) ||
      (value.retryAt !== undefined && (!Number.isSafeInteger(value.retryAt) || value.retryAt < 0)))
      return fail('VAULT_DAMAGED', 'The saved sync queue is invalid. Existing entries have been kept.', 422);
     seen.add(value.sequence);
    }
    const first = ordered[0]; if (!first) break;
    const saved = first.value, clock = now();
    if (saved.state === 'refused' || (saved.claimUntil ?? 0) > clock || (saved.retryAt ?? 0) > clock) break;
    const before = await this.db.transaction(this.scope, 'readonly', op.lease, tx => tx.get<DeviceProviderRecord>(collections.records, saved.recordId));
    if (!before) return fail('VAULT_DAMAGED', 'A queued vault entry is missing. Existing work has been kept.', 422);
    this.validateRow(saved.recordId, before);
    if (before.revision < saved.localRevision || before.remoteRevision >= saved.localRevision)
     return fail('VAULT_DAMAGED', 'The saved sync revision is invalid. Existing work has been kept.', 422);
    let command: UserVaultWrite;
    try {
     const raw = JSON.parse(await openDeviceVaultValue(await this.context, op.key, `command:${saved.recordId}:${saved.id}`, saved.encryptedValue));
     if (saved.state === 'pending') {
      const local = input(raw);
      if (local.id !== saved.recordId || local.writeId !== saved.id || local.revision + 1 !== saved.localRevision) throw Error();
      const { revision: _revision, ...wire } = local;
      command = parseUserVaultWrite({ ...wire, expectedVersion: before.remoteVersion ?? null });
     } else command = parseUserVaultWrite(raw);
     if (command.id !== saved.recordId || command.writeId !== saved.id) throw Error();
    } catch { op.lease.assertCurrent(); return fail('VAULT_DAMAGED', 'The encrypted sync request is invalid. Existing work has been kept.', 422); }
    const encryptedValue = saved.state === 'pending' ? await sealDeviceVaultValue(await this.context, op.key, `command:${saved.recordId}:${saved.id}`, JSON.stringify(command)) : saved.encryptedValue;
    const claim = crypto.randomUUID(), frozen: DeviceProviderCommand = { ...saved, state: 'frozen', encryptedValue, claim, claimUntil: clock + 60_000 };
    const claimed = await this.db.transaction(this.scope, 'readwrite', op.lease, async tx => {
     const current = await tx.get<DeviceProviderCommand>(collections.commands, first.id), record = await tx.get<DeviceProviderRecord>(collections.records, saved.recordId);
     if (JSON.stringify(current) !== JSON.stringify(saved) || JSON.stringify(record) !== JSON.stringify(before)) return false;
     await tx.put(collections.commands, first.id, frozen); return true;
    });
    if (!claimed) break;
    try {
     const response = await transport.write(command, combined);
     op.lease.assertCurrent(); combined.throwIfAborted();
     const receipt = parseUserVaultWriteAcknowledgment(response);
     if (receipt.id !== command.id || receipt.writeId !== command.writeId || receipt.action !== command.action || receipt.expectedVersion !== command.expectedVersion)
      throw new WorkspaceError('VAULT_RESPONSE', 'The account returned a different save receipt.', 502);
     const adopted = await this.db.transaction(this.scope, 'readwrite', op.lease, async tx => {
      const current = await tx.get<DeviceProviderCommand>(collections.commands, first.id), record = await tx.get<DeviceProviderRecord>(collections.records, saved.recordId);
      if (!current || current.claim !== claim) return false;
      if (!record || record.revision < saved.localRevision || record.remoteRevision !== before.remoteRevision || record.remoteVersion !== before.remoteVersion)
       return fail('VAULT_CONFLICT', 'The vault changed before the save receipt arrived. Existing work has been kept.');
      await tx.put(collections.records, saved.recordId, { ...record, remoteRevision: saved.localRevision, remoteVersion: receipt.resultVersion ?? undefined });
      await tx.delete(collections.commands, first.id); return true;
     });
     if (!adopted) break;
     completed++;
    } catch (error) {
     op.lease.assertCurrent(); combined.throwIfAborted();
     // Keep only a numeric disposition, never remote prose or credential data.
     const status = Number((error as any)?.status), refused = [400,403,404,409,410,413,422].includes(status);
     if ((error as any)?.code === 'WORKSPACE_CHANGED' || status === 401) throw error;
     const delay = Math.min(86_400_000, Math.max(60_000, Number((error as any)?.retryAfterMs) || 0));
     await this.db.transaction(this.scope, 'readwrite', op.lease, async tx => {
      const current = await tx.get<DeviceProviderCommand>(collections.commands, first.id);
      if (!current || current.claim !== claim) return;
      const { claim: _claim, claimUntil: _until, ...rest } = current;
      await tx.put(collections.commands, first.id, { ...rest, state: refused ? 'refused' : 'frozen', retryAt: now() + delay,
       ...(Number.isInteger(status) && status >= 400 && status <= 599 ? { status } : {}) });
     });
     break;
    }
   }
   return { completed };
  } finally { off(); }
 }

 async syncStatus() {
  this.check(); if (this.scope.kind === 'anonymous') return [];
  return this.db.transaction(this.scope, 'readonly', this.lease, async tx => (await tx.list<DeviceProviderCommand>(collections.commands)).map(({value}) => ({ id: value.id, recordId: value.recordId, state: value.state, sequence: value.sequence, status: value.status, retryAt: value.retryAt })).sort((a,b) => a.sequence - b.sequence));
 }
}
