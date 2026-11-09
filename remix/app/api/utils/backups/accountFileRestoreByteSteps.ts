import { createHash } from 'node:crypto';
import { BACKUP_CHUNK_BYTES, backupDigest, backupId } from '../../../backups/manifest';
import { parseCloudFile, validFileName, type CloudFile } from '../../../fileSync/cloudFile';
import { contentPartPlan, equalContentFingerprints } from '../../../fileSync/contentFingerprint';
import { timelineScopeKey } from '../../../timeline/contract';
import type { BackupAccess, BackupObjectStore } from './portableBackup';
import type { BackupEngineContext } from './backupJobs';
import type { CloudBackupRuntime } from './cloudFolderBackup';
import { backupHashOperationId, backupJobDigest } from './backupJobCore';
import { createResumableHashWorker, type ImmutableHashSource } from './resumableHash';

type Phase = 'verify-part' | 'verify-composite' | 'reserve' | 'upload-part' | 'complete' | 'fingerprint' | 'done';
export type FileRestoreBytesState = {
 version: 1; binding: string; phase: Phase; partIndex: number;
 uploadId: string | null; content: CloudFile['content'] | null;
};
export type FileRestoreByteStepInput = {
 ctx: BackupEngineContext; store: BackupObjectStore; access: BackupAccess;
 snapshotId: string; sourceSealHash: string; streamId: string; commandId: string;
 name: string; file: CloudFile; runtime: CloudBackupRuntime;
 /** Reads verified immutable ranges from the exact sealed source descriptor. */
 read(offset: number, length: number): Promise<Uint8Array>;
 state: FileRestoreBytesState | null;
 /** Must atomically commit the protected state pointer and clear hash slots. */
 checkpoint(state: FileRestoreBytesState, clearHashSlots?: ('part' | 'composite')[]): Promise<void>;
 /** Immutable digest records in the same review/restore namespace. */
 putPartDigest(partIndex: number, digest: string): Promise<void>;
 getPartDigest(partIndex: number): Promise<string | null>;
};
const fail = (): never => { throw Error('The pinned file restore byte continuation changed'); };
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v);

/** One resumable hash range or one canonical upload operation per invocation.
 * All source parts and their composite are verified before upload admission.
 * No whole-file temporary copy, bearer token, signed URL, or digest array is
 * persisted. Existing upload request/part identities survive uncertain replies.
 * A canonical multipart PUT is streamed; its provider operation is indivisible
 * and a timed-out part is retried under the same upload/part/checksum identity. */
export async function advanceAccountFileRestoreBytes(input: FileRestoreByteStepInput): Promise<{ done: false } | { done: true; content: CloudFile['content'] }> {
 const { ctx, store, access, runtime } = input;
 const file = parseCloudFile(input.file), size = file.content.size, plan = contentPartPlan(size);
 if (!backupId(input.snapshotId) || !backupId(input.commandId) || !backupDigest(input.sourceSealHash) || !identifier(input.streamId) || !validFileName(input.name)) return fail();
 const scope = timelineScopeKey(access.scope);
 const binding = backupJobDigest([ctx.jobId, access.scope, input.snapshotId, input.sourceSealHash, input.streamId, input.commandId, input.name, file]);
 const signal = AbortSignal.any([ctx.request.signal, ...(access.signal ? [access.signal] : []), ...(runtime.signal ? [runtime.signal] : [])]);
 const check = async () => {
  signal.throwIfAborted();
  if (access.scope.dataPlane !== 'home' || timelineScopeKey(access.scope) !== scope || timelineScopeKey(runtime.scope) !== scope || timelineScopeKey(runtime.currentScope()) !== scope || new URL(ctx.request.url).origin !== access.scope.apiOrigin) return fail();
  await ctx.guard(); await access.authorize(); signal.throwIfAborted();
  if (timelineScopeKey(runtime.currentScope()) !== scope || timelineScopeKey(access.scope) !== scope) return fail();
 };
 await check();
 const state = structuredClone(input.state ?? { version: 1, binding, phase: size ? 'verify-part' : 'verify-composite', partIndex: 0, uploadId: null, content: null }) as FileRestoreBytesState;
 if (Object.keys(state).sort().join(',') !== 'binding,content,partIndex,phase,uploadId,version' || state.version !== 1 || state.binding !== binding ||
  !['verify-part', 'verify-composite', 'reserve', 'upload-part', 'complete', 'fingerprint', 'done'].includes(state.phase) ||
  !Number.isSafeInteger(state.partIndex) || state.partIndex < 0 || state.partIndex > plan.partCount ||
  (state.uploadId !== null && !identifier(state.uploadId)) ||
  (['upload-part', 'complete', 'fingerprint', 'done'].includes(state.phase) !== (state.uploadId !== null)) ||
  (state.phase === 'done' ? !state.content : state.content !== null)) return fail();
 const save = async (next: Partial<FileRestoreBytesState>, clear?: ('part' | 'composite')[]) => {
  await check(); await input.checkpoint({ ...state, ...next }, clear); await check(); return { done: false as const };
 };
 // Persist the initial phase before accepting a hash checkpoint. A restarted
 // caller must never regenerate initial state while a later hash slot exists.
 if (!input.state) return save({});
 const read = async (offset: number, length: number) => {
  await check();
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || length > BACKUP_CHUNK_BYTES || offset + length > size) return fail();
  const bytes = await input.read(offset, length); await check();
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) return fail();
  return bytes;
 };
 const digestAt = async (index: number) => {
  await check(); const digest = await input.getPartDigest(index); await check();
  if (!backupDigest(digest)) return fail(); return digest;
 };
 const hash = async (slot: 'part' | 'composite', stream: string, length: number, expected: string | null, source: ImmutableHashSource, budget = BACKUP_CHUNK_BYTES) => {
  const hashBinding = { operationId: backupHashOperationId(ctx.jobId, slot, stream, 'stream'), snapshotId: input.snapshotId,
   streamId: stream, objectVersion: binding, bytes: String(length), expectedSha256: expected };
  const worker = createResumableHashWorker({ store, keys: ctx.hashKeys, access: { ...access, signal, authorize: check },
   coordinator: ctx.hashCoordinator(slot, () => ({ ...ctx.cursor })) });
  const prior = await worker.start(hashBinding, source);
  return prior.complete ? prior : worker.advance(hashBinding, prior, backupHashOperationId(ctx.jobId, slot, stream, `step-${prior.sequence + 1}`), source, budget);
 };
 if (state.phase === 'verify-part') {
  if (state.partIndex >= plan.partCount) return fail();
  const start = state.partIndex * plan.partSizeBytes, length = Math.min(plan.partSizeBytes, size - start);
  const result = await hash('part', `restore-${binding}-part-${state.partIndex}`, length, null,
   { assertIdentity: check, read: (offset, count) => read(start + Number(offset), count) });
  if (!result.complete) return { done: false };
  if (!backupDigest(result.finalDigest)) return fail();
  await input.putPartDigest(state.partIndex, result.finalDigest); await check();
  return save({ partIndex: state.partIndex + 1, phase: state.partIndex + 1 === plan.partCount ? 'verify-composite' : 'verify-part' }, ['part']);
 }
 if (state.phase === 'verify-composite') {
  if (state.partIndex !== plan.partCount) return fail();
  const result = await hash('composite', `restore-${binding}-composite`, plan.partCount * 32, file.content.fingerprint.sha256, {
   assertIdentity: check, read: async (offset, length) => {
    if (offset % BigInt(32) !== BigInt(0) || length % 32 !== 0) return fail();
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length / 32; i++) bytes.set(Buffer.from(await digestAt(Number(offset / BigInt(32)) + i), 'hex'), i * 32);
    return bytes;
   }
  }, 32 * 128);
  if (!result.complete) return { done: false };
  return save({ phase: 'reserve', partIndex: 0 }, ['composite']);
 }
 const json = async (path: string, body?: unknown) => {
  await check();
  const response = await runtime.fetch(new URL(path, access.scope.apiOrigin), { method: body === undefined ? 'GET' : 'POST',
   headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
   ...(body === undefined ? {} : { body: JSON.stringify(body) }), credentials: 'omit', redirect: 'error', cache: 'no-store', signal });
  await check();
  if (!response.ok) { void response.body?.cancel().catch(() => {}); throw Error(`Restore upload request failed (${response.status})`); }
  const value = await response.json(); await check(); return value;
 };
 const content = (candidate: unknown) => {
  const restored = parseCloudFile({ ...file, content: candidate }).content;
  if (restored.attachmentId !== state.uploadId || restored.size !== size || !equalContentFingerprints(restored.fingerprint, file.content.fingerprint)) return fail();
  return restored;
 };
 for (const [feature, minimum] of Object.entries({ 'api.attachment-uploads': '1.7.0', 'api.attachment-upload-parts': '1.1.0', 'api.attachment-upload-complete': '1.5.0', 'api.attachment-content': '1.16.0' })) { await runtime.requireCapability(feature, minimum); await check(); }
 if (state.phase === 'reserve') {
  const { upload } = await json('/api/v1/attachments/uploads', { requestId: input.commandId, filename: input.name,
   contentType: 'application/octet-stream', sizeBytes: size, purpose: 'file-import' });
  if (!identifier(upload?.id) || upload.partSizeBytes !== plan.partSizeBytes || upload.partCount !== plan.partCount || (!size && upload.state !== 'ready')) return fail();
  return save({ phase: upload.state === 'ready' ? 'fingerprint' : 'upload-part', uploadId: upload.id, partIndex: 0 });
 }
 if (state.phase === 'upload-part') {
  if (state.partIndex >= plan.partCount) return fail();
  const partNumber = state.partIndex + 1, start = state.partIndex * plan.partSizeBytes, length = Math.min(plan.partSizeBytes, size - start);
  const expected = await digestAt(state.partIndex), checksum = Buffer.from(expected, 'hex').toString('base64');
  const signed = await json('/api/v1/attachments/uploads/parts', { uploadId: state.uploadId, parts: [{ partNumber, checksumSha256: checksum }] });
  const part = signed.parts?.[0];
  if (!Array.isArray(signed.parts) || signed.parts.length !== 1 || part.partNumber !== partNumber || typeof part.url !== 'string' ||
   !part.headers || Object.keys(part.headers).length !== 1 || part.headers['x-amz-checksum-sha256'] !== checksum) return fail();
  const target = new URL(part.url, access.scope.apiOrigin);
  if (target.username || target.password || (target.origin !== access.scope.apiOrigin && target.protocol !== 'https:')) return fail();
  const transfer = new AbortController(), transferSignal = AbortSignal.any([signal, transfer.signal]);
  const hasher = createHash('sha256'); let offset = 0, consumed = false;
  const body = new ReadableStream<Uint8Array>({ async pull(controller) {
   try {
    transferSignal.throwIfAborted(); await check();
    if (offset === length) { if (hasher.digest('hex') !== expected) return fail(); consumed = true; controller.close(); return; }
    const bytes = await read(start + offset, Math.min(1024 * 1024, length - offset));
    transferSignal.throwIfAborted(); hasher.update(bytes); offset += bytes.length; controller.enqueue(bytes);
   } catch (error) { controller.error(error); transfer.abort(error); }
  } });
  try {
   await check();
   const response = await runtime.fetch(target, { method: 'PUT', headers: { ...part.headers, 'Content-Length': String(length) },
    body, duplex: 'half', signal: transferSignal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' } as RequestInit);
   void response.body?.cancel().catch(() => {}); await check();
   if (!response.ok) throw Error(`Restore upload part failed (${response.status})`);
   if (!consumed) return fail();
  } finally { transfer.abort(); }
  return save({ partIndex: partNumber, phase: partNumber === plan.partCount ? 'complete' : 'upload-part' });
 }
 if (state.phase === 'complete') {
  if (!size || state.partIndex !== plan.partCount) return fail();
  await json('/api/v1/attachments/uploads/complete', { uploadId: state.uploadId });
  return save({ phase: 'fingerprint' });
 }
 if (state.phase === 'fingerprint') {
  const result = await json('/api/v1/attachments/content?' + new URLSearchParams({ id: state.uploadId!, fingerprint: '1' }));
  if (result.id !== state.uploadId) return fail();
  return save({ phase: 'done', content: content({ attachmentId: result.id, version: result.version, size: result.size, fingerprint: result.fingerprint }) });
 }
 if (state.phase !== 'done') return fail();
 await check(); return { done: true, content: content(state.content) };
}
