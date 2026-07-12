import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';

import {
  getAuthOtpsCollection,
  getPasswordResetsCollection,
  getSessionsCollection
} from '../mongodb/collections';

import { hashPassword } from './passwords';
import { newAuthToken } from './tokens';
import { setUserPasswordHash } from './users';

const ONE_HOUR_MS = 1000 * 60 * 60;

const newToken = newAuthToken;

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
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.passwordResets,
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

// Apply the new password and invalidate every other live credential for the
// user — a reset is a credential rotation, so stolen cookies/tokens must stop
// working, AND any other outstanding single-use credential (a second reset link
// or a pending login OTP) must not survive to undo the rotation. Returns false
// when no store holds the user (deleted account) — the rotation did NOT land,
// so the caller must not report success.
export const applyPasswordReset = async (userId: string, password: string): Promise<boolean> => {
  const now = new Date();
  const rotated = await setUserPasswordHash(userId, await hashPassword(password));
  if (!rotated) return false;
  await Promise.all([
    // revoke live sessions (stolen cookies/bearer tokens stop working)
    (await getSessionsCollection()).updateMany({ userId, revokedAt: null }, { $set: { revokedAt: now } }),
    // burn any other unconsumed reset tokens for this user — a captured second
    // link must not let someone rotate the password right back
    (await getPasswordResetsCollection()).updateMany(
      { userId, consumedAt: null },
      { $set: { consumedAt: now } }
    ),
    // drop pending login OTP challenges — the old password is gone, so any
    // in-flight 2FA login started against it should not be completable
    (await getAuthOtpsCollection()).deleteMany({ userId, consumedAt: null })
  ]);
  return true;
};
