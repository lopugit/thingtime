import { findUserById, markEmailVerified } from './users';
import { currentUserIdentityRepository } from './userIdentityRepository';
import { assertSameHomeRepositoryProvider } from './homeRepositoryScope';
import { assertEmailVerificationRepositoryScope, SingleUseTokenRepositoryError, currentEmailVerificationRepository } from './singleUseTokenRepository';
import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';

import { consumeSingleUseToken, createSingleUseToken, type ConsumeTokenResult } from './singleUseTokens';

const TWENTY_FOUR_HOURS_MS = 1000 * 60 * 60 * 24;

// Issue a single-use, time-limited email verification token. Thin wrapper over
// the shared single-use-token helper (see singleUseTokens.ts).
export const createEmailVerification = ({
  userId,
  email,
  expiresInMs = TWENTY_FOUR_HOURS_MS
}: {
  userId: string;
  email: string;
  expiresInMs?: number;
}) =>
  createSingleUseToken({
    repository: currentEmailVerificationRepository(),
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.emailVerifications,
    userId,
    email,
    expiresInMs
  });

export type ConsumeResult = ConsumeTokenResult;

// Validate + burn a token atomically. Single-use: if two clicks race, only one
// update can match consumedAt: null; the loser sees the token as used.
export const consumeEmailVerification = (token: string): Promise<ConsumeResult> =>
  consumeSingleUseToken(currentEmailVerificationRepository(), token);

/** Route-facing operation: hosted order stays consume -> canonical mark. Native
 * proof admission is durable, so a failed canonical mark can retry the SAME
 * proof until its original expiry; completed/legacy-burned proofs stay used. */
export async function completeEmailVerification(token: string): Promise<ConsumeResult> {
 if (typeof token !== 'string' || !token) return { ok: false, reason: 'invalid' };
 const repository = currentEmailVerificationRepository();
 if (repository.kind === 'mongo-home') {
  const result = await consumeSingleUseToken(repository, token);
  if (result.ok === true) await markEmailVerified(result.userId);
  return result;
 }
 const identity = currentUserIdentityRepository();
 if (!identity || identity.homePlaneId !== repository.homePlaneId || !repository.completeVerification)
  throw new SingleUseTokenRepositoryError('SINGLE_USE_TOKEN_SCOPE', 'Native verification completion requires its canonical identity home');
 assertSameHomeRepositoryProvider(identity, repository);
 return repository.completeVerification(token, async (userId, email) => {
  assertEmailVerificationRepositoryScope(repository);
  const owner = await findUserById(userId);
  assertEmailVerificationRepositoryScope(repository);
  if (!owner || String(owner._id) !== userId || typeof owner.email !== 'string' || owner.email.trim().toLowerCase() !== email) return false;
  return markEmailVerified(userId, email); // Expected address is fenced inside canonical secure CAS too.
 });
}
