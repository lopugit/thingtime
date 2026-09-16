import { applyAttachmentAnnotationPatch, type AttachmentAnnotationPatch } from './attachmentCore';
import type { AttachmentDoc } from './attachmentStore';
import { ACL_OWNER } from '../../../schemas/registry';

/** Purpose never changes. Only server-minted recording import drafts may
 * become durable through import; existing recordings cannot be replayed. */
export const prepareRecordingImport = (
  before: AttachmentDoc, ownerId: string, expectedBytes: number,
  patch: AttachmentAnnotationPatch = {}, now = new Date()
): AttachmentDoc => {
  if (before.ownerId !== ownerId || before.attachmentState !== 'ready' ||
    before.attachmentPurpose !== 'recording' || before.attachmentImportDraft !== true ||
    before.attachmentLinked || before.targetId || before.attachmentProfileSlot ||
    !(before.attachmentExpiresAt instanceof Date) || !Number.isFinite(before.attachmentExpiresAt.getTime()) ||
    before.attachmentExpiresAt <= now || !Number.isSafeInteger(expectedBytes) || expectedBytes < 0 ||
    before.crystal.size !== expectedBytes || before.objectSizeBytes !== expectedBytes) {
    throw new Error('Import requires a fresh, ready, owned recording upload with matching bytes');
  }
  const annotated = applyAttachmentAnnotationPatch(before.crystal, patch);
  if (annotated.ok === false) throw new Error(annotated.error);
  const next: AttachmentDoc = { ...before, crystal: annotated.crystal, acl: [ACL_OWNER], updatedAt: now };
  delete next.attachmentImportDraft;
  delete next.attachmentExpiresAt;
  return next;
};

export const isDurableRecordingUpload = (doc: Pick<AttachmentDoc, 'attachmentPurpose' | 'attachmentImportDraft'>) =>
  doc.attachmentPurpose === 'recording' && doc.attachmentImportDraft !== true;
