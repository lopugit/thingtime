import { BSON, Binary, ObjectId } from 'mongodb';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { assertUserIdentityRepositoryScope, UserIdentityRepositoryError, withHomeAuthRepositories, type UserIdentityRepository } from '../auth/userIdentityRepository';
import type { CollectionFilter, CollectionProvider, CollectionTransaction } from './collectionContract';
import { encodeCollectionDocument } from './collectionProvider';
import { createNativeSessionRepository } from './nativeSessions';
import { defineNativeThingsCollection } from './nativeThingsCollection';

/** Identity + sessions share one already-open native home provider. Canonical
 * insertUser builds every account envelope. This does not create a signup path:
 * subscriptions, vault/roster/verification/outbox, request readiness and wider
 * signup transactions are not adapted. No runtime selects this repository.
 * Lookups scan stored rows, with processing batches rather than row caps.
 * Batch reads use one scan/transaction; OR-filter evaluation still costs up to
 * O(rows * requested keys), not an indexed lookup. */
export async function createNativeHomeAuthRepositories(provider: CollectionProvider, homePlaneId: string) {
 const sessions = await createNativeSessionRepository(provider, homePlaneId);
 const namespace = physicalCollectionName('things');
 await provider.transaction(defineNativeThingsCollection);
 const validateIdentity = (thing: Record<string, unknown>) => {
  if (typeof thing.shareId !== 'string' || !/^[a-f0-9]{24}$/.test(thing.shareId) || !ObjectId.isValid(thing.shareId) || thing.ownerId !== thing.shareId ||
      !Array.isArray(thing.thingtime) || thing.thingtime.length !== 1 || thing.thingtime[0] !== 'user' || !(thing.secure instanceof Binary))
   throw new UserIdentityRepositoryError('USER_IDENTITY_SCOPE', 'Invalid native self-owned user identity');
 };
 let identities: UserIdentityRepository;
 const transaction = <T>(work: (session: CollectionTransaction) => T): Promise<T> => {
  assertUserIdentityRepositoryScope(identities);
  return provider.transaction(s => { assertUserIdentityRepositoryScope(identities); return work(s); });
 };
 const read = (filter: CollectionFilter) => transaction(s => {
  const rows = s.collection(namespace).find({ filter: { op: 'and', filters: [
   { op: 'contains', path: ['thingtime'], value: 'user' }, filter
  ] }, limit: 2 }).documents;
  if (rows.length > 1) throw new UserIdentityRepositoryError('USER_IDENTITY_SCOPE', 'Ambiguous native user identity');
  if (!rows[0]) return null;
  const thing = BSON.deserialize(rows[0]); validateIdentity(thing); return thing;
 });
 const readMany = (path: string[], requested: readonly string[]) => {
  assertUserIdentityRepositoryScope(identities);
  const values = [...new Set(requested)];
  if (!values.length) return Promise.resolve([]);
  // One full collection scan/transaction, not one scan per requested identity.
  return transaction(s => {
   const rows = s.collection(namespace).find({ filter: { op: 'and', filters: [
    { op: 'contains', path: ['thingtime'], value: 'user' },
    { op: 'or', filters: values.map(value => ({ op: 'eq', path, value })) }
   ] }, limit: values.length + 1 }).documents.map(bytes => BSON.deserialize(bytes));
   const seen = new Set<string>();
   for (const row of rows) {
    validateIdentity(row);
    const value = path.length === 1 ? row.shareId : row.crystal?.username;
    if (typeof value !== 'string' || seen.has(value)) throw new UserIdentityRepositoryError('USER_IDENTITY_SCOPE', 'Ambiguous native user identity');
    seen.add(value);
   }
   return rows;
  });
 };
 identities = Object.freeze({
  homePlaneId,
  async insertUserThing(thing, callerTransaction?: unknown) {
   assertUserIdentityRepositoryScope(identities);
   if (callerTransaction !== undefined && callerTransaction !== null) throw new UserIdentityRepositoryError('USER_IDENTITY_TRANSACTION_UNSUPPORTED', 'Native signup-wide transactions are not implemented');
   // Validation runs before serialization, which must not execute BSON hooks.
   const bytes = encodeCollectionDocument(thing, 'shareId');
   validateIdentity(BSON.deserialize(bytes));
   await transaction(s => s.collection(namespace).insert(bytes));
  },
  findUserThingByUsername: async username => read({ op: 'eq', path: ['crystal', 'username'], value: username }),
  findUserThingByEmailKey: async key => read({ op: 'contains', path: ['uniqueKeys'], value: key }),
  findUserThingById: async id => read({ op: 'eq', path: ['shareId'], value: id }),
  findUserThingsByUsernames: async names => readMany(['crystal', 'username'], names),
  findUserThingsByIds: async ids => readMany(['shareId'], ids)
 });
 return Object.freeze({ identities, sessions, run: <T>(work: () => T | Promise<T>) => withHomeAuthRepositories(identities, sessions, work) });
}
