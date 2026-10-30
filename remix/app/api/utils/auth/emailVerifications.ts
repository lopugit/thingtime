import { getEmailVerificationsCollection } from '../mongodb/collections';
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
    getCollection: getEmailVerificationsCollection,
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.emailVerifications,
    userId,
    email,
    expiresInMs
  });

export type ConsumeResult = ConsumeTokenResult;

// Validate + burn a token atomically. Single-use: if two clicks race, only one
// update can match consumedAt: null; the loser sees the token as used.
export const consumeEmailVerification = (token: string): Promise<ConsumeResult> =>
  consumeSingleUseToken(getEmailVerificationsCollection, token);
