import { registerHomeRepositoryProvider } from '../auth/homeRepositoryScope';
import { BSON, Binary, ObjectId, Int32, Double, Long } from 'mongodb';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { assertUserIdentityRepositoryScope, userIdentityScopeToken, UserIdentityRepositoryError, withHomeAuthRepositories, type UserIdentityRepository, type UserSecureSnapshot } from '../auth/userIdentityRepository';
import type { CollectionFilter, CollectionProvider, CollectionTransaction } from './collectionContract';
import { encodeCollectionDocument } from './collectionProvider';
import { createNativeSessionRepository } from './nativeSessions';
import { defineNativeThingsCollection } from './nativeThingsCollection';
import { insertNativeAccountIdentity } from './nativeAccountTransaction';

/** Identity + sessions share one already-open native home provider. Canonical
 * insertUser builds every account envelope. This does not create a signup path:
 * this identity-only factory has no subscription or account transaction scope.
 * The separate account-creation adapter binds those explicitly. Vault, roster,
 * verification/outbox and HTTP readiness remain absent. No runtime selects it.
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
 const snapshots = new WeakMap<UserSecureSnapshot, { scope: object; id: any; owner: string; version: any; secure: Binary }>();
 let identities: UserIdentityRepository;
 const transaction = <T>(work: (session: CollectionTransaction) => T): Promise<T> => {
  assertUserIdentityRepositoryScope(identities);
  return provider.transaction(async s => { assertUserIdentityRepositoryScope(identities); const result = await work(s); assertUserIdentityRepositoryScope(identities); return result; });
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
   // Admission/encoding belongs inside the account poison boundary too: a
   // caught malformed second insert must roll back a completed user+ledger.
   const encode = () => {
    const bytes = encodeCollectionDocument(thing, 'shareId');
    validateIdentity(BSON.deserialize(bytes));
    return bytes;
   };
   if (callerTransaction !== undefined && callerTransaction !== null) {
    try { insertNativeAccountIdentity(provider, identities, callerTransaction, encode); }
    catch(error) { if ((error as {code?:string}).code === 'ACCOUNT_CREATION_SCOPE') throw new UserIdentityRepositoryError('USER_IDENTITY_TRANSACTION_UNSUPPORTED', 'Native account transaction does not match this identity provider'); throw error; }
   } else {
    const bytes = encode();
    await transaction(s => s.collection(namespace).insert(bytes));
   }
  },
  findUserThingByUsername: async username => read({ op: 'eq', path: ['crystal', 'username'], value: username }),
  findUserThingByEmailKey: async key => read({ op: 'contains', path: ['uniqueKeys'], value: key }),
  findUserThingById: async id => read({ op: 'eq', path: ['shareId'], value: id }),
  findUserThingsByUsernames: async names => readMany(['crystal', 'username'], names),
  findUserThingsByIds: async ids => readMany(['shareId'], ids),
  async readUserSecure(owner, callerTransaction?: unknown) {
   assertUserIdentityRepositoryScope(identities);
   if (callerTransaction !== undefined && callerTransaction !== null) throw new UserIdentityRepositoryError('USER_IDENTITY_TRANSACTION_UNSUPPORTED', 'Native secure mutations cannot borrow a caller transaction yet');
   const scope = userIdentityScopeToken(identities);
   return transaction(collections => {
    const rows = collections.collection(namespace).find({filter:{op:'and',filters:[{op:'eq',path:['shareId'],value:owner},{op:'contains',path:['thingtime'],value:'user'}]},limit:2}).documents;
    if (!rows.length) return null;
    if (rows.length !== 1) throw new UserIdentityRepositoryError('USER_IDENTITY_SCOPE','Ambiguous native secure identity');
    const row = BSON.deserialize(rows[0]), typed = BSON.deserialize(Uint8Array.from(rows[0]),{promoteValues:false});validateIdentity(row);
    if (row.secureVersion !== undefined && (!Number.isSafeInteger(row.secureVersion) || row.secureVersion < 0 || row.secureVersion >= Number.MAX_SAFE_INTEGER)) throw new UserIdentityRepositoryError('USER_IDENTITY_SCOPE','Invalid native secure version');
    const snapshot = Object.freeze({stored:Object.freeze({_id:row._id,secure:row.secure,...(row.secureVersion !== undefined ? {secureVersion:row.secureVersion} : {})})});
    // The private preimage is independent of the mutable returned Binary copy.
    snapshots.set(snapshot,{scope,id:typed._id,owner,version:typed.secureVersion,secure:typed.secure});return snapshot;
   });
  },
  async replaceUserSecure(snapshot, secure, updatedAt) {
   assertUserIdentityRepositoryScope(identities);
   const proof = snapshots.get(snapshot);
   if (!proof || proof.scope !== userIdentityScopeToken(identities)) throw new UserIdentityRepositoryError('USER_IDENTITY_SCOPE','Native secure snapshot owner/profile/lifetime mismatch');
   // Reject hooks/forged BSON before scheduling any write.
   const checked = BSON.deserialize(encodeCollectionDocument({_id:'secure-admission',secure,updatedAt}));
   if (!(checked.secure instanceof Binary) || !(checked.updatedAt instanceof Date)) throw new UserIdentityRepositoryError('USER_IDENTITY_SCOPE','Invalid native secure replacement');
   snapshots.delete(snapshot);
   return transaction(collections => {
    if (proof.scope !== userIdentityScopeToken(identities)) throw new UserIdentityRepositoryError('USER_IDENTITY_SCOPE','Expired native secure snapshot');
    const current = proof.version, numeric = current === undefined ? 0 : Number(current.valueOf()), next = numeric + 1;
    const value = current instanceof Long ? Long.fromNumber(next) : current instanceof Double ? new Double(next) : current instanceof Int32 && next > 2147483647 ? Long.fromNumber(next) : next;
    const changed = collections.collection(namespace).updateOne({op:'and',filters:[{op:'eq',path:['_id'],value:proof.id},{op:'eq',path:['shareId'],value:proof.owner},{op:'eq',path:['ownerId'],value:proof.owner},{op:'eq',path:['secure'],value:proof.secure},current === undefined ? {op:'exists',path:['secureVersion'],value:false} : {op:'eq',path:['secureVersion'],value:current}]},[{op:'set',path:['secure'],value:checked.secure},{op:'set',path:['secureVersion'],value},{op:'set',path:['updatedAt'],value:checked.updatedAt}]);
    return changed.modified;
   });
  }
 });
 registerHomeRepositoryProvider(identities, provider);
 return Object.freeze({ identities, sessions, run: <T>(work: () => T | Promise<T>) => withHomeAuthRepositories(identities, sessions, work) });
}
