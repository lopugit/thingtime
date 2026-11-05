import type { PasswordEntry } from './model';
import type { PasswordFile } from './fileCrypto';

export type SavedPasswordFile = { id: string; entryId?: string; metadata: PasswordFile; available?: boolean };
export type PasswordExportPage = { entries: { id: string; entry: PasswordEntry }[]; nextCursor: string | null };

/** The archive and attachment UI use one explicitly selected backend. A local
 * implementation must never fall back to the account transport. */
export interface PasswordStorage {
  exportPage(cursor?: string, signal?: AbortSignal): Promise<PasswordExportPage>;
  listFiles(entryIds: string[], signal?: AbortSignal, sourceIds?: string[]): Promise<SavedPasswordFile[]>;
  filesStatus?(entryId: string, signal?: AbortSignal): Promise<{ listed: boolean; unavailable: number }>;
  assertFilesAvailable?(entryIds: string[], signal?: AbortSignal): Promise<void>;
  uploadFile(entryId: string, metadata: PasswordFile, open: () => ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<SavedPasswordFile>;
  openFile(entryId: string, fileId: string, signal?: AbortSignal): Promise<{ metadata: PasswordFile; stream: ReadableStream<Uint8Array> }>;
  removeFile(entryId: string, fileId: string, signal?: AbortSignal): Promise<void>;
}
