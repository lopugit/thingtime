import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';

import {
  getAuthOtpsCollection,
  getPasswordResetsCollection,
  getSessionsCollection
} from '../mongodb/collections';

import { hashPassword } from './passwords';
import { revokedSessionPatch } from './sessions';
import { consumeSingleUseToken, createSingleUseToken, type ConsumeTokenResult } from './singleUseTokens';
import { setUserPasswordHash } from './users';

const ONE_HOUR_MS = 1000 * 60 * 60;

// Issue a single-use, time-limited password reset token. Thin wrapper over the
// shared single-use-token helper (see singleUseTokens.ts) — the same machinery
// behind email verification, so a hardening fix reaches both credentials.
export const createPasswordReset = ({
  userId,
  email,
  expiresInMs = ONE_HOUR_MS
}: {
  userId: string;
  email: string;
  expiresInMs?: number;
}) =>
  createSingleUseToken({
    getCollection: getPasswordResetsCollection,
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.passwordResets,
    userId,
    email,
    expiresInMs
  });

export type ConsumePasswordResetResult = ConsumeTokenResult;

// Validate + burn a reset token atomically (two racing submits: one wins).
export const consumePasswordReset = (token: string): Promise<ConsumePasswordResetResult> =>
  consumeSingleUseToken(getPasswordResetsCollection, token);

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
    // Revoke live sessions (stolen cookies/bearer tokens stop working). This is
    // the one sweep that hits every purpose the user owns at once, including the
    // never-expiring ones (service accounts, PATs, the ChatGPT MCP bridge), so
    // it is also the widest source of unreapable rows: the sessions TTL index
    // skips expiresAt: null, and a plain `$set: { revokedAt }` would strand each
    // of those documents in Mongo forever. revokedSessionPatch fills a missing
    // expiry and preserves a real one, so a browser session keeps its own TTL.
    // Aggregation-pipeline form is required — $ifNull only resolves in one.
    (await getSessionsCollection()).updateMany({ userId, revokedAt: null }, [
      { $set: revokedSessionPatch(now) }
    ]),
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
