import { getHomeThingsCollection } from '../mongodb/collections';
import { fromBin } from './binary';
import { characterIdentity } from './characterCore';
import { subscriptionThingMatch, userSubscriptionLedgerEnvelopeIsTrusted } from '../subscriptions/subscriptionIdentity';

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
export async function characterEntitlementSources(userIds: readonly string[], session?: any) {
  const sources = new Map<string, { ownerId: string; subscription: any }>();
  if (!userIds.length) return sources;
  const things = await getHomeThingsCollection();
  const options = session ? { session } : {};
  const docs = await things.find({ thingtime: 'user', shareId: { $in: [...userIds] } }, { ...options, projection: { shareId: 1, secure: 1 } }).toArray();
  const characters = docs.map((doc: any) => ({ id: String(doc.shareId), identity: characterIdentity({ meta: privateState(doc).meta }) })).filter((entry: any) => entry.identity && !entry.identity.disabled);
  const ownerIds = [...new Set<string>(characters.map((entry: any) => entry.identity.ownerId))];
  if (!ownerIds.length) return sources;
  const [owners, subscriptions] = await Promise.all([
    things.find({ thingtime: 'user', shareId: { $in: ownerIds } }, { ...options, projection: { shareId: 1, secure: 1 } }).toArray(),
    things.find({ thingtime: 'subscription', shareId: { $in: ownerIds.map(id => subscriptionThingMatch('user', id).shareId) } }, options).toArray()
  ]);
  const validOwners = new Set(owners.filter((doc: any) => { const state = privateState(doc); return !state.meta?.character && !state.meta?.temporary && state.accountKind !== 'service'; }).map((doc: any) => String(doc.shareId)));
  const byShareId = new Map(subscriptions.map((doc: any) => [doc.shareId, doc]));
  for (const entry of characters) {
    const ownerId = entry.identity!.ownerId;
    const subscription = byShareId.get(subscriptionThingMatch('user', ownerId).shareId);
    if (validOwners.has(ownerId) && subscription && userSubscriptionLedgerEnvelopeIsTrusted(subscription, ownerId)) sources.set(entry.id, { ownerId, subscription });
  }
  return sources;
}
export async function characterEntitlementSource(userId: string, session?: any) {
  return (await characterEntitlementSources([userId], session)).get(userId) ?? null;
}

// Storage still belongs to the Character and is accounted against its own
// exact ledger. Synchronize inherited allowance inside the content transaction
// so the admission predicate cannot keep using an old copied tier.
export async function synchronizeCharacterStorageTier(userId: string, session: any) {
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
