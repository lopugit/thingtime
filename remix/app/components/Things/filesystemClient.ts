import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { FILESYSTEM_CHUNK_BYTES, FILESYSTEM_MAX_BYTES, normalizeFilesystemResult, type FilesystemEntry, type FilesystemInput, type FilesystemResult } from '~/api/utils/devices/deviceFilesystemCore';
import type { ThingsThing } from './thingsCore';

export const FILESYSTEM_REQUIREMENTS = { 'api.devices-commands': '1.9.0', 'api.devices-node-commands': '1.9.0', 'api.devices-node-state': '1.9.0', 'api.attachment-uploads': '1.5.0', 'api.things-bulk': '1.5.0', 'api.things': '1.24.0', 'api.attachment-upload-complete': '1.4.0', 'api.attachment-content': '1.11.0' } as const;
export const requireFilesystemCapabilities = () => Promise.all(Object.entries(FILESYSTEM_REQUIREMENTS).map(([feature, version]) => requireThingtimeCapability(feature, version)));
export type FileLocation = { deviceId: string; path: string; folderId?: undefined; label?: undefined } | { deviceId?: undefined; folderId: string | null; label?: string; path?: undefined };
export type FileClipboard = { ownerId: string; mode: 'copy' | 'cut'; location: FileLocation; items: ThingsThing[] };
let clipboard: FileClipboard | null = null;
export const filesystemClipboard = { get: (ownerId: string) => clipboard?.ownerId === ownerId ? clipboard : null, set: (value: FileClipboard | null) => { clipboard = value; window.dispatchEvent(new Event('thingtime-files-clipboard')); } };
export const fileRequest = async (url: string, body?: unknown, signal?: AbortSignal, method?: string): Promise<any> => {
  signal?.throwIfAborted();
  const response = await fetch(url, { method: method || (body === undefined ? 'GET' : 'POST'), credentials: 'same-origin', cache: 'no-store', signal,
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw Object.assign(new Error(payload.error || `File operation failed (${response.status})`), { status: response.status, retryAfter: response.headers.get('Retry-After') });
  return payload;
};
const wait = (signal: AbortSignal, milliseconds = 750) => new Promise<void>((resolve, reject) => {
  signal.throwIfAborted();
  const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
  signal.addEventListener('abort', abort, { once: true });
});
// Only the command transport retries: mutations keep one requestId across a
// lost response, and polling is read-only. Other file writers own their retry.
const commandRequest = async (url: string, body: unknown, signal: AbortSignal) => {
  for (let attempt = 0; ; attempt++) {
    try { return await fileRequest(url, body, signal); }
    catch (error: any) {
      signal.throwIfAborted();
      if (attempt >= 3 || !(error instanceof TypeError || [429, 502, 503, 504].includes(error?.status))) throw error;
      const seconds = error.retryAfter === null || error.retryAfter === undefined ? NaN : Number(error.retryAfter);
      await wait(signal, Number.isFinite(seconds) ? Math.min(60_000, Math.max(0, seconds * 1000)) : 1000 * 2 ** attempt);
    }
  }
};
export type FileApproval = (approval: { id: string; prompt: string }, signal: AbortSignal) => Promise<void>;
export const remoteFileCommand = async (deviceId: string, input: FilesystemInput, signal: AbortSignal, approve: FileApproval, requestId: string = crypto.randomUUID()): Promise<FilesystemResult> => {
  await requireFilesystemCapabilities(); signal.throwIfAborted();
  const created = await commandRequest('/api/v1/devices/commands', { deviceId, kind: 'filesystem', input, requestId }, signal);
  const commandId = created.command.id;
  const started = Date.now();
  while (Date.now() - started < 10 * 60_000) {
    signal.throwIfAborted();
    const { command } = await commandRequest(`/api/v1/devices/commands?deviceId=${encodeURIComponent(deviceId)}&commandId=${encodeURIComponent(commandId)}`, undefined, signal);
    if (command.status === 'succeeded') {
      const result = normalizeFilesystemResult(input, command.result);
      if (!result) throw new Error('The file result expired or was invalid. Refresh and try again.');
      return result;
    }
    if (['failed', 'cancelled', 'needs-review'].includes(command.status)) throw new Error(command.error || 'The device could not confirm that operation. Refresh before retrying.');
    if (command.status === 'needs-approval') {
      const { approvals } = await fileRequest(`/api/v1/devices/approvals?deviceId=${encodeURIComponent(deviceId)}`, undefined, signal);
      const approval = approvals.find((a: any) => a.commandId === commandId && a.status === 'pending');
      if (approval) await approve(approval, signal);
    }
    await wait(signal);
  }
  throw new Error('The device did not respond in time. It may finish the queued operation later; refresh before retrying.');
};
export const remoteEntryThing = (deviceId: string, entry: FilesystemEntry): ThingsThing => ({
  id: `filesystem:${deviceId}:${entry.path}`, thingtime: [entry.type === 'folder' ? 'folder' : 'file'], author: null, visibility: 'private', acl: [], targetId: null,
  folderId: null, crystal: { name: entry.name, size: entry.size }, extended: null, tags: [], createdAt: entry.modifiedAt, updatedAt: entry.modifiedAt,
  inode: { deviceId, ...entry }
});
export const readRemoteFile = async (deviceId: string, entry: FilesystemEntry, signal: AbortSignal, approve: FileApproval, progress: (done: number, total: number) => void): Promise<File> => {
  if (entry.type !== 'file' || entry.size > FILESYSTEM_MAX_BYTES) throw new Error('Choose a regular file up to 32 MiB.');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 0; offset < entry.size || (offset === 0 && entry.size === 0); offset += FILESYSTEM_CHUNK_BYTES) {
    const result = await remoteFileCommand(deviceId, { op: 'read', path: entry.path, version: entry.version, offset }, signal, approve);
    if (result.size !== entry.size) throw new Error('The file changed during the transfer.');
    chunks.push(Uint8Array.from(atob(result.data!), c => c.charCodeAt(0)));
    progress(Math.min(offset + FILESYSTEM_CHUNK_BYTES, entry.size), entry.size);
    if (entry.size === 0) break;
  }
  signal.throwIfAborted();
  return new File(chunks, entry.name, { type: 'application/octet-stream' });
};
export const writeRemoteFile = async (deviceId: string, path: string, file: File, signal: AbortSignal, approve: FileApproval, progress: (done: number, total: number) => void) => {
  if (file.size > FILESYSTEM_MAX_BYTES) throw new Error('Choose a file up to 32 MiB.');
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
  const transferId = crypto.randomUUID();
  for (let offset = 0; offset < file.size || (offset === 0 && file.size === 0); offset += FILESYSTEM_CHUNK_BYTES) {
    const bytes = new Uint8Array(await file.slice(offset, offset + FILESYSTEM_CHUNK_BYTES).arrayBuffer());
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    await remoteFileCommand(deviceId, { op: 'write', path, transferId, offset, total: file.size, sha256, data: btoa(binary) }, signal, approve, `${transferId}:${offset}`);
    progress(Math.min(offset + bytes.length, file.size), file.size);
    if (file.size === 0) break;
  }
};
