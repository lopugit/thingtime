import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { getAuthOtpsCollection } from '../mongodb/collections';

// Short-lived email OTP challenges (login 2FA). Only a hash of the code is
// stored — the plaintext code exists in the outbound email and nowhere else.

const OTP_TTL_MS = 1000 * 60 * 10;
const MAX_ATTEMPTS = 5;

export type OtpPurpose = 'login';

const newChallengeId = () => (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');

const hashOtpCode = (challenge: string, code: string) =>
  createHash('sha256').update(`${challenge}:${code}`).digest('hex');

export const generateOtpCode = () => String(randomInt(100000, 1000000));

export const createOtpChallenge = async ({
  userId,
  purpose,
  code,
  expiresInMs = OTP_TTL_MS
}: {
  userId: string;
  purpose: OtpPurpose;
  code: string;
  expiresInMs?: number;
}) => {
  const now = new Date();
  const challenge = newChallengeId();
  const doc = {
    challenge,
    userId,
    purpose,
    codeHash: hashOtpCode(challenge, code),
    attempts: 0,
    createdAt: now,
    expiresAt: new Date(now.getTime() + expiresInMs),
    consumedAt: null as Date | null
  };
  await (await getAuthOtpsCollection()).insertOne(doc);
  return { challenge, expiresAt: doc.expiresAt };
};

export type ConsumeOtpResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'wrong_code' | 'too_many_attempts' };

// Verify + burn an OTP challenge. The attempt counter increments atomically
// BEFORE the code comparison so a brute-force loop can't retry forever.
export const consumeOtpChallenge = async ({
  challenge,
  code,
  purpose
}: {
  challenge: string;
  code: string;
  purpose: OtpPurpose;
}): Promise<ConsumeOtpResult> => {
  if (typeof challenge !== 'string' || !challenge || typeof code !== 'string' || !code) {
    return { ok: false, reason: 'invalid' };
  }

  const coll = await getAuthOtpsCollection();
  const now = new Date();

  const doc = await coll.findOneAndUpdate(
    {
      challenge,
      purpose,
      consumedAt: null,
      expiresAt: { $gt: now },
      attempts: { $lt: MAX_ATTEMPTS }
    },
    { $inc: { attempts: 1 } },
    { returnDocument: 'after' }
  );
  if (!doc) {
    const existing = await coll.findOne({ challenge, purpose });
    if (!existing || existing.consumedAt) return { ok: false, reason: 'invalid' };
    if (existing.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };
    return { ok: false, reason: 'expired' };
  }

  const expected = Buffer.from(doc.codeHash, 'hex');
  const provided = Buffer.from(hashOtpCode(challenge, code.trim()), 'hex');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, reason: doc.attempts >= MAX_ATTEMPTS ? 'too_many_attempts' : 'wrong_code' };
  }

  // burn it — one successful verification per challenge
  const burned = await coll.findOneAndUpdate(
    { challenge, purpose, consumedAt: null },
    { $set: { consumedAt: now } },
    { returnDocument: 'after' }
  );
  if (!burned) return { ok: false, reason: 'invalid' };

  return { ok: true, userId: doc.userId };
};
