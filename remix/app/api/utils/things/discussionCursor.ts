import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const PURPOSE = 'thingtime:discussion-cursor:v1';
const MAX_CURSOR_BYTES = 1024;
const CURSOR_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const developmentKey = randomBytes(32);
export type DiscussionCursorScope = { targetId: string; viewerId: string; tokenId: string };
export type DiscussionCursor = { createdAt: Date; id: string };

// Reuse deployment signing authority, with a separate purpose-derived key.
// Never use the public JWT key or the predictable development JWT fallback.
const cursorKey = (): Buffer | null => {
  const source = process.env.JWT_PRIVATE_KEY?.trim() || process.env.JWT_SECRET?.trim() || process.env.THINGTIME_ADMIN_VAULT_KEY?.trim();
  if (source) return createHmac('sha256', source).update(PURPOSE).digest();
  return process.env.NODE_ENV === 'production' ? null : developmentKey;
};
const aad = (scope: DiscussionCursorScope) => Buffer.from(JSON.stringify([PURPOSE, scope.targetId, scope.viewerId, scope.tokenId]));
export const discussionCursorConfigured = () => cursorKey() !== null;

export const encodeDiscussionCursor = (value: DiscussionCursor, scope: DiscussionCursorScope): string => {
  const key = cursorKey();
  if (!key) throw new Error('Discussion cursor signing authority is unavailable');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(scope));
  // The scanned id can belong to a denied hidden row. Encryption, not merely
  // a signed/base64 cursor, is necessary because that id is a link capability.
  const plain = JSON.stringify([1, +value.createdAt, value.id, Date.now() + CURSOR_LIFETIME_MS]);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `dc1.${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')}`;
};

export const decodeDiscussionCursor = (cursor: unknown, scope: DiscussionCursorScope): DiscussionCursor | null => {
  if (typeof cursor !== 'string' || cursor.length > MAX_CURSOR_BYTES || !/^dc1\.[A-Za-z0-9_-]+$/.test(cursor)) return null;
  const key = cursorKey();
  if (!key) return null;
  try {
    const encoded = cursor.slice(4), bytes = Buffer.from(encoded, 'base64url');
    if (bytes.length < 29 || bytes.toString('base64url') !== encoded) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(aad(scope)); decipher.setAuthTag(bytes.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
    if (!Array.isArray(value) || value.length !== 4 || value[0] !== 1 || !Number.isSafeInteger(value[1]) || !Number.isFinite(new Date(value[1]).getTime()) ||
      typeof value[2] !== 'string' || !value[2] || value[2].length > 128 || /[$.\s\u0000-\u001f]/.test(value[2]) ||
      !Number.isSafeInteger(value[3]) || value[3] < Date.now() || value[3] > Date.now() + CURSOR_LIFETIME_MS + 5 * 60 * 1000) return null;
    return { createdAt: new Date(value[1]), id: value[2] };
  } catch { return null; }
};
