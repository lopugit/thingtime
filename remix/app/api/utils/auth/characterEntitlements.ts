import { Binary } from 'mongodb';
import { currentUserIdentityRepository } from './userIdentityRepository';
import { currentSubscriptionRepository, SubscriptionRepositoryError, nativeSubscriptionUnavailable, type UserEntitlementSnapshot } from '../subscriptions/subscriptionRepository';
import { getHomeThingsCollection as getMongoHomeThingsCollection } from '../mongodb/collections';
import { fromBin } from './binary';
import { characterIdentity } from './characterCore';
import { subscriptionThingMatch, userSubscriptionLedgerEnvelopeIsTrusted } from '../subscriptions/subscriptionIdentity';

const getHomeThingsCollection: typeof getMongoHomeThingsCollection = () => {
 if(currentUserIdentityRepository()) throw new SubscriptionRepositoryError('SUBSCRIPTION_UNAVAILABLE','This Character persistence operation has no native adapter.');
 return getMongoHomeThingsCollection();
};

// No users.ts import: entitlement reads also power that module's projections.
// Resolve exactly one private owner hop. Nested Characters fail closed.
export const inheritedEntitlementFields = ['tier', 'tierVersionId', 'tierVersion', 'tierName', 'tierMetered', 'tierQuotas', 'overrides'];
export function withCharacterEntitlement(doc: any, source: any) {
  if (!source) return doc;
  const crystal = { ...doc?.crystal };
  for (const field of inheritedEntitlementFields) crystal[field] = source.subscription.crystal[field];
  return { ...doc, crystal };
}
function privateState(doc: any) {
  try { return JSON.parse(fromBin(doc?.secure) || '{}'); } catch { return {}; }
}
const characterEntries = (docs: readonly any[]) => docs.map((doc: any) => ({ id: String(doc.shareId), identity: characterIdentity({ meta: privateState(doc).meta }) })).filter((entry: any) => entry.identity && !entry.identity.disabled);
/** Pure one-hop policy shared by Mongo and native snapshot readers. Caller
 * supplies records from one selected home store; no reads or mutations here. */
export const characterEntitlementOwnerIds = (docs: readonly any[]): string[] => [...new Set<string>(characterEntries(docs).map(entry => entry.identity!.ownerId))];
export function characterEntitlementSourcesFromRecords(docs: readonly any[], owners: readonly any[], subscriptions: readonly any[]) {
 const sources = new Map<string, { ownerId: string; subscription: any }>();
 const validOwners = new Set(owners.filter((doc: any) => { const state = privateState(doc); return !state.meta?.character && !state.meta?.temporary && state.accountKind !== 'service'; }).map((doc: any) => String(doc.shareId)));
 const byShareId = new Map(subscriptions.map((doc: any) => [doc.shareId, doc]));
 for (const entry of characterEntries(docs)) {
  const ownerId = entry.identity!.ownerId;
  const subscription = byShareId.get(subscriptionThingMatch('user', ownerId).shareId);
  if (validOwners.has(ownerId) && subscription && userSubscriptionLedgerEnvelopeIsTrusted(subscription, ownerId)) sources.set(entry.id, { ownerId, subscription });
 }
 return sources;
}
/** Native records have no legacy-user fallback. A corrupt/private owner row
 * cannot be interpreted as an ordinary owner by the legacy lenient decoder. */
export function nativeEntitlementUserState(doc: any, id: string): any {
 if (!doc || doc.shareId !== id || doc.ownerId !== id || !Array.isArray(doc.thingtime) || doc.thingtime.length !== 1 || doc.thingtime[0] !== 'user' || !(doc.secure instanceof Binary)) return nativeSubscriptionUnavailable();
 try {
  const state = JSON.parse(fromBin(doc.secure));
  if (!state || typeof state !== 'object' || Array.isArray(state) || !['user','service'].includes(state.accountKind) || !state.meta || typeof state.meta !== 'object' || Array.isArray(state.meta)) return nativeSubscriptionUnavailable();
  return state;
 } catch { return nativeSubscriptionUnavailable(); }
}
export function nativeCharacterEntitlementSourcesFromSnapshot(userIds: readonly string[], snapshot: UserEntitlementSnapshot) {
 const users = userIds.flatMap(id => {const user=snapshot.users.get(id);if(!user)return [];nativeEntitlementUserState(user,id);return [user];});
 const owners = characterEntitlementOwnerIds(users).flatMap(id => {
  const owner = snapshot.users.get(id);if(!owner)return [];
  try {nativeEntitlementUserState(owner,id);return [owner];}catch{return [];}
 });
 return characterEntitlementSourcesFromRecords(users,owners,[...snapshot.subscriptions.values()]);
}
export async function characterEntitlementSources(userIds: readonly string[], session?: any) {
 if (!userIds.length) return new Map<string, {ownerId:string;subscription:any}>();
 const native=currentSubscriptionRepository();
 if(native){
  if(session)throw new SubscriptionRepositoryError('SUBSCRIPTION_UNAVAILABLE','Native Character reads cannot borrow a caller transaction.');
  return nativeCharacterEntitlementSourcesFromSnapshot(userIds,await native.readUserEntitlements(userIds));
 }
 const things = await getHomeThingsCollection();
 const options = session ? { session } : {};
 const docs = await things.find({ thingtime: 'user', shareId: { $in: [...userIds] } }, { ...options, projection: { shareId: 1, secure: 1 } }).toArray();
 const ownerIds = characterEntitlementOwnerIds(docs);
 if (!ownerIds.length) return new Map<string, {ownerId:string;subscription:any}>();
 const [owners, subscriptions] = await Promise.all([
  things.find({ thingtime: 'user', shareId: { $in: ownerIds } }, { ...options, projection: { shareId: 1, secure: 1 } }).toArray(),
  things.find({ thingtime: 'subscription', shareId: { $in: ownerIds.map(id => subscriptionThingMatch('user', id).shareId) } }, options).toArray()
 ]);
 return characterEntitlementSourcesFromRecords(docs, owners, subscriptions);
}
export async function characterEntitlementSource(userId: string, session?: any) {
  return (await characterEntitlementSources([userId], session)).get(userId) ?? null;
}

// Storage still belongs to the Character and is accounted against its own
// exact ledger. Synchronize inherited allowance inside the content transaction
// so the admission predicate cannot keep using an old copied tier.
export async function synchronizeCharacterStorageTier(userId: string, session: any) {
  if(currentUserIdentityRepository())throw new SubscriptionRepositoryError('SUBSCRIPTION_UNAVAILABLE','Native Character storage synchronization is not implemented.');
  const source = await characterEntitlementSource(userId, session);
  if (!source) return;
  const things = await getHomeThingsCollection();
  // Touch the source to conflict with concurrent entitlement changes before
  // committing a write admitted under the old tier.
  await things.updateOne(subscriptionThingMatch('user', source.ownerId), { $set: { 'crystal.storageUpdatedAt': new Date(Math.max(Date.now(), new Date(source.subscription.crystal.storageUpdatedAt || 0).getTime() + 1)) } }, { session });
  const crystal = source.subscription.crystal;
  const fields = inheritedEntitlementFields;
  const set: Record<string, unknown> = {};
  const unset: Record<string, string> = {};
  for (const field of fields) {
    if (crystal[field] !== undefined) set[`crystal.${field}`] = crystal[field];
    else unset[`crystal.${field}`] = '';
  }
  await things.updateOne(subscriptionThingMatch('user', userId), { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { session });
}
