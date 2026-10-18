import { deviceVaultWriteDigest } from '../passwords/vaultCrypto';
import { sealDevicePasswordValue } from '../passwords/passwordValueCrypto';
import { validatePasswordFile } from '../passwords/fileCrypto';
import { forgetRetainedPasswordFile, retainDevicePasswordFile, PASSWORD_FILES, PASSWORD_FILE_COMMANDS, PASSWORD_FILE_CATALOG, type PasswordFileCatalog, type FileRecord, type PasswordFileHost, type StoredFile } from './passwordFiles';
import type { PasswordFileTransport } from './passwordFileTransport.client';
import type { DevicePasswordRecord } from './passwordVault';
import { WorkspaceError } from './storage';

const RECORDS = 'password-vault-records';
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
  let retained = 0, unavailable = 0;
  try {
    const parents = await host.db.transaction(host.scope, 'readonly', op.lease, async tx => {
      return (await tx.list<DevicePasswordRecord>(RECORDS)).map(row => row.value).filter(row => !row.deleted && row.remoteRevision > 0);
    });
    for (let offset = 0; offset < parents.length; offset += 50) {
      const pullToken = crypto.randomUUID();
      // The latest traversal for a parent wins across tabs. An older complete
      // page must not prune files just confirmed by a newer traversal.
      const batch = await host.db.transaction(host.scope, 'readwrite', op.lease, async tx => {
        const selected = new Map<string, DevicePasswordRecord>();
        for (const before of parents.slice(offset, offset + 50)) {
          const current = await tx.get<DevicePasswordRecord>(RECORDS, before.id);
          if (!current || current.deleted || current.revision !== before.revision) continue;
          await tx.put(RECORDS, before.id, { ...current, filePullToken: pullToken }); selected.set(before.id, current);
        }
        return selected;
      });
      if (!batch.size) continue;
      const baseline = await host.db.transaction(host.scope, 'readonly', op.lease, async tx =>
        (await tx.list<StoredFile>(PASSWORD_FILES)).map(row => row.value).filter((row): row is FileRecord => !row.deleted && !!row.remoteId && batch.has(row.entryId)));
      const catalogBefore = await host.db.transaction(host.scope, 'readonly', op.lease, tx => tx.list<PasswordFileCatalog>(PASSWORD_FILE_CATALOG));
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
          const encryptedValue = await sealDevicePasswordValue(await host.context, op.key, `file:${id}`, JSON.stringify(metadata));
          const needsBytes = await host.db.transaction(host.scope, 'readwrite', op.lease, async tx => {
            const parent = await tx.get<DevicePasswordRecord>(RECORDS, file.entryId!);
            if (parent?.deleted || parent?.revision !== batch.get(file.entryId!)!.revision || parent.filePullToken !== pullToken || await tx.get(PASSWORD_FILE_COMMANDS, id)) return false;
            const row = await tx.get<StoredFile>(PASSWORD_FILES, id);
            const known = await tx.get<PasswordFileCatalog>(PASSWORD_FILE_CATALOG, id);
            if (known && (known.remoteId !== file.id || known.metadataDigest !== digest)) fail('The account changed immutable file metadata. Saved device bytes have been kept.');
            await tx.put(PASSWORD_FILE_CATALOG, id, { entryId: file.entryId!, id: metadata.token, remoteId: file.id, metadataDigest: digest, encryptedValue } satisfies PasswordFileCatalog);
            if (!row) return true;
            if (row.deleted === true) return false;
            if (row.remoteId !== file.id || row.metadataDigest !== digest) fail('The account changed immutable file metadata. Saved device bytes have been kept.');
            return false;
          });
          if (!needsBytes) continue;
          try {
            await transport.download(file.entryId!, file.id, async (opened, active) => {
              if (JSON.stringify(validatePasswordFile(opened.metadata)) !== JSON.stringify(metadata)) fail('The downloaded file metadata changed.');
              await retainDevicePasswordFile(host, { ...file, metadata }, batch.get(file.entryId!)!.revision, opened.stream, active, pullToken);
            }, combined);
            op.lease.assertCurrent(); combined.throwIfAborted(); retained++;
          } catch {
            op.lease.assertCurrent(); combined.throwIfAborted();
            // Preserve encrypted metadata and continue retaining other files.
            // A missing/corrupt object must not hide or block the whole library.
            unavailable++;
          }
        }
        if (page.nextCursor !== null && (!page.files.length || page.nextCursor !== previous)) fail('Invalid account file cursor.');
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      await host.db.transaction(host.scope, 'readwrite', op.lease, async tx => {
          for (const before of baseline) {
          if (seen.has(`${before.entryId}:${before.id}`)) continue;
          const parent = await tx.get<DevicePasswordRecord>(RECORDS, before.entryId);
          if (parent && !parent.deleted && parent.revision === batch.get(before.entryId)!.revision && parent.filePullToken === pullToken) await forgetRetainedPasswordFile(tx, before);
        }
        for (const { id, value: before } of catalogBefore) {
          if (!batch.has(before.entryId) || seen.has(id)) continue;
          const parent = await tx.get<DevicePasswordRecord>(RECORDS, before.entryId), current = await tx.get<PasswordFileCatalog>(PASSWORD_FILE_CATALOG, id);
          if (parent && !parent.deleted && parent.revision === batch.get(before.entryId)!.revision && parent.filePullToken === pullToken && current?.remoteId === before.remoteId && current.metadataDigest === before.metadataDigest && !await tx.get(PASSWORD_FILE_COMMANDS, id)) await tx.delete(PASSWORD_FILE_CATALOG, id);
        }
        for (const before of batch.values()) {
          const current = await tx.get<DevicePasswordRecord>(RECORDS, before.id);
          if (current && !current.deleted && current.revision === before.revision && current.filePullToken === pullToken) await tx.put(RECORDS, before.id, { ...current, filesListed: true } satisfies DevicePasswordRecord);
        }
      });
    }
    return { retained, unavailable };
  } finally { controller.abort(); off(); }
}
