import { createHash } from 'node:crypto';
import { BSON } from 'mongodb';
import { registerHomeRepositoryProvider } from '../auth/homeRepositoryScope';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { assertEmailVerificationRepositoryScope, SingleUseTokenRepositoryError, type SingleUseTokenRepository, type StoredSingleUseToken } from '../auth/singleUseTokenRepository';
import type { CollectionFilter, CollectionProvider, CollectionTransaction } from './collectionContract';
import { encodeCollectionDocument } from './collectionProvider';

export const singleUseTokenDigest = (token: string): string => `sha256:${createHash('sha256').update(token).digest('hex')}`;

/** Persistence only for explicit native email-verification home bindings. Does
 * not open a database, deliver mail, verify an account, or activate HTTP. */
export async function createNativeEmailVerificationRepository(provider: CollectionProvider, homePlaneId: string): Promise<SingleUseTokenRepository> {
 const invalid = (): never => { throw new SingleUseTokenRepositoryError('SINGLE_USE_TOKEN_RECORD', 'Invalid native email-verification record'); };
 if (typeof homePlaneId !== 'string' || !homePlaneId) throw new SingleUseTokenRepositoryError('SINGLE_USE_TOKEN_SCOPE', 'A native home-plane identity is required');
 const namespace = physicalCollectionName('emailVerifications');
 await provider.transaction(s => s.defineCollection(namespace, { unique: [{ name: 'verification-token', path: ['token'], sparse: false, multikey: false }] }));
 const issuedToken = (value: string) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
 const validTime = (value: Date) => value instanceof Date && Number.isFinite(Date.prototype.getTime.call(value));
 const filter = (token: string): CollectionFilter => {
  if (typeof token !== 'string' || !token) return invalid();
  return { op: 'eq', path: ['token'], value: singleUseTokenDigest(token) };
 };
 let repository: SingleUseTokenRepository;
 const transaction = <T>(work: (session: CollectionTransaction) => T | Promise<T>): Promise<T> => {
  assertEmailVerificationRepositoryScope(repository);
  return provider.transaction(async s => {
   assertEmailVerificationRepositoryScope(repository);
   const result = await work(s);
   assertEmailVerificationRepositoryScope(repository);
   return result;
  });
 };
 const decode = (bytes: Uint8Array | null | undefined) => bytes ? BSON.deserialize(bytes) as StoredSingleUseToken : null;
 repository = Object.freeze({
  kind: 'native-home' as const, homePlaneId,
  async insert(document: StoredSingleUseToken) {
   assertEmailVerificationRepositoryScope(repository);
   encodeCollectionDocument(document, 'token'); // Validate before spreading/serializing data.
   const bytes = encodeCollectionDocument({ ...document, token: singleUseTokenDigest(document.token) }, 'token');
   if (!issuedToken(document.token) || typeof document.userId !== 'string' || !document.userId || typeof document.email !== 'string' || !document.email || document.email !== document.email.trim().toLowerCase() || !Number.isSafeInteger(document.schemaVersion) || !validTime(document.createdAt) || !validTime(document.expiresAt) || document.consumedAt !== null) return invalid();
   await transaction(s => s.collection(namespace).insert(bytes));
  },
  async claim(token: string, now: Date) {
   const identity = filter(token);
   if (!validTime(now)) return invalid();
   const captured = now.getTime();
   return transaction(s => {
    // Queueing cannot extend credential lifetime; a future caller clock also
    // must not be weakened by substituting a smaller wall-clock timestamp.
    const at = new Date(Math.max(captured, Date.now()));
    return decode(s.collection(namespace).updateOne({ op: 'and', filters: [identity,
     { op: 'eq', path: ['consumedAt'], value: null }, { op: 'gt', path: ['expiresAt'], value: at }
    ] }, [{ op: 'set', path: ['consumedAt'], value: at }]).document);
   });
  },
  async find(token: string) {
   const identity = filter(token);
   return transaction(s => {
    const rows = s.collection(namespace).find({ filter: identity, limit: 2 }).documents;
    if (rows.length > 1) return invalid();
    return decode(rows[0]);
   });
  }
 });
 registerHomeRepositoryProvider(repository, provider);
 return repository;
}
