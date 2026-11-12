import { createHash } from 'node:crypto';
import { equalContentFingerprints, validContentFingerprint, type ContentFingerprint } from '../../../fileSync/contentFingerprint.ts';
import { ATTACHMENT_BLOB_THINGTIME, isAttachmentObjectVersionId, validAttachmentBlobRef, type AttachmentBlobRef } from './attachmentCore.ts';

export const attachmentBlobId = (ownerId: string, size: number, fingerprint: ContentFingerprint) =>
  'blob-' + createHash('sha256').update(JSON.stringify([ownerId, size, fingerprint.algorithm,
    fingerprint.partSizeBytes, fingerprint.partCount, fingerprint.sha256])).digest('hex');

export type AttachmentBlobData = {
  fingerprint: ContentFingerprint;
  originAttachmentId: string;
  phase: 'staging' | 'ready' | 'deleting';
  references: number;
  objectVersionId?: string;
  deletingAttachmentId?: string;
};
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function attachmentBlobBytesForAccounting(doc: {
  thingtime?: unknown; shareId?: unknown; ownerId?: unknown; objectSizeBytes?: unknown; attachmentBlobData?: unknown;
}): number | null | undefined {
  if (!Array.isArray(doc.thingtime) || !doc.thingtime.includes(ATTACHMENT_BLOB_THINGTIME)) return undefined;
  const data = doc.attachmentBlobData as AttachmentBlobData | undefined;
  const bytes = doc.objectSizeBytes;
  if (doc.thingtime.length !== 1 || !data || typeof bytes !== 'number' || typeof doc.ownerId !== 'string' ||
    !validContentFingerprint(data.fingerprint, bytes) || doc.shareId !== attachmentBlobId(doc.ownerId, bytes, data.fingerprint) ||
    !safeId(data.originAttachmentId) || !Number.isSafeInteger(data.references)) return null;
  if (data.phase === 'staging') return data.references === 0 && data.objectVersionId === undefined && data.deletingAttachmentId === undefined ? 0 : null;
  if (!isAttachmentObjectVersionId(data.objectVersionId)) return null;
  if (data.phase === 'ready') return data.references >= 1 && data.deletingAttachmentId === undefined ? bytes : null;
  return data.phase === 'deleting' && data.references === 1 && safeId(data.deletingAttachmentId) ? bytes : null;
}

export function attachmentPhysicalObject(doc: { shareId: string; objectKey: string; objectVersionId?: string; attachmentBlob?: AttachmentBlobRef }) {
  if (!doc.attachmentBlob) return { attachmentId: doc.shareId, objectKey: doc.objectKey, versionId: doc.objectVersionId };
  if (!validAttachmentBlobRef(doc.attachmentBlob)) throw Error('Attachment content reference is invalid');
  return { attachmentId: doc.attachmentBlob.objectAttachmentId, objectKey: 'objects/' + doc.attachmentBlob.objectAttachmentId,
    versionId: doc.attachmentBlob.objectVersionId };
}

export const sameAttachmentBlobFingerprint = (expected: ContentFingerprint, found: unknown, size: number): boolean =>
  validContentFingerprint(found, size) && equalContentFingerprints(expected, found);
