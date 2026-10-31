import { openDevicePasswordValue } from '../passwords/passwordValueCrypto';
import { validatePasswordFile } from '../passwords/fileCrypto';
import { devicePasswordStorage, PASSWORD_FILES, PASSWORD_FILE_COMMANDS, type PasswordFileCommand, type PasswordFileHost, type StoredFile } from './passwordFiles';
import type { PasswordFileTransport } from './passwordFileTransport.client';
import type { DevicePasswordCommand, DevicePasswordRecord } from './passwordVault';
import { WorkspaceError } from './storage';

const RECORDS = 'password-vault-records', COMMANDS = 'password-vault-commands';
const CLAIM_MS = 60_000;
const fail = (message: string, status = 409): never => { throw new WorkspaceError('PASSWORD_FILE_SYNC', message, status); };
const validRemoteId = (id: string) => /^att_[a-f0-9]{64}$/.test(id);

/** The upload queue is independent of local file completion and entry sync.
 * Parent admission and delete acknowledgements are checked only in this lane.
 * Metadata (including file keys/names) remains encrypted in every intent. */
export async function synchronizePasswordFiles(host: PasswordFileHost, transport: PasswordFileTransport, signal?: AbortSignal, now = () => Date.now()) {
  if (host.scope.kind !== 'account') return fail('Anonymous password files never synchronize.', 403);
  const op = host.operation(signal, false), controller = new AbortController();
  const off = op.lease.onInvalidate(() => controller.abort());
  const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
  const storage = devicePasswordStorage(host), attempted = new Set<string>();
  let completed = 0;
  try {
    // A scheduling batch, not a limit on the number of saved files.
    for (let count = 0; count < 20; count++) {
      op.lease.assertCurrent(); combined.throwIfAborted();
      const selected = await host.db.transaction(host.scope, 'readwrite', op.lease, async tx => {
        let cleaned = 0;
        const pendingParents = new Set((await tx.list<DevicePasswordCommand>(COMMANDS)).map(row => row.value.recordId));
        for (const { value } of await tx.list<PasswordFileCommand>(PASSWORD_FILE_COMMANDS)) {
          if ((value.claim?.until ?? 0) > now()) continue;
          const parent = await tx.get<DevicePasswordRecord>(RECORDS, value.entryId);
          if (!parent) fail('A queued file parent is missing. Its encrypted intent has been kept.', 422);
          if (pendingParents.has(value.entryId)) continue;
          if (parent!.deleted) {
            // Canonical entry deletion already acknowledged child cleanup.
            if (!parent!.remoteDeleted) continue;
            await tx.delete(PASSWORD_FILE_COMMANDS, value.id); cleaned++; continue;
          }
          if (attempted.has(value.id) || value.state === 'refused' || value.retryAt > now()) continue;
          if (!parent!.remoteRevision) continue;
          const next: PasswordFileCommand = { ...value, state: 'frozen', attempts: value.attempts + 1,
            claim: { token: crypto.randomUUID(), until: now() + CLAIM_MS } };
          await tx.put(PASSWORD_FILE_COMMANDS, next.id, next); return { item: next, cleaned };
        }
        return { item: null, cleaned };
      });
      completed += selected.cleaned; const item = selected.item;
      if (!item) break;
      attempted.add(item.id);
      const transfer = new AbortController(), active = AbortSignal.any([combined, transfer.signal]);
      let timer: ReturnType<typeof setTimeout> | undefined, renewal: Promise<void> | undefined, ended = false;
      const renew = () => {
        timer = setTimeout(() => {
          renewal = host.db.transaction(host.scope, 'readwrite', op.lease, async tx => {
            active.throwIfAborted(); const current = await tx.get<PasswordFileCommand>(PASSWORD_FILE_COMMANDS, item.id);
            if (current?.claim?.token !== item.claim!.token) fail('The file transfer belongs to another worker.');
            await tx.put(PASSWORD_FILE_COMMANDS, item.id, { ...current, claim: { ...current.claim, until: now() + CLAIM_MS } });
          }).then(() => { if (!ended) renew(); }, () => { transfer.abort(); });
        }, CLAIM_MS / 3);
      };
      renew();
      let stream: ReadableStream<Uint8Array> | undefined;
      const remember = async (remoteId: string) => {
        if (!validRemoteId(remoteId)) fail('Invalid encrypted file receipt.', 502);
        return host.db.transaction(host.scope, 'readwrite', op.lease, async tx => {
          active.throwIfAborted(); const current = await tx.get<PasswordFileCommand>(PASSWORD_FILE_COMMANDS, item.id);
          if (current?.claim?.token !== item.claim!.token) fail('The file transfer belongs to another worker.');
          if (current.remoteId && current.remoteId !== remoteId) fail('The account changed the file identity. Its retry has been kept.', 502);
          await tx.put(PASSWORD_FILE_COMMANDS, item.id, { ...current, remoteId });
          return current.operation;
        });
      };
      try {
        const plain = await openDevicePasswordValue(await host.context, op.key, `file:${item.id}`, item.encryptedValue);
        const metadata = validatePasswordFile(JSON.parse(plain));
        if (metadata.token !== item.fileId) fail('Encrypted file metadata is damaged.', 422);
        op.lease.assertCurrent(); active.throwIfAborted();
        if (item.operation === 'upload') {
          const file = await storage.openFile(item.entryId, item.fileId, active); stream = file.stream;
          const receipt = await transport.upload(item.entryId, metadata, () => file.stream, async remoteId => {
            if (await remember(remoteId) !== 'upload') fail('The file was removed while its upload was starting.');
          }, active);
          op.lease.assertCurrent(); active.throwIfAborted();
          if (receipt.entryId !== item.entryId || !validRemoteId(receipt.id) || JSON.stringify(validatePasswordFile(receipt.metadata)) !== JSON.stringify(metadata)) fail('Invalid encrypted file receipt.', 502);
          const accepted = await host.db.transaction(host.scope, 'readwrite', op.lease, async tx => {
            const current = await tx.get<PasswordFileCommand>(PASSWORD_FILE_COMMANDS, item.id);
            if (current?.claim?.token !== item.claim!.token) return false;
            if (current.remoteId !== receipt.id) fail('The account changed the file identity. Its retry has been kept.', 502);
            const row = await tx.get<StoredFile>(PASSWORD_FILES, item.id), parent = await tx.get<DevicePasswordRecord>(RECORDS, item.entryId);
            if (current.operation === 'delete' || !row || row.deleted || parent?.deleted) {
              await tx.put(PASSWORD_FILE_COMMANDS, item.id, { ...current, operation: 'delete', state: 'pending', claim: undefined, retryAt: 0 });
              return false;
            }
            await tx.put(PASSWORD_FILES, item.id, { ...row, remoteId: receipt.id });
            await tx.delete(PASSWORD_FILE_COMMANDS, item.id); return true;
          });
          if (accepted) completed++;
        } else {
          const remoteId = item.remoteId ?? await transport.locate(item.entryId, metadata, active);
          await remember(remoteId);
          const result = await transport.remove(item.entryId, remoteId, active);
          op.lease.assertCurrent(); active.throwIfAborted();
          if (result.deferred !== false) fail('Account file cleanup is still pending.', 503);
          const accepted = await host.db.transaction(host.scope, 'readwrite', op.lease, async tx => {
            const current = await tx.get<PasswordFileCommand>(PASSWORD_FILE_COMMANDS, item.id);
            if (current?.claim?.token !== item.claim!.token) return false;
            await tx.delete(PASSWORD_FILE_COMMANDS, item.id); return true;
          });
          if (accepted) completed++;
        }
      } catch (error) {
        op.lease.assertCurrent(); active.throwIfAborted();
        const status = Number((error as { status?: number })?.status) || 0;
        const refused = status >= 400 && status < 500 && ![408, 429].includes(status);
        await host.db.transaction(host.scope, 'readwrite', op.lease, async tx => {
          const current = await tx.get<PasswordFileCommand>(PASSWORD_FILE_COMMANDS, item.id);
          if (current?.claim?.token !== item.claim!.token) return;
          const removed = item.operation === 'upload' && current.operation === 'delete';
          const retry = Math.max(1000, Math.min(86_400_000, Number((error as { retryAfterMs?: number })?.retryAfterMs) || 1000 * 2 ** Math.min(item.attempts, 6)));
          await tx.put(PASSWORD_FILE_COMMANDS, item.id, { ...current, claim: undefined,
            state: removed ? 'pending' : refused ? 'refused' : 'frozen', status: removed ? undefined : status,
            retryAt: removed || refused ? 0 : now() + retry });
        });
      } finally {
        ended = true; clearTimeout(timer); transfer.abort(); await renewal;
        if (stream && !stream.locked) await stream.cancel().catch(() => {});
        // Releasing a claim needs no key. Locking must not strand a transfer
        // until lease expiry, nor erase its uncertain remote identity.
        await host.db.transaction(host.scope, 'readwrite', host.lease, async tx => {
          const current = await tx.get<PasswordFileCommand>(PASSWORD_FILE_COMMANDS, item.id);
          if (current?.claim?.token === item.claim!.token) await tx.put(PASSWORD_FILE_COMMANDS, item.id, { ...current, claim: undefined });
        }).catch(() => {});
      }
    }
    return { completed };
  } finally { controller.abort(); off(); }
}

export async function passwordFileSyncStatus(host: PasswordFileHost) {
  host.lease.assertCurrent(); if (host.scope.kind !== 'account') return [];
  return host.db.transaction(host.scope, 'readonly', host.lease, async tx => (await tx.list<PasswordFileCommand>(PASSWORD_FILE_COMMANDS)).map(({ value }) => ({
    id: value.id, entryId: value.entryId, fileId: value.fileId, operation: value.operation, state: value.state, status: value.status, retryAt: value.retryAt
  })));
}

/** Explicit retry changes scheduling only, never the immutable upload identity
 * or cleanup receipt. It cannot acquire account authority or replace bytes. */
export async function retryPasswordFileSync(host: PasswordFileHost, id: string) {
  if (host.scope.kind !== 'account') return fail('Anonymous password files never synchronize.', 403);
  const op = host.operation();
  await host.db.transaction(host.scope, 'readwrite', op.lease, async tx => {
    const current = await tx.get<PasswordFileCommand>(PASSWORD_FILE_COMMANDS, id);
    if (!current) return;
    if ((current.claim?.until ?? 0) > Date.now()) return;
    await tx.put(PASSWORD_FILE_COMMANDS, id, { ...current, state: current.attempts ? 'frozen' : 'pending', retryAt: 0, status: undefined } satisfies PasswordFileCommand);
  });
}
