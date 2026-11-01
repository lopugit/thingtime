import type { AttachmentDoc } from './attachmentStore';

/** Server-generated attempt identity, never read from a portable manifest.
 * It fences duplicate/uncertain commits from pre-existing emoji records. */
export type EmojiImportAttempt = {
  id: string;
  bytes: number;
  mime: string;
};

export const validateEmojiImportAttempt = (attempt: EmojiImportAttempt): void => {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(attempt.id) ||
    attempt.id.length !== 36 || !Number.isSafeInteger(attempt.bytes) || attempt.bytes <= 0 ||
    attempt.bytes > 512 * 1024 || !['image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(attempt.mime)) {
    throw new Error('Invalid emoji import attempt');
  }
};

/** Must run again inside the emoji insert/bind transaction. A preflight
 * alone cannot stop two imports from claiming the same ready upload. */
export const assertFreshEmojiImport = (
  doc: AttachmentDoc | null, ownerId: string, attempt: EmojiImportAttempt, now = new Date()
): void => {
  validateEmojiImportAttempt(attempt);
  if (!doc || !ownerId || doc.ownerId !== ownerId ||
    doc.thingtime.length !== 1 || doc.thingtime[0] !== 'attachment' ||
    doc.attachmentState !== 'ready' || doc.attachmentPurpose !== 'emoji' ||
    doc.targetId != null || doc.attachmentLinked || doc.attachmentProfileSlot != null ||
    doc.attachmentImportDraft || doc.moderation?.status === 'blocked' ||
    !(doc.attachmentExpiresAt instanceof Date) || !Number.isFinite(doc.attachmentExpiresAt.getTime()) ||
    !Number.isFinite(now.getTime()) || doc.attachmentExpiresAt <= now ||
    doc.crystal.mediaKind !== 'image' || doc.crystal.contentType !== attempt.mime ||
    doc.crystal.size !== attempt.bytes || doc.objectSizeBytes !== attempt.bytes) {
    throw new Error('Emoji import requires a fresh, ready, owned image upload with matching bytes');
  }
};

export const matchesEmojiImportAttempt = (
  existing: { emojiImportAttemptId?: unknown } | null, attempt: EmojiImportAttempt
): boolean => {
  validateEmojiImportAttempt(attempt);
  return !!existing && existing.emojiImportAttemptId === attempt.id;
};
