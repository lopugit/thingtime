import { deviceVaultWriteDigest } from '../passwords/vaultCrypto';
import { validatePasswordFile } from '../passwords/fileCrypto';
import { forgetRetainedPasswordFile, retainDevicePasswordFile, PASSWORD_FILES, PASSWORD_FILE_COMMANDS, type FileRecord, type PasswordFileHost, type StoredFile } from './passwordFiles';
import type { PasswordFileTransport } from './passwordFileTransport.client';
import type { DevicePasswordCommand, DevicePasswordRecord } from './passwordVault';
import { WorkspaceError } from './storage';

const RECORDS = 'password-vault-records', COMMANDS = 'password-vault-commands';
const fail = (message: string, status = 502): never => { throw new WorkspaceError('PASSWORD_FILE_RETAIN', message, status); };
const validRemoteId = (id: unknown): id is string => typeof id === 'string' && /^att_[a-f0-9]{64}$/.test(id);

/** Retain real account files in the device vault, with the same frames/metadata
 * as local imports. Only a complete, validated traversal can remove old clean
 * generations; failures and concurrent local changes preserve saved content. */
export async function reconcilePasswordFiles(host: PasswordFileHost, transport: PasswordFileTransport, signal?: AbortSignal) {
  if (host.scope.kind !== 'account') return fail('Anonymous password files never synchronize.', 403);
  const op = host.operation(signal, false), controller = new AbortController();
  const off = op.lease.onInvalidate(() => controller.abort());
  const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
  let retained = 0;
  try {
    const parents = await host.db.transaction(host.scope, 'readonly', op.lease, async tx => {
      const pending = new Set((await tx.list<DevicePasswordCommand>(COMMANDS)).map(row => row.value.recordId));
      return (await tx.list<DevicePasswordRecord>(RECORDS)).map(row => row.value).filter(row => !row.deleted && row.remoteRevision > 0 && !pending.has(row.id));
    });
    for (let offset = 0; offset < parents.length; offset += 50) {
      const batch = new Map(parents.slice(offset, offset + 50).map(row => [row.id, row]));
      const baseline = await host.db.transaction(host.scope, 'readonly', op.lease, async tx =>
        (await tx.list<StoredFile>(PASSWORD_FILES)).map(row => row.value).filter((row): row is FileRecord => !row.deleted && !!row.remoteId && batch.has(row.entryId)));
      const seen = new Set<string>(); let cursor: string | undefined;
      do {
        op.lease.assertCurrent(); combined.throwIfAborted();
        const page = await transport.page([...batch.keys()], cursor, combined);
        op.lease.assertCurrent(); combined.throwIfAborted();
        if (!Array.isArray(page.files) || page.files.length > 50 || (page.nextCursor !== null && !validRemoteId(page.nextCursor))) fail('Invalid account file page.');
        let previous = cursor ?? '';
        for (const file of page.files) {
          if (!validRemoteId(file.id) || file.id <= previous || !file.entryId || !batch.has(file.entryId)) fail('Invalid account file reference.');
          previous = file.id;
          const metadata = validatePasswordFile(file.metadata), id = `${file.entryId}:${metadata.token}`;
          if (seen.has(id)) fail('Repeated account file identity.'); seen.add(id);
          const digest = await deviceVaultWriteDigest(op.key, id, JSON.stringify(metadata));
          const needsBytes = await host.db.transaction(host.scope, 'readonly', op.lease, async tx => {
            const parent = await tx.get<DevicePasswordRecord>(RECORDS, file.entryId!);
            if (parent?.deleted || parent?.revision !== batch.get(file.entryId!)!.revision || await tx.get(PASSWORD_FILE_COMMANDS, id) ||
              (await tx.list<DevicePasswordCommand>(COMMANDS)).some(row => row.value.recordId === file.entryId)) return false;
            const row = await tx.get<StoredFile>(PASSWORD_FILES, id);
            if (!row) return true;
            if (row.deleted === true) return false;
            if (row.remoteId !== file.id || row.metadataDigest !== digest) fail('The account changed immutable file metadata. Saved device bytes have been kept.');
            return false;
          });
          if (!needsBytes) continue;
          await transport.download(file.entryId!, file.id, async (opened, active) => {
            if (JSON.stringify(validatePasswordFile(opened.metadata)) !== JSON.stringify(metadata)) fail('The downloaded file metadata changed.');
            await retainDevicePasswordFile(host, { ...file, metadata }, batch.get(file.entryId!)!.revision, opened.stream, active);
          }, combined);
          op.lease.assertCurrent(); combined.throwIfAborted(); retained++;
        }
        if (page.nextCursor !== null && (!page.files.length || page.nextCursor !== previous)) fail('Invalid account file cursor.');
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      await host.db.transaction(host.scope, 'readwrite', op.lease, async tx => {
        const pending = new Set((await tx.list<DevicePasswordCommand>(COMMANDS)).map(row => row.value.recordId));
        for (const before of baseline) {
          if (seen.has(`${before.entryId}:${before.id}`) || pending.has(before.entryId)) continue;
          const parent = await tx.get<DevicePasswordRecord>(RECORDS, before.entryId);
          if (parent && !parent.deleted && parent.revision === batch.get(before.entryId)!.revision) await forgetRetainedPasswordFile(tx, before);
        }
      });
    }
    return { retained };
  } finally { controller.abort(); off(); }
}
