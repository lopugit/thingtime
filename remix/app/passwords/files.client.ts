import { passwordRequest } from './client';
import { encryptPasswordFile, decryptPasswordFile, iterableStream, passwordFileParts, type PasswordFile } from './fileCrypto';
import type { PasswordStorage, SavedPasswordFile } from './storage';
export type { SavedPasswordFile } from './storage';

/** Account-only adapter. Device callers supply their own PasswordStorage. */
export function accountPasswordStorage(ownerId: string): PasswordStorage {
  return {
    exportPage: (cursor, signal) => passwordRequest(ownerId, { operation: 'export', ...(cursor ? { cursor } : {}) }, signal),
    listFiles: (entryIds, signal, sourceIds) => listPasswordFilesForEntries(ownerId, entryIds, signal, sourceIds),
    uploadFile: (entryId, metadata, open, signal) => uploadPasswordFile(ownerId, entryId, metadata, open, signal),
    openFile: (entryId, fileId, signal) => openPasswordFile(ownerId, entryId, fileId, signal),
    removeFile: async (entryId, fileId, signal) => { await passwordRequest(ownerId, { operation: 'file-delete', entryId, fileId }, signal); }
  };
}
export async function uploadPasswordFile(ownerId: string, entryId: string, metadata: PasswordFile, open: () => ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const call = (operation: string, rest: Record<string, unknown> = {}) => passwordRequest(ownerId, { operation, entryId, ...rest }, signal);
  const { upload } = await call('file-start', { metadata });
  if (upload.state !== 'ready') {
    let partNumber = 0;
    const encrypted = iterableStream(encryptPasswordFile(open(), metadata, signal));
    for await (const bytes of passwordFileParts(encrypted, upload.partSizeBytes, signal)) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
      const checksumSha256 = btoa(String.fromCharCode(...digest));
      const { parts } = await call('file-parts', { fileId: upload.id, parts: [{ partNumber: ++partNumber, checksumSha256 }] });
      const response = await fetch(parts[0].url, { method: 'PUT', headers: parts[0].headers, body: bytes as BodyInit, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal });
      if (!response.ok) throw new Error('Encrypted file upload failed. Retry to resume.');
    }
  }
  return (await call('file-complete', { fileId: upload.id })).file as SavedPasswordFile;
}
export async function listPasswordFiles(ownerId: string, entryId: string, signal?: AbortSignal) {
  return listPasswordFilesForEntries(ownerId, [entryId], signal);
}
export async function listPasswordFilesForEntries(ownerId: string, entryIds: string[], signal?: AbortSignal, sourceIds?: string[]) {
  const files: SavedPasswordFile[] = []; let cursor: string | undefined;
  do { const result = await passwordRequest(ownerId, { operation: 'file-list', entryIds, sourceIds, ...(cursor ? { cursor } : {}) }, signal); files.push(...result.files); cursor = result.nextCursor || undefined; } while (cursor);
  return files;
}
export async function openPasswordFile(ownerId: string, entryId: string, fileId: string, signal?: AbortSignal) {
  const result = await passwordRequest(ownerId, { operation: 'file-download', entryId, fileId }, signal);
  const response = await fetch(result.url, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal });
  if (!response.ok || !response.body) throw new Error('Encrypted file could not be downloaded.');
  return { metadata: result.metadata as PasswordFile, stream: iterableStream(decryptPasswordFile(response.body, result.metadata, signal)) };
}
