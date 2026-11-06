import { constants } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSyncTransferDeadline } from '../../../fileSync/syncTransferDeadline';
import { sameSyncScope } from '../../../fileSync/reconcile';
import { backupJson } from '../../../backups/manifest';
import { createHash } from 'node:crypto';
import { stageCloudFileBytes, cloudRequests, type CloudTransportRuntime } from '../../../fileSync/cloudTransport';
import type { FingerprintSource } from '../../../fileSync/contentFingerprint';
import type { BackupAccess, BackupObjectStore } from './portableBackup';
import { openAccountBackupFile, openAccountBackupFileVersion } from './accountFileRecovery';
import type { AccountFileRestoreStage } from './accountFileRestore';

/** Worker-only protected temporary staging. The backup iterator must finish its
 * full fingerprint verification before any upload is started. Uploads use the
 * normal origin/actor, upload approval, multipart and stored-integrity contract;
 * no signed target, token or source credential is persisted in restore state. */
export function createAccountFileRestoreStager(
 store: BackupObjectStore, snapshotId: string, access: BackupAccess,
 runtime: CloudTransportRuntime, signal?: AbortSignal, options: { temporaryDirectory?: string } = {}
): AccountFileRestoreStage {
 const workerSignal = signal, pinnedScope = structuredClone(runtime.currentScope());
 return async input => {
  const signal = AbortSignal.any([...(input.signal ? [input.signal] : []), ...(workerSignal ? [workerSignal] : []), ...(access.signal ? [access.signal] : [])]);
  const scope = pinnedScope;
  if (input.destinationScope.ownerId !== scope.ownerId || input.destinationScope.apiOrigin !== scope.origin || input.destinationScope.dataPlane !== scope.dataPlane) throw Error('Restore destination account changed');
  const check = async () => { signal?.throwIfAborted(); if (runtime.origin() !== scope.origin || !sameSyncScope(scope, runtime.currentScope())) throw Error('Restore account changed'); await access.authorize(); signal?.throwIfAborted(); };
  await check();
  const recovered = input.record.kind === 'current' ? await openAccountBackupFile(store, snapshotId, input.record.file.id, access, input.reader) :
   await openAccountBackupFileVersion(store, snapshotId, input.record.eventThingId, input.record.side, access, input.reader);
  if (backupJson(recovered.file) !== backupJson(input.record.file)) throw Error('Restore source descriptor changed');
  const directory = await mkdtemp(join(options.temporaryDirectory ?? tmpdir(), 'thingtime-file-restore-'));
  const file = await open(join(directory, 'bytes'), constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
   let size = 0;
   for await (const bytes of recovered.ranges) {
    await check(); let offset = 0;
    while (offset < bytes.length) { const written = await file.write(bytes, offset, bytes.length - offset, size + offset); if (!written.bytesWritten) throw Error('Restore staging stopped'); offset += written.bytesWritten; }
    size += bytes.length;
   }
   if (size !== recovered.file.content.size) throw Error('Restore staging size changed');
   await file.sync();
   const initial = await file.stat();
   const sourceCheck = async () => { await check(); const current = await file.stat(); if (current.ino !== initial.ino || current.dev !== initial.dev || current.size !== initial.size || current.mtimeMs !== initial.mtimeMs || current.ctimeMs !== initial.ctimeMs) throw Error('Restore staging bytes changed'); };
   const read = async (offset: number, length: number) => {
    await sourceCheck(); if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > size) throw Error('Invalid staged range');
    const bytes = new Uint8Array(length); let done = 0;
    while (done < length) { const next = await file.read(bytes, done, length - done, offset + done); if (!next.bytesRead) throw Error('Incomplete staged range'); done += next.bytesRead; }
    await sourceCheck(); return bytes;
   };
   const requests = cloudRequests(runtime, scope, signal);
   const source: FingerprintSource = { size, read, check: sourceCheck, verify: sourceCheck,
    // Streaming parts keep RAM bounded even when the canonical S3 part size
    // grows above the ordinary browser transport's in-memory working size.
    uploadPart: async part => {
     await sourceCheck(); const hash = createHash('sha256');
     for (let offset = 0; offset < part.length;) { const length = Math.min(1024 * 1024, part.length - offset); hash.update(await read(part.offset + offset, length)); offset += length; }
     const digest = hash.digest(), checksum = digest.toString('base64');
     const signed = await requests.json('/api/v1/attachments/uploads/parts', { uploadId: part.uploadId, parts: [{ partNumber: part.partNumber, checksumSha256: checksum }] });
     const target = signed.parts?.[0];
     if (!Array.isArray(signed.parts) || signed.parts.length !== 1 || target.partNumber !== part.partNumber || typeof target.url !== 'string' ||
      !target.headers || Object.keys(target.headers).length !== 1 || target.headers['x-amz-checksum-sha256'] !== checksum) throw Error('Invalid restore upload target');
     const url = new URL(target.url, scope.origin);
     if (url.username || url.password || (url.protocol !== 'https:' && url.origin !== scope.origin)) throw Error('Invalid restore upload origin');
     await runtime.authorizeMutation?.(signal); await sourceCheck(); requests.check();
     const transferAbort = new AbortController();
     const deadline = createSyncTransferDeadline(AbortSignal.any([transferAbort.signal, ...(signal ? [signal] : [])]));
     let offset = 0;
     const stream = new ReadableStream<Uint8Array>({ async pull(controller) {
      try { deadline.signal.throwIfAborted(); await sourceCheck(); requests.check(); if (offset === part.length) { controller.close(); return; } const bytes = await read(part.offset + offset, Math.min(1024 * 1024, part.length - offset)); offset += bytes.length; deadline.resume(); controller.enqueue(bytes); }
      catch (error) { controller.error(error); }
     } });
     let response: Response;
     try { response = await runtime.fetch(url, { method: 'PUT', headers: target.headers, body: runtime.resources ? runtime.resources.stream('upload', stream, deadline.signal, deadline) : stream, duplex: 'half', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: deadline.signal } as RequestInit); } finally { deadline.dispose(); transferAbort.abort(); }
     await response.body?.cancel().catch(() => {}); await sourceCheck(); requests.check();
     if (!response.ok) throw Error(`Restore upload part failed (${response.status})`);
     return { sha256: digest.toString('hex'), payloadBytes: part.length };
    }
   };
   return await stageCloudFileBytes(runtime, {
    scope, folderId: input.folderId, before: null, cloudRootId: input.rootId,
    operation: { id: input.operationId, confirmed: true, mutation: { kind: 'copy', from: 'local', path: input.path, expectedTarget: null,
     source: { kind: 'file', path: input.path, id: input.targetId, version: recovered.file.revision, size,
      sha256: size === 0 ? recovered.file.content.fingerprint.sha256 : null, ...(size > 0 ? { fingerprint: recovered.file.content.fingerprint } : {}),
      ...(recovered.file.symbolicLink ? { symbolicLink: recovered.file.symbolicLink } : {}) } } }
   }, input.targetId, source, signal);
   // Staging must bind to the file's fresh target ID, independent from the
   // deterministic operation/upload request ID (historical versions differ).
  } finally { await file.close(); await rm(directory, { recursive: true, force: true }); }
 };
}
