import { newAuthToken } from './tokens';
import { mongoSingleUseTokenRepository, type SingleUseTokenCollectionGetter, type SingleUseTokenRepository, type StoredSingleUseToken } from './singleUseTokenRepository';

/** Issued token returned only to the caller delivering the credential. Stored
 * encoding belongs to the selected semantic persistence adapter. */
export type SingleUseTokenDoc = StoredSingleUseToken;
export type ConsumeTokenResult =
 | { ok: true; userId: string; email: string }
 | { ok: false; reason: 'invalid' | 'used' | 'expired' };
const repositoryOf = (source: SingleUseTokenRepository | SingleUseTokenCollectionGetter) =>
 typeof source === 'function' ? mongoSingleUseTokenRepository(source) : source;

export const createSingleUseToken = async (options: {
 schemaVersion: number; userId: string; email: string; expiresInMs: number;
} & ({ getCollection: SingleUseTokenCollectionGetter; repository?: never } | { repository: SingleUseTokenRepository; getCollection?: never })): Promise<SingleUseTokenDoc> => {
 const { schemaVersion, userId, email, expiresInMs } = options;
 const now = new Date();
 const doc: SingleUseTokenDoc = {
  token: newAuthToken(), userId, email: email.trim().toLowerCase(), schemaVersion,
  createdAt: now, expiresAt: new Date(now.getTime() + expiresInMs), consumedAt: null
 };
 const repository = repositoryOf(options.repository ?? options.getCollection!);
 await repository.insert(doc);
 return doc;
};

export const consumeSingleUseToken = async (
 source: SingleUseTokenRepository | SingleUseTokenCollectionGetter, token: string
): Promise<ConsumeTokenResult> => {
 if (typeof token !== 'string' || !token) return { ok: false, reason: 'invalid' };
 const repository = repositoryOf(source), now = new Date();
 const consumed = await repository.claim(token, now);
 if (consumed) return { ok: true, userId: consumed.userId, email: consumed.email };
 const doc = await repository.find(token);
 if (!doc) return { ok: false, reason: 'invalid' };
 if (doc.consumedAt) return { ok: false, reason: 'used' };
 return { ok: false, reason: 'expired' };
};
