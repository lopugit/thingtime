import { validSyncPath } from './reconcile';
export type FileSyncUploadOrigin = { version: 1; deviceId: string; localRootId: string; cloudRootId?: string; fileId: string; folderId: string | null; path: string };
const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
/** Private diagnostic provenance, never a folder grant or mutation authority. */
export function parseFileSyncUploadOrigin(value: unknown): FileSyncUploadOrigin {
  const row = value as FileSyncUploadOrigin;
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(key => !['version', 'deviceId', 'localRootId', 'cloudRootId', 'fileId', 'folderId', 'path'].includes(key)) || row.version !== 1 ||
    !id(row.deviceId) || !id(row.localRootId) || !id(row.fileId) || (row.cloudRootId !== undefined && !id(row.cloudRootId)) ||
    (row.folderId !== null && !id(row.folderId)) || !validSyncPath(row.path) || /^[A-Za-z]:/.test(row.path)) throw Error('Invalid sync upload origin');
  return { version: 1, deviceId: row.deviceId, localRootId: row.localRootId, ...(row.cloudRootId ? { cloudRootId: row.cloudRootId } : {}), fileId: row.fileId, folderId: row.folderId, path: row.path };
}
export const sameFileSyncUploadOrigin = (a: unknown, b: unknown) => {
  try { return JSON.stringify(parseFileSyncUploadOrigin(a)) === JSON.stringify(parseFileSyncUploadOrigin(b)); } catch { return false; }
};
export function ownerFileSyncUploadOrigin(doc: { ownerId?: string; attachmentFileSyncOrigin?: unknown }, ownerId: string | undefined): FileSyncUploadOrigin | undefined {
  if (!ownerId || doc.ownerId !== ownerId || !doc.attachmentFileSyncOrigin) return;
  try { return parseFileSyncUploadOrigin(doc.attachmentFileSyncOrigin); } catch { return; }
}
