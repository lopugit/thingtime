import { canonicalAttachmentCrystal, canonicalLinkedAttachmentUrl, linkedAttachmentNameForUrl, linkedMediaTypeForUrl, sanitizeAttachmentPublicMetadata } from '../api/utils/attachments/attachmentCore';
import { transferAnnotations, type TransferFile, type TransferLink } from '../utils/thingTransfer/format';
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

/** Linked galleries retain URL metadata only. This marker cannot claim stored
 * bytes, upload approval, account ownership or a server attachment receipt. */
export type LocalLinkedAttachment = LocalThing & { localLinkedAttachment: { purpose: 'post' | 'comment'; order: number; requestId?: string; draftId?: string; expiresAt?: string } };
export type LocalMediaAttachment = LocalAttachment | LocalLinkedAttachment;
/** Public projections add IDs and moderation fields outside their crystal.
 * Validate only canonical content; never copy those fields into local authority. */
export const publicAttachmentCrystal = (value: unknown) => {
 const sanitized = sanitizeAttachmentPublicMetadata(value);
 if (!sanitized.ok) return null;
 if (value && typeof value === 'object' && 'url' in value) return canonicalAttachmentCrystal({ ...sanitized.crystal, url: value.url, mediaKind: (value as {mediaKind?: unknown}).mediaKind });
 return sanitized.crystal;
};
export const isLocalLinkedAttachment = (row: LocalThing): row is LocalLinkedAttachment =>
 row.thingtime.length === 1 && row.thingtime[0] === 'attachment' && !!(row as LocalLinkedAttachment).localLinkedAttachment && !isLocalAttachment(row);
export const isLocalMediaAttachment = (row: LocalThing): row is LocalAttachment | LocalLinkedAttachment => isLocalAttachment(row) || isLocalLinkedAttachment(row);
export const localMediaOrder = (row: LocalAttachment | LocalLinkedAttachment) => isLocalAttachment(row) ? row.localAttachment.order : row.localLinkedAttachment.order;
export const localMediaInfo = (row: LocalMediaAttachment) => isLocalAttachment(row) ? row.localAttachment : row.localLinkedAttachment;
export const localMediaExpired = (row: LocalMediaAttachment, now = Date.now()) => !!localMediaInfo(row).expiresAt && Date.parse(localMediaInfo(row).expiresAt!) <= now;
export const createLocalLinkedAttachment = (id: string, link: TransferLink, stamp: string, purpose: 'post' | 'comment', order: number, targetId: string): LocalLinkedAttachment => {
 const url = canonicalLinkedAttachmentUrl(link.url), derived = url && linkedMediaTypeForUrl(url);
 if (!url || url !== link.url || !derived || (link.mediaKind !== 'file' && link.mediaKind !== derived.mediaKind))
  throw new WorkspaceError('INVALID_ATTACHMENT', 'Invalid linked attachment URL or media kind');
 const crystal = canonicalAttachmentCrystal({ name: linkedAttachmentNameForUrl(url), size: 0, contentType: derived.contentType, mediaKind: link.mediaKind, url, ...transferAnnotations(link) });
 if (!crystal) throw new WorkspaceError('INVALID_ATTACHMENT', 'Invalid linked attachment metadata');
 return { id, thingtime: ['attachment'], crystal: { ...crystal }, targetId, createdAt: stamp, updatedAt: stamp, revision: 1, localLinkedAttachment: { purpose, order } };
};

export const LOCAL_ATTACHMENT_DRAFT_MS = 24 * 60 * 60 * 1000;
export const localAttachmentExpired = (row: LocalAttachment, now = Date.now()) => !!row.localAttachment.expiresAt && Date.parse(row.localAttachment.expiresAt) <= now;
/** Expiring, unbound selections only. Bound drafts and committed Things never
 * depend on a timer for retention. Runs inside the caller's scoped transaction. */
export async function reapLocalAttachmentDrafts(tx: WorkspaceTransaction, now = Date.now()) {
 for (const { value: row } of await tx.list<LocalThing>('things')) if (isLocalMediaAttachment(row) && !row.targetId && !localMediaInfo(row).draftId && localMediaExpired(row, now)) {
  if (isLocalAttachment(row)) await tx.deleteBytes(row.id); await tx.delete('things', row.id);
 }
}
