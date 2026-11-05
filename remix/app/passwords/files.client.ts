import { passwordRequest } from './client';
import { remotePasswordStorage } from './fileTransfer';
import type { PasswordFile } from './fileCrypto';
export type { SavedPasswordFile } from './storage';

/** Legacy online account UI; device workspaces supply their own storage. */
export function accountPasswordStorage(ownerId: string) {
  return remotePasswordStorage((body, signal) => passwordRequest(ownerId, body, signal), (url, init) => fetch(url, init));
}
export const uploadPasswordFile = (ownerId: string, entryId: string, metadata: PasswordFile, open: () => ReadableStream<Uint8Array>, signal?: AbortSignal) =>
  accountPasswordStorage(ownerId).uploadFile(entryId, metadata, open, signal);
export const listPasswordFiles = (ownerId: string, entryId: string, signal?: AbortSignal) =>
  accountPasswordStorage(ownerId).listFiles([entryId], signal);
export const listPasswordFilesForEntries = (ownerId: string, entryIds: string[], signal?: AbortSignal, sourceIds?: string[]) =>
  accountPasswordStorage(ownerId).listFiles(entryIds, signal, sourceIds);
export const openPasswordFile = (ownerId: string, entryId: string, fileId: string, signal?: AbortSignal) =>
  accountPasswordStorage(ownerId).openFile(entryId, fileId, signal);
