import { BSON } from 'mongodb';
import { assertSessionRepositoryScope, SessionRepositoryError, type SessionRepository, type PatSessionPersistence } from '../auth/sessionRepository';
import { REVOKED_SESSION_REAP_MS } from '../auth/sessionCore';
import type { SessionDoc } from '../auth/sessions';
import type { CollectionProvider, CollectionTransaction } from './collectionContract';
import { encodeCollectionDocument } from './collectionProvider';
import { currentUserIdentityRepository } from '../auth/userIdentityRepository';
import { assertSameHomeRepositoryProvider } from '../auth/homeRepositoryScope';

/** Home-only semantic PAT operations over the exact already-open auth provider.
 * Whole operations serialize in its real transaction, including final-use and
 * token-count admission. No caller can supply a filter or driver session. */
export function createNativePatSessionPersistence(provider: CollectionProvider, namespace: string, repository: () => SessionRepository): PatSessionPersistence {
 const unavailable = (): never => { throw new SessionRepositoryError('SESSION_REPOSITORY_SCOPE', 'Invalid native personal token operation'); };
 const identity = (value: string) => { if (typeof value !== 'string' || !value || value.includes('\0')) unavailable(); };
 const time = (at: Date) => { const value = at instanceof Date ? Date.prototype.getTime.call(at) : NaN; if (!Number.isFinite(value)) unavailable(); return new Date(value); };
 const check = (selected: SessionRepository) => {
  assertSessionRepositoryScope(selected);
  const identities = currentUserIdentityRepository();
  if (!identities || identities.homePlaneId !== selected.homePlaneId) return unavailable();
  assertSameHomeRepositoryProvider(identities, selected);
 };
 const run = <T>(work: (collections: CollectionTransaction) => T): Promise<T> => {
  const selected = repository(); check(selected);
  return provider.transaction(collections => { check(selected); const result = work(collections); check(selected); return result; });
 };
 const rows = (collections: CollectionTransaction, userId: string) => {
  const result: SessionDoc[] = []; let after;
  do {
   const page = collections.collection(namespace).find({ filter: { op: 'and', filters: [{ op: 'eq', path: ['userId'], value: userId }, { op: 'eq', path: ['purpose'], value: 'pat' }] }, after, limit: 128 });
   for (const bytes of page.documents) {
    const row = BSON.deserialize(bytes) as SessionDoc;
    // SQLite has no Mongo TTL worker. Reap only this owner's expired PATs
    // while touching their catalogue/admission, using the same Date expiry.
    // Revoked non-expiring PATs already carry their canonical reap deadline.
    if (row.expiresAt instanceof Date && +row.expiresAt < Date.now()) collections.collection(namespace).deleteOne(match(userId, row.jti));
    else result.push(row);
   }
   after = page.nextAfter;
  } while (after !== null);
  return result;
 };
 const exact = (collections: CollectionTransaction, userId: string, jti: string) => {
  const found = collections.collection(namespace).find({ filter: { op: 'eq', path: ['jti'], value: jti }, limit: 2 }).documents;
  if (found.length > 1) return unavailable();
  const row = found[0] ? BSON.deserialize(found[0]) as SessionDoc : null;
  return row?.userId === userId && row.purpose === 'pat' ? row : null;
 };
 const match = (userId: string, jti: string) => ({ op: 'and' as const, filters: [{ op: 'eq' as const, path: ['jti'], value: jti }, { op: 'eq' as const, path: ['userId'], value: userId }, { op: 'eq' as const, path: ['purpose'], value: 'pat' }] });
 return Object.freeze({
  async countUnrevoked(userId) { identity(userId); return run(collections => rows(collections, userId).filter(row => row.revokedAt === null).length); },
  async insert(document, limit) {
   const checked = BSON.deserialize(encodeCollectionDocument(document, 'jti')) as SessionDoc;
   identity(checked.jti); identity(checked.userId);
   if (checked.purpose !== 'pat' || checked.revokedAt !== null || (limit !== null && (!Number.isSafeInteger(limit) || limit < 0))) return unavailable();
   return run(collections => {
    if (limit !== null && rows(collections, checked.userId).filter(row => row.revokedAt === null).length >= limit) return false;
    collections.collection(namespace).insert(BSON.serialize(checked)); return true;
   });
  },
  async list(userId, limit) {
   identity(userId); if (!Number.isSafeInteger(limit) || limit < 1) return unavailable();
   return run(collections => rows(collections, userId).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, limit));
  },
  async revokeOwned(userId, jti, at) {
   identity(userId); identity(jti); const now = time(at);
   return run(collections => {
    const row = exact(collections, userId, jti); if (!row || row.revokedAt) return row;
    const expiresAt = row.expiresAt ?? new Date(+now + REVOKED_SESSION_REAP_MS);
    const changed = collections.collection(namespace).updateOne(match(userId, jti), [{ op: 'set', path: ['revokedAt'], value: now }, { op: 'set', path: ['expiresAt'], value: expiresAt }]);
    return changed.document ? BSON.deserialize(changed.document) as SessionDoc : null;
   });
  },
  async consume(userId, jti, limited, at) {
   identity(userId); identity(jti); const now = time(at);
   return run(collections => {
    const row = exact(collections, userId, jti);
    const currentTime = Math.max(+now, Date.now());
    if (!row || row.revokedAt !== null || (row.expiresAt && +new Date(row.expiresAt) < currentTime) || limited !== (typeof row.meta?.maxUses === 'number')) return false;
    if (limited && (!Number.isSafeInteger(row.meta?.usesRemaining) || row.meta!.usesRemaining <= 0)) return false;
    const changed = collections.collection(namespace).updateOne(match(userId, jti), [
     ...(limited ? [{ op: 'increment' as const, path: ['meta', 'usesRemaining'], amount: -1 }] : []),
     { op: 'set', path: ['meta', 'lastUsedAt'], value: now }
    ]);
    return limited ? changed.modified : changed.matched;
   });
  }
 });
}
