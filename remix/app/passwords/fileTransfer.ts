import { encryptPasswordFile, decryptPasswordFile, iterableStream, passwordFileParts, type PasswordFile } from './fileCrypto';
import type { PasswordStorage, SavedPasswordFile } from './storage';

export type PasswordFileRequest = (body: Record<string, unknown>, signal?: AbortSignal) => Promise<any>;
export type PasswordAssetFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Shared canonical file transfer. The caller supplies the entire authority
 * boundary; this module never chooses an account, origin or credential. */
export function remotePasswordStorage(request: PasswordFileRequest, fetchAsset: PasswordAssetFetch, options: {
  onUploadStarted?: (upload: { id: string; state: string }, signal?: AbortSignal) => Promise<void>;
} = {}): PasswordStorage {
async function uploadFile(entryId: string, metadata: PasswordFile, open: () => ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const call = (operation: string, rest: Record<string, unknown> = {}) => request({ operation, entryId, ...rest }, signal);
  const { upload } = await call('file-start', { metadata });
  await options.onUploadStarted?.(upload, signal);
  signal?.throwIfAborted();
  if (upload.state !== 'ready') {
    let partNumber = 0;
    const encrypted = iterableStream(encryptPasswordFile(open(), metadata, signal));
    for await (const bytes of passwordFileParts(encrypted, upload.partSizeBytes, signal)) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
      const checksumSha256 = btoa(String.fromCharCode(...digest));
      const { parts } = await call('file-parts', { fileId: upload.id, parts: [{ partNumber: ++partNumber, checksumSha256 }] });
      const response = await fetchAsset(parts[0].url, { method: 'PUT', headers: parts[0].headers, body: bytes as BodyInit, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal });
      if (!response.ok) throw new Error('Encrypted file upload failed. Retry to resume.');
    }
  }
  return (await call('file-complete', { fileId: upload.id })).file as SavedPasswordFile;
}
async function listFiles(entryIds: string[], signal?: AbortSignal, sourceIds?: string[]) {
  const files: SavedPasswordFile[] = []; let cursor: string | undefined;
  do { const result = await request({ operation: 'file-list', entryIds, sourceIds, ...(cursor ? { cursor } : {}) }, signal); files.push(...result.files); cursor = result.nextCursor || undefined; } while (cursor);
  return files;
}
async function openFile(entryId: string, fileId: string, signal?: AbortSignal) {
  const result = await request({ operation: 'file-download', entryId, fileId }, signal);
  const response = await fetchAsset(result.url, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal });
  if (!response.ok || !response.body) throw new Error('Encrypted file could not be downloaded.');
  return { metadata: result.metadata as PasswordFile, stream: iterableStream(decryptPasswordFile(response.body, result.metadata, signal)) };
}
  return {
    exportPage: (cursor, signal) => request({ operation: 'export', ...(cursor ? { cursor } : {}) }, signal),
    listFiles, uploadFile, openFile,
    removeFile: async (entryId, fileId, signal) => { await request({ operation: 'file-delete', entryId, fileId }, signal); }
  };
}
