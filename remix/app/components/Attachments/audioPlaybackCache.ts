import { attachmentMediaSrc, attachmentPlaybackContentType } from './attachmentUiCore';
import type { PublicAttachment } from './attachmentTypes';
import { readBoundedFileBlob, readBoundedJson } from '../../local-workspace/accountTransport.client';
import { accountRemoteWorkspaceLease, accountWorkspaceLease, anonymousWorkspaceLease, currentAccountWorkspace, isAnonymousWorkspace, workspaceDatabase, workspaceIdentityKey } from '../../local-workspace/runtime.client';
import { workspaceScopeKey, type WorkspaceScope, type WorkspaceLease, type WorkspaceDatabase } from '../../local-workspace/storage';
import { EXPECTED_DATA_PLANE_HEADER, isDataPlane } from '../../utils/dataPlane';
import { requireThingtimeCapability } from '../../api/utils/capabilities/requireCapability.client';
import { withExportDeadline } from '../../utils/thingTransfer/exportDeadline';
import { ORIGINAL_STREAM_POLICY } from '../../utils/thingTransfer/originalStreamPolicy';

const CACHE_VERSION = 'v2';
const COLLECTION = 'audio-playback-v2';
const binaryId = (id: string) => `audio-playback:${id}`;

export type OfflineAudioContext = {
 scope: WorkspaceScope;
 key: string;
 lease: WorkspaceLease;
 remoteLease(): WorkspaceLease;
 origin: string;
 dataPlane: string;
};

/** A display identity never selects a partition. Only the root-bound workspace
 * can supply it; a Character retains its delegating principal in the key. */
export function captureOfflineAudioContext(actorId: string | null | undefined, dataPlane: string | null): OfflineAudioContext | null {
 const identity = workspaceIdentityKey();
 if (!identity || typeof window === 'undefined' || !isDataPlane(dataPlane)) return null;
 const account = currentAccountWorkspace();
 if (account) {
  if (account.dataPlane !== dataPlane || account.origin !== window.location.origin) return null;
  const scope = actorId && actorId !== account.ownerId ? { ...account, ownerId: actorId, delegatedBy: account.ownerId } : account;
  return { scope, key: workspaceScopeKey(scope), lease: accountWorkspaceLease(scope),
   remoteLease: () => accountRemoteWorkspaceLease(scope), origin: account.origin, dataPlane };
 }
 if (!isAnonymousWorkspace() || actorId) return null;
 const scope = { kind: 'anonymous' } as const;
 return { scope, key: JSON.stringify([workspaceScopeKey(scope), window.location.origin, dataPlane]),
  lease: anonymousWorkspaceLease(), remoteLease: anonymousWorkspaceLease, origin: window.location.origin, dataPlane };
}

export const audioAttachmentIdentity = (attachment: PublicAttachment) => JSON.stringify([
 attachment.id, attachment.size, attachmentPlaybackContentType(attachment), attachment.url || ''
]);
export const audioOfflineCacheKey = (attachment: PublicAttachment, context: OfflineAudioContext) =>
 JSON.stringify([CACHE_VERSION, context.key, audioAttachmentIdentity(attachment)]);

export type OfflineAudioRecord = {
 version: typeof CACHE_VERSION;
 key: string;
 contentType: string;
 contentIdentity: string;
 size: number;
 cachedAt: number;
};
export const isOfflineAudioRecord = (value: unknown, attachment: PublicAttachment, context: OfflineAudioContext): value is OfflineAudioRecord => {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
 const record = value as Partial<OfflineAudioRecord>;
 return record.version === CACHE_VERSION && record.key === audioOfflineCacheKey(attachment, context) &&
  record.contentType === attachmentPlaybackContentType(attachment) && typeof record.contentIdentity === 'string' && /^[a-f0-9]{64}$/.test(record.contentIdentity) && record.size === attachment.size &&
  Number.isSafeInteger(record.size) && record.size! > 0 && typeof record.cachedAt === 'number' && Number.isFinite(record.cachedAt);
};

/** V1 omitted origin, data plane and delegation. Leave it intact for recovery,
 * but never read/migrate its bytes into a context that cannot prove provenance.
 * Metadata and Blob writes share the normal workspace transaction/accounting. */
export const readOfflineAudio = async (attachment: PublicAttachment, context: OfflineAudioContext, db = workspaceDatabase()): Promise<Blob | null> =>
 db.transaction(context.scope, 'readwrite', context.lease, async tx => {
  const record = await tx.get<unknown>(COLLECTION, attachment.id);
  // Attachment IDs index the latest copy. A stale descriptor (or another
  // anonymous plane) is a cache miss, never authority to delete that copy.
  // Only a record claiming this exact context/descriptor can be cleaned as
  // corrupt below; unknown provenance stays available for explicit removal.
  if (!record || typeof record !== 'object' || (record as Partial<OfflineAudioRecord>).key !== audioOfflineCacheKey(attachment, context)) return null;
  const binary = await tx.getBinary(binaryId(attachment.id));
  const bytes = binary?.value;
  if (isOfflineAudioRecord(record, attachment, context) && bytes instanceof Blob && bytes.size === record.size && bytes.type === record.contentType) return bytes;
  if (record !== undefined || binary !== undefined) {
   await tx.delete(COLLECTION, attachment.id);
   await tx.deleteBytes(binaryId(attachment.id));
  }
  return null;
 });

export const removeOfflineAudio = async (attachment: PublicAttachment, context: OfflineAudioContext, db = workspaceDatabase()): Promise<void> =>
 db.transaction(context.scope, 'readwrite', context.lease, async tx => {
  await tx.delete(COLLECTION, attachment.id); await tx.deleteBytes(binaryId(attachment.id));
 });

export const saveOfflineAudio = async (attachment: PublicAttachment, context: OfflineAudioContext, mediaUrl: (url: string) => string = url => url,
 options: { signal?: AbortSignal; db?: WorkspaceDatabase; requireCapability?: typeof requireThingtimeCapability } = {}): Promise<Blob> => {
 if (typeof window === 'undefined') throw new Error('Offline audio is available in a browser only.');
 if (attachment.url) throw new Error('Only Thingtime-hosted audio can be saved for offline playback.');
 if (!Number.isSafeInteger(attachment.size) || attachment.size < 1) throw new Error('Audio file size is unavailable. Refresh its details before saving.');
 const source = mediaUrl(attachmentMediaSrc(attachment));
 if (!source) throw new Error('Shared media is not ready. Please try again after it loads.');
 const url = new URL(source, context.origin);
 // Shared grants and device Blob URLs must never become ordinary account cache
 // authority, even when this function is called outside the player.
 if (url.origin !== context.origin || url.pathname !== '/api/v1/attachments/content' || url.searchParams.get('id') !== attachment.id ||
  [...url.searchParams.keys()].some(key => !['id', 'character'].includes(key) || url.searchParams.getAll(key).length !== 1) ||
  (url.searchParams.has('character') && (context.scope.kind !== 'account' || url.searchParams.get('character') !== context.scope.ownerId)))
  throw new Error('This audio context cannot be saved as an ordinary offline copy.');
 context.lease.assertCurrent();
 const remote = context.remoteLease(); remote.assertCurrent();
 const controller = new AbortController();
 const stop = context.lease.onInvalidate(() => controller.abort()), stopRemote = remote.onInvalidate(() => controller.abort());
 const signal = AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]);
 const lease: WorkspaceLease = {
  assertCurrent: () => { context.lease.assertCurrent(); remote.assertCurrent(); signal.throwIfAborted(); },
  onInvalidate: callback => {
   signal.addEventListener('abort', callback, { once: true });
   return () => signal.removeEventListener('abort', callback);
  }
 };
 const headers = { [EXPECTED_DATA_PLANE_HEADER]: context.dataPlane,
  ...(context.scope.kind === 'account' ? { 'X-Thingtime-Expected-Actor': context.scope.ownerId,
   ...(context.scope.delegatedBy ? { 'X-Thingtime-Character': context.scope.ownerId } : {}) } : {}) };
 // Fetch can carry the Character header; the original-stream query contract
 // deliberately permits no Character parameter or alternate grant.
 const query = new URLSearchParams({ id: attachment.id, download: '1' });
 const request = async (mode: string, signal: AbortSignal, extraHeaders = {}) => {
  const selected = new URLSearchParams(query); selected.set('cache', mode);
  const response = await fetch(`/api/v1/attachments/content?${selected}`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal, headers: { ...headers, ...extraHeaders } });
  lease.assertCurrent(); signal.throwIfAborted();
  if (response.redirected) { void response.body?.cancel().catch(() => {}); throw new Error('The audio response changed origin.'); }
  if (!response.ok) {
   let confirmedRefusal = false;
   if ([401, 403, 404, 410].includes(response.status) && /^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') || '')) {
    try { confirmedRefusal = (await readBoundedJson(response))?.ok === false; } catch { /* Edge errors are not evidence of revocation. */ }
   } else { void response.body?.cancel().catch(() => {}); }
   lease.assertCurrent(); signal.throwIfAborted();
   if (confirmedRefusal) await removeOfflineAudio(attachment, context, options.db);
   throw new Error('Thingtime could not download this audio file.');
  }
  return response;
 };
 const receipt = () => withExportDeadline(async signal => {
  const response = await request('validate', signal);
  const value = await readBoundedJson(response);
  lease.assertCurrent(); signal.throwIfAborted();
  if (value?.ok !== true || !/^[a-f0-9]{64}:original$/.test(value.cacheKey) || value.size !== attachment.size)
   throw new Error('The audio file changed. Refresh its details before saving.');
  return { key: String(value.cacheKey), size: Number(value.size) };
 }, signal);
 try {
  await withExportDeadline(async signal => {
   await (options.requireCapability || requireThingtimeCapability)('api.attachment-content', '1.18.0');
   if (context.scope.kind === 'account' && context.scope.delegatedBy) await (options.requireCapability || requireThingtimeCapability)('api.auth-characters', '1.0.0');
   lease.assertCurrent(); signal.throwIfAborted();
  }, signal);
  const pinned = await receipt(), etag = `"${pinned.key}:v1"`;
  const streamSignal = AbortSignal.any([signal, AbortSignal.timeout(ORIGINAL_STREAM_POLICY.totalMs)]);
  const response = await request('original-bytes', streamSignal, { 'If-Match': etag });
  if (response.status !== 200 || response.headers.get('ETag') !== etag || response.headers.get('Content-Length') !== String(attachment.size) ||
   (response.headers.has('Content-Encoding') && response.headers.get('Content-Encoding') !== 'identity')) {
   void response.body?.cancel().catch(() => {});
   throw new Error('The audio stream does not match its authorized version.');
  }
  const downloaded = await readBoundedFileBlob(response, attachment.size, streamSignal);
  const current = await receipt(); lease.assertCurrent();
  if (current.key !== pinned.key) throw new Error('The audio file changed while saving. Please try again.');
  const bytes = new Blob([downloaded], { type: attachmentPlaybackContentType(attachment) });
  // Retain only an irreversible equality token, never the live receipt, signed
  // storage URL, shared key or other remote authority.
  const contentIdentity = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pinned.key)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const record: OfflineAudioRecord = { version: CACHE_VERSION, key: audioOfflineCacheKey(attachment, context),
   contentType: bytes.type, contentIdentity, size: bytes.size, cachedAt: Date.now() };
  await (options.db || workspaceDatabase()).transaction(context.scope, 'readwrite', lease, async tx => {
   await tx.put(COLLECTION, attachment.id, record); await tx.putBlob(binaryId(attachment.id), bytes);
  });
  lease.assertCurrent();
  return bytes;
 } finally { stop(); stopRemote(); }
};
