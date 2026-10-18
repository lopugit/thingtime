import { remotePasswordStorage } from '../passwords/fileTransfer';
import type { PasswordFile } from '../passwords/fileCrypto';
import type { SavedPasswordFile } from '../passwords/storage';
import { accountPasswordRequest } from './passwordTransport.client';
import { accountRemoteWorkspaceLease } from './runtime.client';
import { WorkspaceError, type WorkspaceLease, type WorkspaceScope } from './storage';

export type PasswordFileTransport = {
  page(entryIds: string[], cursor: string | undefined, signal: AbortSignal): Promise<{ files: SavedPasswordFile[]; nextCursor: string | null }>;
  locate(entryId: string, metadata: PasswordFile, signal: AbortSignal): Promise<string>;
  upload(entryId: string, metadata: PasswordFile, open: () => ReadableStream<Uint8Array>, started: (id: string) => Promise<void>, signal: AbortSignal): Promise<SavedPasswordFile>;
  download(entryId: string, fileId: string, consume: (file: { metadata: PasswordFile; stream: ReadableStream<Uint8Array> }, signal: AbortSignal) => Promise<void>, signal: AbortSignal): Promise<void>;
  remove(entryId: string, fileId: string, signal: AbortSignal): Promise<{ deferred: boolean }>;
};

/** One authority lease spans each entire transfer, including consumption of a
 * download stream. Signed object requests never carry account credentials. */
export function accountPasswordFileTransport(scope: Extract<WorkspaceScope, { kind: 'account' }>, lease: WorkspaceLease): PasswordFileTransport {
  const request = accountPasswordRequest(scope, lease, '1.1.0');
  async function authorized<T>(signal: AbortSignal, run: (signal: AbortSignal, check: () => void) => Promise<T>): Promise<T> {
    lease.assertCurrent(); const remote = accountRemoteWorkspaceLease(scope); remote.assertCurrent();
    const controller = new AbortController();
    const offRemote = remote.onInvalidate(() => controller.abort()), offLocal = lease.onInvalidate(() => controller.abort());
    const combined = AbortSignal.any([signal, controller.signal]);
    const check = () => {
      lease.assertCurrent(); remote.assertCurrent(); combined.throwIfAborted();
      if (window.location.origin !== scope.origin) throw new WorkspaceError('WORKSPACE_CHANGED', 'Account origin changed.', 409);
    };
    try { check(); const result = await run(combined, check); check(); return result; }
    finally { controller.abort(); offRemote(); offLocal(); }
  }
  const storage = (signal: AbortSignal, check: () => void, started?: (id: string) => Promise<void>) => remotePasswordStorage(
    async body => { check(); const result = await request(body, signal); check(); return result; },
    async (url, init) => {
      check(); const response = await fetch(url, { ...init, signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
      try { check(); return response; }
      catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
    },
    { onUploadStarted: async upload => {
      if (!upload || !/^att_[a-f0-9]{64}$/.test(upload.id)) throw new WorkspaceError('PASSWORD_FILE_RESPONSE', 'Invalid encrypted upload receipt.', 502);
      check(); await started?.(upload.id); check();
    } }
  );
  return {
    locate: (entryId, metadata, signal) => authorized(signal, async active => {
      // Replay the canonical idempotent start to recover an uncertain receipt.
      // No object bytes are sent, and normal upload permission still applies.
      const result = await request({ operation: 'file-start', entryId, metadata }, active);
      if (!/^att_[a-f0-9]{64}$/.test(result.upload?.id ?? '')) throw new WorkspaceError('PASSWORD_FILE_RESPONSE', 'Invalid encrypted upload receipt.', 502);
      return result.upload.id;
    }),
    page: (entryIds, cursor, signal) => authorized(signal, (active) => request({ operation: 'file-list', entryIds, ...(cursor ? { cursor } : {}) }, active)),
    upload: (entryId, metadata, open, started, signal) => authorized(signal, async (active, check) => {
      const file = await storage(active, check, started).uploadFile(entryId, metadata, open, active);
      // v1.1 complete returns id/metadata; the parent comes from the authorized
      // request. A later server adding a parent must agree with that request.
      if (file.entryId !== undefined && file.entryId !== entryId) throw new WorkspaceError('PASSWORD_FILE_RESPONSE', 'Invalid encrypted file parent.', 502);
      return { ...file, entryId };
    }),
    download: (entryId, fileId, consume, signal) => authorized(signal, async (active, check) => {
      const file = await storage(active, check).openFile(entryId, fileId, active); check();
      await consume(file, active); check();
    }),
    remove: (entryId, fileId, signal) => authorized(signal, async active => {
      const result = await request({ operation: 'file-delete', entryId, fileId }, active);
      if (typeof result.deferred !== 'boolean') throw new WorkspaceError('PASSWORD_FILE_RESPONSE', 'Invalid encrypted file deletion receipt.', 502);
      return { deferred: result.deferred };
    })
  };
}
