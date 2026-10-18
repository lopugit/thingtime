import { sha256 } from '@noble/hashes/sha2.js';
import { decryptPasswordFile, encryptPasswordFile, iterableStream, validatePasswordFile } from '../passwords/fileCrypto';
import { deviceVaultWriteDigest, openDeviceVaultValue, sealDeviceVaultValue, type DeviceVaultKey } from '../passwords/vaultCrypto';
import type { VaultEnvelope } from '../passwords/vaultEnvelopeContract';
import type { PasswordStorage, SavedPasswordFile } from '../passwords/storage';
import { validPasswordId } from '../passwords/model';
import type { DevicePasswordRecord } from './passwordVault';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';

export const PASSWORD_FILES = 'password-vault-files';
const FILES = PASSWORD_FILES, STAGING = 'password-vault-file-staging';
export const PASSWORD_FILE_COMMANDS = 'password-vault-file-commands';
const RECORDS = 'password-vault-records';
const STAGING_TTL = 24 * 60 * 60_000;
export type FileRecord = { entryId: string; id: string; generation: string; parts: number; encryptedValue: VaultEnvelope; metadataDigest: string; contentDigest: string; remoteId?: string; deleted?: false };
export type StoredFile = FileRecord | { entryId: string; id: string; remoteId?: string; deleted: true };
export type PasswordFileCommand = {
  id: string; entryId: string; fileId: string; operation: 'upload' | 'delete';
  encryptedValue: VaultEnvelope; remoteId?: string; state: 'pending' | 'frozen' | 'refused';
  claim?: { token: string; until: number }; attempts: number; retryAt: number; status?: number;
};
const isFile = (row: StoredFile): row is FileRecord => row.deleted !== true;
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
export function retainDevicePasswordFile(host: PasswordFileHost, file: SavedPasswordFile, parentRevision: number, stream: ReadableStream<Uint8Array>, signal: AbortSignal) {
  if (host.scope.kind !== 'account' || !file.entryId || !/^att_[a-f0-9]{64}$/.test(file.id)) return fail('Invalid account file reference.', 400);
  return passwordStorage(host, { remoteId: file.id, parentRevision }).uploadFile(file.entryId, file.metadata, () => stream, signal);
}

function passwordStorage(host: PasswordFileHost, retention?: { remoteId: string; parentRevision: number }): PasswordStorage {
  const { db, scope } = host;
  const decode = async (row: FileRecord, key: DeviceVaultKey, lease: WorkspaceLease): Promise<SavedPasswordFile> => {
    const plain = await openDeviceVaultValue(await host.context, key, `file:${fileKey(row.entryId, row.id)}`, row.encryptedValue);
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
    async listFiles(entryIds, signal, sourceIds = []) {
      const op = host.operation(signal, false), wanted = new Set([...entryIds, ...sourceIds]);
      for (const id of wanted) if (!validPasswordId(id)) fail('Invalid password entry.', 400);
      const rows = await db.transaction(scope, 'readonly', op.lease, async tx => {
        for (const id of wanted) await parent(tx, id);
        return (await tx.list<StoredFile>(FILES)).map(row => row.value).filter((row): row is FileRecord => isFile(row) && wanted.has(row.entryId));
      });
      const files = [];
      for (const row of rows) files.push(await decode(row, op.key, op.lease));
      return files;
    },
    async uploadFile(entryId, input, open, signal) {
      const metadata = validatePasswordFile(input), id = fileKey(entryId, metadata.token), op = host.operation(signal, !retention);
      const generation = crypto.randomUUID(), owner = await host.context, plain = JSON.stringify(metadata);
      const encryptedValue = await sealDeviceVaultValue(owner, op.key, `file:${id}`, plain);
      const metadataDigest = await deviceVaultWriteDigest(op.key, id, plain);
      const controller = new AbortController(), off = op.lease.onInvalidate(() => controller.abort());
      const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
      try {
        await db.transaction(scope, 'readwrite', op.lease, async tx => {
          await parent(tx, entryId);
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
            await parent(tx, entryId);
            await tx.putBytes(chunkKey(generation, part), bytes);
            await tx.put(STAGING, generation, { entryId, id: metadata.token, parts: part + 1, expires: Date.now() + STAGING_TTL } satisfies Stage);
          });
          parts++;
        }
        const contentDigest = Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('');
        await db.transaction(scope, 'readwrite', op.lease, async tx => {
          await parent(tx, entryId); const existing = await tx.get<StoredFile>(FILES, id);
          if (retention) {
            const entry = await tx.get<DevicePasswordRecord>(RECORDS, entryId);
            if (entry?.revision !== retention.parentRevision || await tx.get(PASSWORD_FILE_COMMANDS, id) ||
              (await tx.list<{ recordId: string }>('password-vault-commands')).some(row => row.value.recordId === entryId)) fail('The device entry changed while retaining its file.');
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
        op.lease.assertCurrent(); return { id: metadata.token, entryId, metadata };
      } finally {
        off();
        // Cleanup is key-free and only removes this operation's staging parts.
        // A retired workspace retains them for the next scoped expiry pass.
        await cleanup(generation).catch(() => {});
      }
    },
    async openFile(entryId, fileId, signal) {
      const id = fileKey(entryId, fileId), op = host.operation(signal, false);
      const row = await db.transaction(scope, 'readonly', op.lease, async tx => { await parent(tx, entryId); return tx.get<StoredFile>(FILES, id); });
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
          } else if (row && isFile(row) && row.remoteId) {
            await tx.put(PASSWORD_FILE_COMMANDS, id, { id, entryId, fileId, operation: 'delete', encryptedValue: row.encryptedValue,
              remoteId: row.remoteId, state: 'pending', attempts: 0, retryAt: 0 } satisfies PasswordFileCommand);
          }
        }
        // A delayed upload/retry must not resurrect a user's removal.
        await tx.put(FILES, id, { entryId, id: fileId, ...(row?.remoteId ? { remoteId: row.remoteId } : {}), deleted: true } satisfies StoredFile);
      });
    }
  };
}
