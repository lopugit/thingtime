import { createHash } from 'node:crypto';
import { BSON } from 'mongodb';
import type { ConsumeTokenResult } from '../auth/singleUseTokens';
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
 type CompletionRecord = StoredSingleUseToken & { completionState?: 'pending' | 'completed'; completionOwnerId?: string; completionEmail?: string };
 const decode = (bytes: Uint8Array | null | undefined) => bytes ? BSON.deserialize(bytes) as CompletionRecord : null;
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
  async completeVerification(token: string, mark: (userId: string, email: string) => Promise<boolean>): Promise<ConsumeTokenResult> {
   const identity = filter(token);
   assertEmailVerificationRepositoryScope(repository);
   const admitted = await transaction(s => {
    const collection = s.collection(namespace), row = decode(collection.find({ filter: identity, limit: 1 }).documents[0]);
    if (!row) return { ok: false as const, reason: 'invalid' as const };
    // Never resurrect an old consume-only burn or a completed operation.
    if (row.completionState === 'completed' || (row.consumedAt !== null && row.completionState !== 'pending')) return { ok: false as const, reason: 'used' as const };
    const at = new Date();
    if (!validTime(row.expiresAt) || row.expiresAt.getTime() <= at.getTime()) return { ok: false as const, reason: 'expired' as const };
    if (typeof row.userId !== 'string' || !row.userId || typeof row.email !== 'string' || !row.email || row.email !== row.email.trim().toLowerCase()) return invalid();
    if (row.completionState === 'pending') {
     if (!(row.consumedAt instanceof Date) || row.completionOwnerId !== row.userId || row.completionEmail !== row.email) return invalid();
    } else {
     if (row.completionState !== undefined || row.consumedAt !== null) return invalid();
     collection.updateOne(identity, [
      { op: 'set', path: ['consumedAt'], value: at },
      { op: 'set', path: ['completionState'], value: 'pending' },
      { op: 'set', path: ['completionOwnerId'], value: row.userId },
      { op: 'set', path: ['completionEmail'], value: row.email }
     ]);
    }
    return { ok: true as const, userId: row.userId, email: row.email };
   });
   if (admitted.ok === false) return admitted;
   // Token transaction is committed before invoking canonical secure CAS.
   // A throw/false leaves durable pending; no nested provider transaction.
   assertEmailVerificationRepositoryScope(repository);
   const verified = await mark(admitted.userId, admitted.email);
   assertEmailVerificationRepositoryScope(repository);
   if (!verified) return { ok: false, reason: 'invalid' };
   return transaction(s => {
    const collection = s.collection(namespace), row = decode(collection.find({ filter: identity, limit: 1 }).documents[0]);
    if (!row) return { ok: false as const, reason: 'invalid' as const };
    if (row.completionState === 'completed') return { ok: false as const, reason: 'used' as const };
    if (row.completionState !== 'pending' || row.userId !== admitted.userId || row.email !== admitted.email || row.completionOwnerId !== admitted.userId || row.completionEmail !== admitted.email) return invalid();
    collection.updateOne(identity, [
     { op: 'set', path: ['completionState'], value: 'completed' },
     { op: 'set', path: ['completedAt'], value: new Date() }
    ]);
    return admitted;
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
