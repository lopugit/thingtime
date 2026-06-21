import { getEmailVerificationsCollection } from '../mongodb/collections';

const TWENTY_FOUR_HOURS_MS = 1000 * 60 * 60 * 24;

const newToken = () => (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');

// Issue a single-use, time-limited email verification token.
export const createEmailVerification = async ({ userId, email }: { userId: string; email: string }) => {
  const now = new Date();
  const doc = {
    token: newToken(),
    userId,
    email: email.trim().toLowerCase(),
    createdAt: now,
    expiresAt: new Date(now.getTime() + TWENTY_FOUR_HOURS_MS),
    consumedAt: null as Date | null
  };
  await (await getEmailVerificationsCollection()).insertOne(doc);
  return doc;
};

export type ConsumeResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: 'invalid' | 'used' | 'expired' };

// Validate + burn a token. Single-use: a second click returns 'used'.
export const consumeEmailVerification = async (token: string): Promise<ConsumeResult> => {
  const coll = await getEmailVerificationsCollection();
  const doc = await coll.findOne({ token });
  if (!doc) return { ok: false, reason: 'invalid' };
  if (doc.consumedAt) return { ok: false, reason: 'used' };
  if (doc.expiresAt && new Date(doc.expiresAt).getTime() < Date.now()) return { ok: false, reason: 'expired' };
  await coll.updateOne({ _id: doc._id }, { $set: { consumedAt: new Date() } });
  return { ok: true, userId: doc.userId, email: doc.email };
};
