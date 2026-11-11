import { registerHomeRepositoryProvider } from '../auth/homeRepositoryScope';
import { BSON, Binary } from 'mongodb';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { assertSessionRepositoryScope, SessionRepositoryError, type SessionRepository } from '../auth/sessionRepository';
import { REVOKED_SESSION_REAP_MS } from '../auth/sessionCore';
import type { SessionDoc } from '../auth/sessions';
import type { CollectionProvider, CollectionTransaction } from './collectionContract';
import { encodeCollectionDocument } from './collectionProvider';

/** Constructs persistence for canonical session helpers only. The supplied
 * provider is already opened by the explicit native caller. This module does
 * not import/open SQLite, select a profile, create a user or implement login.
 * Account existence/authorization stays with canonical auth callers; session
 * persistence by itself is not a credential or completed API registration. */
export async function createNativeSessionRepository(provider: CollectionProvider, homePlaneId: string): Promise<SessionRepository> {
 if (typeof homePlaneId !== 'string' || !homePlaneId) throw new SessionRepositoryError('SESSION_REPOSITORY_SCOPE', 'A native home-plane identity is required');
 const namespace = physicalCollectionName('sessions');
 await provider.transaction(s => s.defineCollection(namespace, { unique: [{ name: 'session-jti', path: ['jti'], sparse: false, multikey: false }] }));
 const filter = (jti: string) => ({ op: 'eq' as const, path: ['jti'], value: jti });
 const validateJti = (jti: string) => {
  if (typeof jti !== 'string' || !jti) throw new SessionRepositoryError('SESSION_REPOSITORY_SCOPE', 'A session identity is required');
 };
 let repository: SessionRepository;
 const transaction = <T>(work: (session: CollectionTransaction) => T): Promise<T> => {
  assertSessionRepositoryScope(repository);
  return provider.transaction(async s => { assertSessionRepositoryScope(repository); const result = await work(s); assertSessionRepositoryScope(repository); return result; });
 };
 repository = Object.freeze({
  kind: 'native-home' as const, homePlaneId,
  async insert(document: SessionDoc, callerTransaction?: unknown) {
   assertSessionRepositoryScope(repository);
   // Registration/session callers needing a wider native transaction must get
   // an explicit shared transaction capability. Never accept a driver-shaped
   // object or silently commit independently of the caller's transaction.
   if (callerTransaction !== undefined && callerTransaction !== null) throw new SessionRepositoryError('SESSION_TRANSACTION_UNSUPPORTED', 'Native caller-owned session transactions are not implemented yet');
   const bytes = encodeCollectionDocument(document, 'jti');
   await transaction(s => s.collection(namespace).insert(bytes));
  },
  async findByJti(jti: string) {
   validateJti(jti);
   return transaction(s => {
    const rows = s.collection(namespace).find({ filter: filter(jti), limit: 2 }).documents;
    if (rows.length > 1) throw new SessionRepositoryError('SESSION_REPOSITORY_SCOPE', 'Ambiguous native session identity');
    return rows[0] ? BSON.deserialize(rows[0]) as SessionDoc : null;
   });
  },
  async bindVaultEnvelope(binding) {
   assertSessionRepositoryScope(repository);
   const checked = BSON.deserialize(encodeCollectionDocument(binding,'jti'));validateJti(checked.jti);
   if (typeof checked.ownerId !== 'string' || !checked.ownerId || !(checked.envelope instanceof Binary) || !(checked.at instanceof Date) || !(checked.expiresAt === null || checked.expiresAt instanceof Date)) throw new SessionRepositoryError('SESSION_REPOSITORY_SCOPE','Invalid native session vault binding');
   return transaction(s => {
    const collection=s.collection(namespace),bytes=collection.find({filter:filter(checked.jti),limit:1}).documents[0];if(!bytes)return false;
    const stored=BSON.deserialize(bytes),now=Math.max(Date.now(),checked.at.getTime());
    if(stored.userId!==checked.ownerId||stored.revokedAt!==null||![undefined,'browser','service'].includes(stored.purpose)||!(stored.expiresAt===null||stored.expiresAt instanceof Date)||(stored.expiresAt&&stored.expiresAt.getTime()<=now))return false;
    if((stored.expiresAt===null)!==(checked.expiresAt===null)||(stored.expiresAt&&stored.expiresAt.getTime()!==checked.expiresAt.getTime()))return false;
    return collection.updateOne({op:'and',filters:[filter(checked.jti),{op:'eq',path:['userId'],value:checked.ownerId},{op:'eq',path:['revokedAt'],value:null},{op:'eq',path:['expiresAt'],value:checked.expiresAt}]},[{op:'set',path:['secureVaultKey'],value:checked.envelope}]).matched;
   });
  },
  async revoke(jti: string, at: Date) {
   validateJti(jti);
   const milliseconds = at instanceof Date ? Date.prototype.getTime.call(at) : NaN;
   if (!Number.isFinite(milliseconds)) throw new SessionRepositoryError('SESSION_REPOSITORY_SCOPE', 'A valid revocation time is required');
   const revokedAt = new Date(milliseconds);
   await transaction(s => {
    const collection = s.collection(namespace), row = collection.find({ filter: filter(jti), limit: 1 }).documents[0];
    if (!row) return;
    const stored = BSON.deserialize(row, { promoteValues: false });
    const expiresAt = stored.expiresAt ?? new Date(revokedAt.getTime() + REVOKED_SESSION_REAP_MS);
    collection.updateOne(filter(jti), [
     { op: 'set', path: ['revokedAt'], value: revokedAt },
     { op: 'set', path: ['expiresAt'], value: expiresAt },
     { op: 'unset', path: ['secureVaultKey'] }
    ]);
   });
  }
 });
 registerHomeRepositoryProvider(repository, provider);
 return repository;
}
