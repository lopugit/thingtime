import { ObjectId } from 'mongodb';

import { getPasswordResetsCollection, getSessionsCollection, getUsersCollection } from '../mongodb/collections';

import { hashPassword } from './passwords';

const ONE_HOUR_MS = 1000 * 60 * 60;

const newToken = () => (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');

// Issue a single-use, time-limited password reset token — mirrors the
// emailVerifications token pattern (single-use burn, short TTL).
export const createPasswordReset = async ({
  userId,
  email,
  expiresInMs = ONE_HOUR_MS
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
  await (await getPasswordResetsCollection()).insertOne(doc);
  return doc;
};

export type ConsumePasswordResetResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: 'invalid' | 'used' | 'expired' };

// Validate + burn a reset token atomically (two racing submits: one wins).
export const consumePasswordReset = async (token: string): Promise<ConsumePasswordResetResult> => {
  const coll = await getPasswordResetsCollection();
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

// Apply the new password and revoke every live session for the user — a reset
// is a credential rotation, so stolen cookies/tokens must stop working too.
export const applyPasswordReset = async (userId: string, password: string) => {
  await (await getUsersCollection()).updateOne(
    { _id: new ObjectId(userId) },
    { $set: { passwordHash: await hashPassword(password), updatedAt: new Date() } }
  );
  await (await getSessionsCollection()).updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
};
