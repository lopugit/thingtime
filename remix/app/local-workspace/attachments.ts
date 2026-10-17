import { sanitizeAttachmentPublicMetadata } from '../api/utils/attachments/attachmentCore';
import { transferAnnotations, type TransferFile } from '../utils/thingTransfer/format';
import type { LocalThing } from './things';
import { WorkspaceError, type WorkspaceTransaction } from './storage';

/** Device bookkeeping is separate from the canonical public attachment crystal.
 * It never represents a server object, upload approval or moderation verdict. */
export type LocalAttachment = LocalThing & { localAttachment: { purpose: 'file' | 'recording' | 'post' | 'comment'; sha256: string; order: number; accountFileId?: string; nsfw?: true; pending?: true; requestId?: string; initialFolderId?: string | null; draftId?: string; expiresAt?: string } };
export const isLocalAttachment = (row: LocalThing): row is LocalAttachment => row.thingtime.length === 1 && row.thingtime[0] === 'attachment' && !!(row as LocalAttachment).localAttachment;
export const localAttachmentFileId = (id: string) => `${id}:bytes`;
export const createLocalAttachment = (id: string, file: TransferFile, stamp: string, purpose: LocalAttachment['localAttachment']['purpose'], order: number, placement: { folderId?: string; targetId?: string } = {}): LocalAttachment => {
 const metadata = sanitizeAttachmentPublicMetadata({ name: file.name, size: file.bytes, contentType: file.mime, ...transferAnnotations(file) });
 if (metadata.ok === false) throw new WorkspaceError('INVALID_ATTACHMENT', metadata.error);
 return { id, thingtime: ['attachment'], crystal: { ...metadata.crystal }, createdAt: stamp, updatedAt: stamp, revision: 1,
  ...placement, localAttachment: { purpose, sha256: file.sha256, order } };
};

export const LOCAL_ATTACHMENT_DRAFT_MS = 24 * 60 * 60 * 1000;
export const localAttachmentExpired = (row: LocalAttachment, now = Date.now()) => !!row.localAttachment.expiresAt && Date.parse(row.localAttachment.expiresAt) <= now;
/** Expiring, unbound selections only. Bound drafts and committed Things never
 * depend on a timer for retention. Runs inside the caller's scoped transaction. */
export async function reapLocalAttachmentDrafts(tx: WorkspaceTransaction, now = Date.now()) {
 for (const { value: row } of await tx.list<LocalThing>('things')) if (isLocalAttachment(row) && !row.targetId && !row.localAttachment.draftId && localAttachmentExpired(row, now)) {
  await tx.deleteBytes(row.id); await tx.delete('things', row.id);
 }
}
