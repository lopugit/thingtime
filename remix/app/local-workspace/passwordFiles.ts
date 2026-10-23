import { sha256 } from '@noble/hashes/sha2.js';
import { decryptPasswordFile, encryptPasswordFile, iterableStream, newPasswordFile, validatePasswordFile } from '../passwords/fileCrypto';
import { deviceVaultWriteDigest, type DeviceVaultKey } from '../passwords/vaultCrypto';
import { openDevicePasswordValue, sealDevicePasswordValue } from '../passwords/passwordValueCrypto';
import type { VaultEnvelope } from '../passwords/vaultEnvelopeContract';
import type { PasswordStorage, SavedPasswordFile } from '../passwords/storage';
import { validPasswordId } from '../passwords/model';
import type { DevicePasswordRecord } from './passwordVault';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';

export const PASSWORD_FILES = 'password-vault-files';
const FILES = PASSWORD_FILES, STAGING = 'password-vault-file-staging';
export const PASSWORD_FILE_COMMANDS = 'password-vault-file-commands';
export const PASSWORD_FILE_CATALOG = 'password-vault-file-catalog';
const RECORDS = 'password-vault-records';
const STAGING_TTL = 24 * 60 * 60_000;
export type FileRecord = { entryId: string; id: string; generation: string; parts: number; encryptedValue: VaultEnvelope; metadataDigest: string; contentDigest: string; remoteId?: string; deleted?: false };
export type StoredFile = FileRecord | { entryId: string; id: string; remoteId?: string; deleted: true };
export type PasswordFileCatalog = Pick<FileRecord, 'entryId' | 'id' | 'encryptedValue' | 'metadataDigest'> & { remoteId: string };
export type PasswordFileCommand = {
  id: string; entryId: string; fileId: string; operation: 'upload' | 'delete';
  encryptedValue: VaultEnvelope; remoteId?: string; state: 'pending' | 'frozen' | 'refused';
  claim?: { token: string; until: number }; attempts: number; retryAt: number; status?: number;
};
const isFile = (row: StoredFile): row is FileRecord => row.deleted !== true;
/** User-visible file state; acknowledgements do not invalidate a review. */
export async function passwordFileSnapshot(tx: WorkspaceTransaction, entryIds: ReadonlySet<string>) {
  return JSON.stringify([
    (await tx.list<StoredFile>(FILES)).filter(row => entryIds.has(row.value.entryId))
      .map(row => [row.id, row.value.deleted === true ? 'deleted' : row.value.generation]).sort((a, b) => a[0].localeCompare(b[0])),
    (await tx.list<PasswordFileCatalog>(PASSWORD_FILE_CATALOG)).filter(row => entryIds.has(row.value.entryId))
      .map(row => [row.id, row.value.remoteId, row.value.metadataDigest]).sort((a, b) => a[0].localeCompare(b[0]))
  ]);
}
async function filesStatus(tx: WorkspaceTransaction, scope: WorkspaceScope, entryId: string) {
  await parent(tx, entryId);
  const entry = (await tx.get<DevicePasswordRecord>(RECORDS, entryId))!;
  let unavailable = 0;
  for (const { id, value } of await tx.list<PasswordFileCatalog>(PASSWORD_FILE_CATALOG)) {
    if (value.entryId === entryId && !await tx.get(FILES, id)) unavailable++;
  }
  return { listed: scope.kind === 'anonymous' || !entry.remoteRevision || entry.filesListed === true, unavailable };
}
export async function assertPasswordFilesAvailable(tx: WorkspaceTransaction, scope: WorkspaceScope, entryIds: Iterable<string>) {
  const wanted = new Set(entryIds);
  const unavailable = () => { throw new WorkspaceError('PASSWORD_FILES_UNAVAILABLE', 'Some account attachments are not available on this device. Refresh account files before exporting or copying this entry.', 409); };
  for (const id of wanted) {
    await parent(tx, id); const entry = (await tx.get<DevicePasswordRecord>(RECORDS, id))!;
    if (scope.kind === 'account' && entry.remoteRevision && !entry.filesListed) unavailable();
  }
  for (const { id, value } of await tx.list<PasswordFileCatalog>(PASSWORD_FILE_CATALOG))
    if (wanted.has(value.entryId) && !await tx.get(FILES, id)) unavailable();
}
type Stage = { entryId: string; id: string; parts: number; expires: number };
export type PasswordFileHost = { db: WorkspaceDatabase; scope: WorkspaceScope; lease: WorkspaceLease; context: Promise<string>;
  operation(signal?: AbortSignal, touch?: boolean): { key: DeviceVaultKey; lease: WorkspaceLease };
  exportPage: PasswordStorage['exportPage']; };
const fail = (message: string, status = 409): never => { throw new WorkspaceError('PASSWORD_FILE', message, status); };
const fileKey = (entryId: string, fileId: string) => {
  if (!validPasswordId(entryId) || !validPasswordId(fileId)) fail('Invalid password file reference.', 400);
  return `${entryId}:${fileId}`;
};
const chunkKey = (generation: string, part: number) => `password-file:${generation}:${part}`;
async function parent(tx: WorkspaceTransaction, entryId: string) {
  const entry = await tx.get<{ deleted?: boolean }>(RECORDS, entryId);
  if (!entry || entry.deleted) fail('Password entry not found.', 404);
}
async function removeChunks(tx: WorkspaceTransaction, generation: string, parts: number) {
  for (let part = 0; part < parts; part++) await tx.deleteBytes(chunkKey(generation, part));
}
/** Remove only the unchanged, clean retained generation from a completed pull.
 * This is not a user tombstone: a later account snapshot may retain it again. */
export async function forgetRetainedPasswordFile(tx: WorkspaceTransaction, before: FileRecord) {
  const id = fileKey(before.entryId, before.id), current = await tx.get<StoredFile>(FILES, id);
  if (!current || !isFile(current) || !before.remoteId || current.remoteId !== before.remoteId || current.generation !== before.generation || await tx.get(PASSWORD_FILE_COMMANDS, id)) return;
  await removeChunks(tx, current.generation, current.parts); await tx.delete(FILES, id);
}
/** Called in the same transaction as an entry tombstone. No file keys or names
 * are needed to remove its ciphertext. In-flight upload commits check parent. */
export async function removeDevicePasswordFiles(tx: WorkspaceTransaction, entryId: string) {
  for (const row of await tx.list<PasswordFileCatalog>(PASSWORD_FILE_CATALOG)) if (row.value.entryId === entryId) await tx.delete(PASSWORD_FILE_CATALOG, row.id);
  for (const row of await tx.list<StoredFile>(FILES)) if (row.value.entryId === entryId) {
    if (isFile(row.value)) await removeChunks(tx, row.value.generation, row.value.parts);
    await tx.delete(FILES, row.id);
  }
  // Account entry deletion owns remote child cleanup. Keep uncertain file
  // intents until that independent entry queue acknowledges deletion.
  for (const row of await tx.list<PasswordFileCommand>(PASSWORD_FILE_COMMANDS)) if (row.value.entryId === entryId) {
    await tx.put(PASSWORD_FILE_COMMANDS, row.id, { ...row.value, operation: 'delete' });
  }
}

/** Entry conflict review discards only that entry's local file edits. Clean
 * account files remain; uncertain uploads/deletions keep their cleanup intent. */
export async function discardDevicePasswordFileEdits(tx: WorkspaceTransaction, entryId: string) {
  for (const { id, value } of await tx.list<PasswordFileCommand>(PASSWORD_FILE_COMMANDS)) {
    if (value.entryId !== entryId) continue;
    if (value.operation === 'delete' && !value.attempts && !value.claim) {
      await tx.delete(PASSWORD_FILE_COMMANDS, id); await tx.delete(FILES, id); continue;
    }
    if (value.operation === 'upload') {
      const row = await tx.get<StoredFile>(FILES, id);
      if (row && isFile(row)) await removeChunks(tx, row.generation, row.parts);
      await tx.put(FILES, id, { entryId, id: value.fileId, deleted: true } satisfies StoredFile);
      if (!value.attempts && !value.remoteId && !value.claim) { await tx.delete(PASSWORD_FILE_COMMANDS, id); continue; }
    }
    await tx.put(PASSWORD_FILE_COMMANDS, id, { ...value, operation: 'delete', state: 'pending', retryAt: 0, status: undefined } satisfies PasswordFileCommand);
  }
}

/** Anonymous vault adapter: canonical file frames, encrypted metadata, streaming
 * IDB parts and atomic visibility. Account queues use a separate authority lane;
 * this adapter cannot acquire account credentials or silently choose HTTP. */
export function anonymousPasswordStorage(host: PasswordFileHost): PasswordStorage {
  if (host.scope.kind !== 'anonymous') fail('Select an anonymous device vault.', 403);
  return devicePasswordStorage(host);
}

/** Local completion is identical for anonymous/account scopes. Only account
 * writes add encrypted sync intents, in the same IDB transaction as the file. */
export function devicePasswordStorage(host: PasswordFileHost): PasswordStorage {
  return passwordStorage(host);
}

/** Only the fenced account downloader can supply remote provenance. The same
 * canonical chunk writer commits retained bytes without an upload intent. */
export function retainDevicePasswordFile(host: PasswordFileHost, file: SavedPasswordFile, parentRevision: number, stream: ReadableStream<Uint8Array>, signal: AbortSignal, pullToken?: string) {
  if (host.scope.kind !== 'account' || !file.entryId || !/^att_[a-f0-9]{64}$/.test(file.id)) return fail('Invalid account file reference.', 400);
  return passwordStorage(host, { remoteId: file.id, parentRevision, pullToken }).uploadFile(file.entryId, file.metadata, () => stream, signal);
}

type PreparedFileTarget = { sourceEntryId: string; accept(file: FileRecord): void };
function passwordStorage(host: PasswordFileHost, retention?: { remoteId: string; parentRevision: number; pullToken?: string }, preparation?: PreparedFileTarget): PasswordStorage {
  const { db, scope } = host;
  const decode = async (row: Pick<FileRecord, 'entryId' | 'id' | 'encryptedValue'>, key: DeviceVaultKey, lease: WorkspaceLease): Promise<SavedPasswordFile> => {
    const plain = await openDevicePasswordValue(await host.context, key, `file:${fileKey(row.entryId, row.id)}`, row.encryptedValue);
    lease.assertCurrent(); const metadata = validatePasswordFile(JSON.parse(plain));
    if (metadata.token !== row.id) fail('Encrypted file metadata is damaged.', 422);
    return { id: row.id, entryId: row.entryId, metadata };
  };
  const cleanup = (generation: string) => db.transaction(scope, 'readwrite', host.lease, async tx => {
    const stage = await tx.get<Stage>(STAGING, generation); if (!stage) return;
    await removeChunks(tx, generation, stage.parts); await tx.delete(STAGING, generation);
  });
  return {
    exportPage: host.exportPage,
    filesStatus(entryId, signal) {
      const op = host.operation(signal, false);
      return db.transaction(scope, 'readonly', op.lease, tx => filesStatus(tx, scope, entryId));
    },
    assertFilesAvailable(entryIds, signal) {
      const op = host.operation(signal, false);
      return db.transaction(scope, 'readonly', op.lease, tx => assertPasswordFilesAvailable(tx, scope, entryIds));
    },
    async listFiles(entryIds, signal, sourceIds = []) {
      const op = host.operation(signal, false), wanted = new Set([...entryIds, ...sourceIds]);
      for (const id of wanted) if (!validPasswordId(id)) fail('Invalid password entry.', 400);
      const rows = await db.transaction(scope, 'readonly', op.lease, async tx => {
        for (const id of wanted) await parent(tx, id);
        const local = new Map((await tx.list<StoredFile>(FILES)).map(row => [row.id, row.value]));
        const saved = [...local.values()].filter((row): row is FileRecord => isFile(row) && wanted.has(row.entryId));
        const missing = (await tx.list<PasswordFileCatalog>(PASSWORD_FILE_CATALOG)).filter(row => wanted.has(row.value.entryId) && !local.has(row.id)).map(row => row.value);
        return { saved, missing };
      });
      const files = [];
      for (const row of rows.saved) files.push(await decode(row, op.key, op.lease));
      for (const row of rows.missing) files.push({ ...await decode(row, op.key, op.lease), available: false });
      return files;
    },
    async uploadFile(entryId, input, open, signal) {
      const metadata = validatePasswordFile(input), id = fileKey(entryId, metadata.token), op = host.operation(signal, !retention && !preparation);
      const generation = crypto.randomUUID(), owner = await host.context, plain = JSON.stringify(metadata);
      const encryptedValue = await sealDevicePasswordValue(owner, op.key, `file:${id}`, plain);
      const metadataDigest = await deviceVaultWriteDigest(op.key, id, plain);
      const controller = new AbortController(), off = op.lease.onInvalidate(() => controller.abort());
      const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
      let prepared: FileRecord | undefined, handedOff = false;
      const checkParent = (tx: WorkspaceTransaction) => parent(tx, preparation?.sourceEntryId ?? entryId);
      try {
        await db.transaction(scope, 'readwrite', op.lease, async tx => {
          await checkParent(tx);
          // Only abandoned staging generations expire; completed files never do.
          for (const row of await tx.list<Stage>(STAGING)) if (row.value.expires < Date.now()) {
            await removeChunks(tx, row.id, row.value.parts); await tx.delete(STAGING, row.id);
          }
          await tx.put(STAGING, generation, { entryId, id: metadata.token, parts: 0, expires: Date.now() + STAGING_TTL } satisfies Stage);
        });
        const hash = sha256.create(); let parts = 0;
        for await (const bytes of encryptPasswordFile(open(), metadata, combined)) {
          op.lease.assertCurrent(); hash.update(bytes);
          const part = parts;
          await db.transaction(scope, 'readwrite', op.lease, async tx => {
            await checkParent(tx);
            await tx.putBytes(chunkKey(generation, part), bytes);
            await tx.put(STAGING, generation, { entryId, id: metadata.token, parts: part + 1, expires: Date.now() + STAGING_TTL } satisfies Stage);
          });
          parts++;
        }
        const contentDigest = Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('');
        await db.transaction(scope, 'readwrite', op.lease, async tx => {
          await checkParent(tx); const existing = await tx.get<StoredFile>(FILES, id);
          if (preparation) {
            if (existing) fail('The destination file already exists.');
            prepared = { entryId, id: metadata.token, generation, parts, encryptedValue, metadataDigest, contentDigest };
            return;
          }
          if (retention) {
            const entry = await tx.get<DevicePasswordRecord>(RECORDS, entryId);
            if (entry?.revision !== retention.parentRevision || (retention.pullToken && entry.filePullToken !== retention.pullToken) || await tx.get(PASSWORD_FILE_COMMANDS, id)) fail('The device entry changed while retaining its file.');
            if (existing && !existing.deleted && existing.remoteId !== retention.remoteId) fail('The device file changed while retaining its account copy.');
          }
          if (existing) {
            if (!isFile(existing)) return fail('This password file was removed. Add it again as a new attachment.', 410);
            if (existing.metadataDigest !== metadataDigest || existing.contentDigest !== contentDigest) fail('This file id was already used for different content.');
            await removeChunks(tx, generation, parts);
          } else {
            await tx.put(FILES, id, { entryId, id: metadata.token, generation, parts, encryptedValue, metadataDigest, contentDigest,
              ...(retention ? { remoteId: retention.remoteId } : {}) } satisfies FileRecord);
            if (scope.kind === 'account' && !retention) await tx.put(PASSWORD_FILE_COMMANDS, id, {
              id, entryId, fileId: metadata.token, operation: 'upload', encryptedValue, state: 'pending', attempts: 0, retryAt: 0
            } satisfies PasswordFileCommand);
          }
          await tx.delete(STAGING, generation);
        });
        op.lease.assertCurrent();
        if (preparation && prepared) { preparation.accept(prepared); handedOff = true; }
        return { id: metadata.token, entryId, metadata };
      } finally {
        off();
        // Cleanup is key-free and only removes this operation's staging parts.
        // A retired workspace retains them for the next scoped expiry pass.
        if (!handedOff) await cleanup(generation).catch(() => {});
      }
    },
    async openFile(entryId, fileId, signal) {
      const id = fileKey(entryId, fileId), op = host.operation(signal, false);
      const row = await db.transaction(scope, 'readonly', op.lease, async tx => { await parent(tx, entryId); return tx.get<StoredFile>(FILES, id); });
      if (!row) {
        const known = await db.transaction(scope, 'readonly', op.lease, tx => tx.get(PASSWORD_FILE_CATALOG, id));
        if (known) return fail('This account attachment is not available offline yet. Refresh account files to download it.', 409);
      }
      if (!row || !isFile(row)) return fail('Password file not found.', 404);
      const file: FileRecord = row;
      const { metadata } = await decode(file, op.key, op.lease);
      async function* encrypted() {
        for (let part = 0; part < file.parts; part++) {
          const bytes = await db.transaction(scope, 'readonly', op.lease, async tx => {
            await parent(tx, entryId); const current = await tx.get<StoredFile>(FILES, id);
            if (!current || !isFile(current) || current.generation !== file.generation) fail('The password file was removed.', 410);
            return tx.getBytes(chunkKey(file.generation, part));
          });
          if (!bytes) fail('Encrypted file data is missing. Its metadata has been kept.', 422);
          op.lease.assertCurrent(); yield bytes!;
        }
      }
      async function* decrypted() {
        for await (const bytes of decryptPasswordFile(iterableStream(encrypted()), metadata, signal)) {
          op.lease.assertCurrent(); yield bytes;
        }
      }
      return { metadata, stream: iterableStream(decrypted(), { highWaterMark: 0 }) };
    },
    async removeFile(entryId, fileId, signal) {
      const id = fileKey(entryId, fileId), op = host.operation(signal);
      await db.transaction(scope, 'readwrite', op.lease, async tx => {
        await parent(tx, entryId); const row = await tx.get<StoredFile>(FILES, id);
        if (row && isFile(row)) await removeChunks(tx, row.generation, row.parts);
        if (scope.kind === 'account') {
          const pending = await tx.get<PasswordFileCommand>(PASSWORD_FILE_COMMANDS, id);
          if (pending) {
            if (!pending.attempts && !pending.remoteId && !pending.claim) await tx.delete(PASSWORD_FILE_COMMANDS, id);
            else await tx.put(PASSWORD_FILE_COMMANDS, id, { ...pending, operation: 'delete' } satisfies PasswordFileCommand);
          } else {
            const remote = row && isFile(row) && row.remoteId ? row : await tx.get<PasswordFileCatalog>(PASSWORD_FILE_CATALOG, id);
            if (remote?.remoteId) await tx.put(PASSWORD_FILE_COMMANDS, id, { id, entryId, fileId, operation: 'delete', encryptedValue: remote.encryptedValue,
              remoteId: remote.remoteId, state: 'pending', attempts: 0, retryAt: 0 } satisfies PasswordFileCommand);
          }
        }
        // A delayed upload/retry must not resurrect a user's removal.
        await tx.put(FILES, id, { entryId, id: fileId, ...(row?.remoteId ? { remoteId: row.remoteId } : {}), deleted: true } satisfies StoredFile);
      });
    }
  };
}

/** Re-encrypt independent copies through the normal chunk writer. Until the
 * caller atomically commits its new parent entries, these are invisible staged
 * generations, not partially created entries or downloadable files. */
export async function prepareDevicePasswordFileCopies(host: PasswordFileHost, mapping: ReadonlyMap<string, string>, signal?: AbortSignal) {
  const op = host.operation(signal, false), prepared: FileRecord[] = [], storage = devicePasswordStorage(host);
  for (const [source, target] of mapping) if (!validPasswordId(source) || !validPasswordId(target) || mapping.has(target)) fail('Invalid password copy identity.', 400);
  if (new Set(mapping.values()).size !== mapping.size) fail('Password copies need independent identities.', 400);
  const snapshot = (rows: { id: string; value: StoredFile }[]) => rows.filter(row => mapping.has(row.value.entryId))
    .map(row => [row.id, row.value.deleted === true ? 'deleted' : row.value.generation]).sort((a, b) => a[0].localeCompare(b[0]));
  const baseline = await host.db.transaction(host.scope, 'readonly', op.lease, tx => tx.list<StoredFile>(FILES));
  await host.db.transaction(host.scope, 'readonly', op.lease, tx => assertPasswordFilesAvailable(tx, host.scope, mapping.keys()));
  const expected = JSON.stringify(snapshot(baseline));
  const discard = () => host.db.transaction(host.scope, 'readwrite', host.lease, async tx => {
    for (const row of prepared) {
      const stage = await tx.get<Stage>(STAGING, row.generation); if (!stage) continue;
      await removeChunks(tx, row.generation, stage.parts); await tx.delete(STAGING, row.generation);
    }
  });
  try {
    for (const { value: row } of baseline) {
      if (!mapping.has(row.entryId) || !isFile(row)) continue;
      const opened = await storage.openFile(row.entryId, row.id, signal);
      const metadata = { ...opened.metadata, ...newPasswordFile(opened.metadata.name, opened.metadata.size) };
      try {
        await passwordStorage(host, undefined, { sourceEntryId: row.entryId, accept: record => { prepared.push(record); } })
          .uploadFile(mapping.get(row.entryId)!, metadata, () => opened.stream, signal);
      } finally { if (!opened.stream.locked) await opened.stream.cancel().catch(() => {}); }
    }
    return {
      async commit(tx: WorkspaceTransaction) {
        op.lease.assertCurrent();
        await assertPasswordFilesAvailable(tx, host.scope, mapping.keys());
        if (JSON.stringify(snapshot(await tx.list<StoredFile>(FILES))) !== expected) fail('Password attachments changed while copying. Review the entry again.');
        for (const row of prepared) {
          await parent(tx, row.entryId); const id = fileKey(row.entryId, row.id);
          if (await tx.get(FILES, id) || !await tx.get(STAGING, row.generation)) fail('The prepared password copy changed. Review it again.');
          await tx.put(FILES, id, row);
          if (host.scope.kind === 'account') await tx.put(PASSWORD_FILE_COMMANDS, id, { id, entryId: row.entryId, fileId: row.id,
            operation: 'upload', encryptedValue: row.encryptedValue, state: 'pending', attempts: 0, retryAt: 0 } satisfies PasswordFileCommand);
          await tx.delete(STAGING, row.generation);
        }
      },
      discard
    };
  } catch (error) { await discard().catch(() => {}); throw error; }
}
