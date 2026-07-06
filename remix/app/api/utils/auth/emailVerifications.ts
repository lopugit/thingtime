import { getEmailVerificationsCollection } from '../mongodb/collections';

const TWENTY_FOUR_HOURS_MS = 1000 * 60 * 60 * 24;

const newToken = () => (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');

// Issue a single-use, time-limited email verification token.
export const createEmailVerification = async ({
  userId,
  email,
  expiresInMs = TWENTY_FOUR_HOURS_MS
}: {
  userId: string;
  email: string;
  expiresInMs?: number;
}) => {
  const now = new Date();
  const doc = {
    token: newToken(),
    userId,
    email: email.trim().toLowerCase(),
    createdAt: now,
    expiresAt: new Date(now.getTime() + expiresInMs),
    consumedAt: null as Date | null
  };
  await (await getEmailVerificationsCollection()).insertOne(doc);
  return doc;
};

export type ConsumeResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: 'invalid' | 'used' | 'expired' };

// Validate + burn a token atomically. Single-use: if two clicks race, only one
// update can match consumedAt: null; the loser sees the token as used.
export const consumeEmailVerification = async (token: string): Promise<ConsumeResult> => {
  const coll = await getEmailVerificationsCollection();
  const now = new Date();

  const consumed = await coll.findOneAndUpdate(
    {
      token,
      consumedAt: null,
      expiresAt: { $gt: now }
    },
    { $set: { consumedAt: now } },
    { returnDocument: 'after' }
  );

  if (consumed) return { ok: true, userId: consumed.userId, email: consumed.email };

  const doc = await coll.findOne({ token });
  if (!doc) return { ok: false, reason: 'invalid' };
  if (doc.consumedAt) return { ok: false, reason: 'used' };
  return { ok: false, reason: 'expired' };
};
