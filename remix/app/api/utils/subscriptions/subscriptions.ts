import { createHash } from 'node:crypto';

import { getThingsCollection } from '../mongodb/collections';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import {
  DEFAULT_SUBSCRIPTION_TIER,
  isKnownSubscriptionTier,
  resolveTierQuotas,
  sanitizeQuotaOverrides,
  subscriptionTierById,
  type QuotaOverrides,
  type SubscriptionTierId,
  type TierQuotas
} from './tierCatalog';

// Subscription assignments (FUNDAMENTALS.md: everything is a thing). USER
// assignments are deterministic protected `subscription` Things; generic
// CRUD can never self-assign one. APP assignments use the same service/API
// shape but live directly on the app Thing beside its aggregate usage ledger,
// so entitlement and admission cannot drift across documents.

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export type SubscriptionSubjectType = 'user' | 'app';

const SUBSCRIPTION_KIND = 'subscription';

const subscriptionShareId = (subjectType: SubscriptionSubjectType, subjectId: string): string =>
  `subscription-${createHash('sha256').update(subjectType).update('\0').update(subjectId).digest('hex').slice(0, 48)}`;

const subscriptionMatch = (subjectType: SubscriptionSubjectType, subjectId: string) => ({
  shareId: subscriptionShareId(subjectType, subjectId),
  thingtime: SUBSCRIPTION_KIND
});

const appMatch = (clientId: string) => ({
  thingtime: 'app',
  'crystal.clientId': clientId
});

const hasOwn = (value: unknown, key: string): boolean =>
  !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key);

export type SubscriptionInfo = {
  subjectType: SubscriptionSubjectType;
  subjectId: string;
  tier: SubscriptionTierId;
  metered: boolean;
  // null = no admin override (pure tier defaults)
  overrides: QuotaOverrides | null;
  note: string | null;
  updatedBy: string | null;
  updatedAt: Date | null;
  // tier defaults + overrides, merged — what enforcement reads
  effective: TierQuotas;
  // true = no assignment doc exists (implicit free tier)
  isDefault: boolean;
};

const defaultSubscription = (subjectType: SubscriptionSubjectType, subjectId: string): SubscriptionInfo => ({
  subjectType,
  subjectId,
  tier: DEFAULT_SUBSCRIPTION_TIER,
  metered: false,
  overrides: null,
  note: null,
  updatedBy: null,
  updatedAt: null,
  effective: resolveTierQuotas(DEFAULT_SUBSCRIPTION_TIER),
  isDefault: true
});

const toInfo = (subjectType: SubscriptionSubjectType, subjectId: string, doc: any): SubscriptionInfo => {
  const crystal = doc?.crystal ?? {};
  const tier: SubscriptionTierId = isKnownSubscriptionTier(crystal.tier) ? crystal.tier : DEFAULT_SUBSCRIPTION_TIER;
  const sanitized = sanitizeQuotaOverrides(crystal.overrides);
  const overrides = sanitized.ok ? sanitized.overrides : null;
  return {
    subjectType,
    subjectId,
    tier,
    metered: subscriptionTierById(tier).metered,
    overrides,
    note: typeof crystal.note === 'string' && crystal.note ? crystal.note : null,
    updatedBy: typeof crystal.updatedBy === 'string' ? crystal.updatedBy : null,
    updatedAt: doc?.updatedAt instanceof Date ? doc.updatedAt : null,
    effective: resolveTierQuotas(tier, overrides),
    isDefault: false
  };
};

// App plans live on the app Thing itself, beside the aggregate byte counter.
// Tier/override changes and the runtime allowance therefore move in one
// atomic update instead of a subscription Thing drifting from the hot ledger.
const toAppInfo = (subjectId: string, doc: any): SubscriptionInfo => {
  if (!doc) return defaultSubscription('app', subjectId);
  const crystal = doc.crystal ?? {};
  const tier: SubscriptionTierId = isKnownSubscriptionTier(crystal.subscriptionTier)
    ? crystal.subscriptionTier
    : DEFAULT_SUBSCRIPTION_TIER;
  const hasOverride = hasOwn(crystal, 'storageAllowanceOverrideBytes');
  const rawOverride = crystal.storageAllowanceOverrideBytes;
  const overrideIsValid =
    rawOverride === null || (Number.isSafeInteger(rawOverride) && Number(rawOverride) >= 0);
  const overrides: QuotaOverrides | null =
    hasOverride && overrideIsValid ? { appStorageBytes: rawOverride as number | null } : null;
  const effective = resolveTierQuotas(tier, overrides);
  const actualAllowance = crystal.storageAllowanceBytes;
  if (actualAllowance === null || (Number.isSafeInteger(actualAllowance) && Number(actualAllowance) >= 0)) {
    effective.appStorageBytes = actualAllowance as number | null;
  }
  return {
    subjectType: 'app',
    subjectId,
    tier,
    metered: subscriptionTierById(tier).metered,
    overrides,
    note: typeof crystal.subscriptionNote === 'string' && crystal.subscriptionNote ? crystal.subscriptionNote : null,
    updatedBy: typeof crystal.subscriptionUpdatedBy === 'string' ? crystal.subscriptionUpdatedBy : null,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt : null,
    effective,
    isDefault: tier === DEFAULT_SUBSCRIPTION_TIER && !overrides
  };
};

// Enforcement sits on hot write paths (every namespace charge, every app/PAT
// mint), so lookups ride a short cache — same 15s stance as the rate-limit
// config. setSubscription invalidates immediately; other server instances
// converge within the TTL.
const CACHE_TTL_MS = 15000;
const cache = new Map<string, { at: number; info: SubscriptionInfo }>();
const cacheKey = (subjectType: SubscriptionSubjectType, subjectId: string) => `${subjectType}\0${subjectId}`;

export const getSubscription = async (
  subjectType: SubscriptionSubjectType,
  subjectId: string
): Promise<SubscriptionInfo> => {
  const key = cacheKey(subjectType, subjectId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.info;

  const things = await getThingsCollection();
  const doc = await things.findOne(subjectType === 'app' ? appMatch(subjectId) : subscriptionMatch(subjectType, subjectId));
  const info =
    subjectType === 'app'
      ? toAppInfo(subjectId, doc)
      : doc
        ? toInfo(subjectType, subjectId, doc)
        : defaultSubscription(subjectType, subjectId);
  cache.set(key, { at: Date.now(), info });
  return info;
};

// Batch counterpart for the admin lists: one indexed query for N subjects,
// implicit free for anyone without a doc. Bypasses the cache — admin reads
// want current truth.
export const getSubscriptions = async (
  subjectType: SubscriptionSubjectType,
  subjectIds: string[]
): Promise<Map<string, SubscriptionInfo>> => {
  const ids = [...new Set(subjectIds.filter((id) => typeof id === 'string' && id))];
  const result = new Map<string, SubscriptionInfo>();
  if (!ids.length) return result;

  const things = await getThingsCollection();
  if (subjectType === 'app') {
    const docs = await things.find({ thingtime: 'app', 'crystal.clientId': { $in: ids } }).toArray();
    const byClientId = new Map(docs.map((doc: any) => [String(doc.crystal?.clientId ?? ''), doc]));
    for (const id of ids) result.set(id, toAppInfo(id, byClientId.get(id)));
    return result;
  }
  const docs = await things
    .find({ thingtime: SUBSCRIPTION_KIND, shareId: { $in: ids.map((id) => subscriptionShareId(subjectType, id)) } })
    .toArray();
  const byShareId = new Map(docs.map((doc: any) => [doc.shareId, doc]));

  for (const id of ids) {
    const doc = byShareId.get(subscriptionShareId(subjectType, id));
    result.set(id, doc ? toInfo(subjectType, id, doc) : defaultSubscription(subjectType, id));
  }
  return result;
};

export type SetSubscriptionInput = {
  subjectType: SubscriptionSubjectType;
  subjectId: string;
  // The affected user: the subject itself for users, the app's owner for apps.
  ownerId: string;
  tier: unknown;
  overrides?: unknown;
  note?: unknown;
  updatedBy: string;
};

export const setSubscription = async (
  input: SetSubscriptionInput
): Promise<{ ok: true; subscription: SubscriptionInfo } | Fail> => {
  if (!isKnownSubscriptionTier(input.tier)) {
    return fail(400, `Unknown tier: ${String(input.tier)} — see the catalog at /api/v1/admin/subscriptions-docs`);
  }
  const sanitized = sanitizeQuotaOverrides(input.overrides);
  if (sanitized.ok === false) return fail(400, sanitized.error);

  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 500) : null;
  const now = new Date();
  const things = await getThingsCollection();

  if (input.subjectType === 'app') {
    const overrides = sanitized.overrides;
    const irrelevant = Object.keys(overrides || {}).filter((field) => field !== 'appStorageBytes');
    if (irrelevant.length) {
      return fail(400, `App subscriptions only accept the appStorageBytes override (received ${irrelevant.join(', ')})`);
    }
    const hasAllowanceOverride = hasOwn(overrides, 'appStorageBytes');
    const allowanceBytes = hasAllowanceOverride
      ? (overrides!.appStorageBytes ?? null)
      : subscriptionTierById(input.tier).quotas.appStorageBytes;
    const filter: Record<string, unknown> = {
      ...appMatch(input.subjectId),
      ...(allowanceBytes === null
        ? {}
        : {
            $expr: {
              $lte: [{ $ifNull: ['$crystal.storageUsedBytes', 0] }, allowanceBytes]
            }
          })
    };
    const set: Record<string, unknown> = {
      'crystal.subscriptionTier': input.tier,
      'crystal.storageAllowanceBytes': allowanceBytes,
      'crystal.subscriptionNote': note,
      'crystal.subscriptionUpdatedBy': input.updatedBy,
      'crystal.subscriptionUpdatedAt': now,
      updatedAt: now
    };
    const update: Record<string, unknown> = { $set: set };
    if (hasAllowanceOverride) set['crystal.storageAllowanceOverrideBytes'] = allowanceBytes;
    else update.$unset = { 'crystal.storageAllowanceOverrideBytes': '' };

    const updated = await things.findOneAndUpdate(filter as any, update as any, { returnDocument: 'after' });
    if (!updated) {
      const existing = await things.findOne(appMatch(input.subjectId), {
        projection: { 'crystal.storageUsedBytes': 1 }
      });
      if (!existing) return fail(404, 'App not found');
      return fail(
        409,
        `The app already uses ${Number(existing.crystal?.storageUsedBytes || 0)} bytes, above that plan's allowance`
      );
    }
    cache.delete(cacheKey('app', input.subjectId));
    return { ok: true, subscription: toAppInfo(input.subjectId, updated) };
  }

  if (hasOwn(sanitized.overrides, 'appStorageBytes')) {
    return fail(400, 'appStorageBytes applies to app subscriptions, not user subscriptions');
  }

  try {
    await things.updateOne(
      subscriptionMatch(input.subjectType, input.subjectId),
      {
        $set: {
          'crystal.tier': input.tier,
          'crystal.overrides': sanitized.overrides,
          'crystal.note': note,
          'crystal.updatedBy': input.updatedBy,
          updatedAt: now
        },
        $setOnInsert: {
          schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
          thingtime: [SUBSCRIPTION_KIND],
          'crystal.quotaKind': SUBSCRIPTION_KIND,
          'crystal.subjectType': input.subjectType,
          'crystal.subjectId': input.subjectId,
          ownerId: input.ownerId,
          acl: [ACL_OWNER],
          targetId: null,
          tags: [],
          createdAt: now
        }
      },
      { upsert: true }
    );
  } catch (err: any) {
    if (err?.code !== 11000) throw err; // lost the upsert race — retry path below reads the winner
  }

  cache.delete(cacheKey(input.subjectType, input.subjectId));
  return { ok: true, subscription: await getSubscription(input.subjectType, input.subjectId) };
};

// Reset a subject to the implicit default (free, no overrides).
export const clearSubscription = async (
  subjectType: SubscriptionSubjectType,
  subjectId: string,
  updatedBy = 'system'
): Promise<{ ok: true } | Fail> => {
  if (subjectType === 'app') {
    const things = await getThingsCollection();
    const app = await things.findOne(appMatch(subjectId), { projection: { ownerId: 1 } });
    if (!app) return fail(404, 'App not found');
    const reset = await setSubscription({
      subjectType: 'app',
      subjectId,
      ownerId: String(app.ownerId),
      tier: DEFAULT_SUBSCRIPTION_TIER,
      overrides: null,
      updatedBy
    });
    return reset.ok ? { ok: true } : reset;
  }
  const things = await getThingsCollection();
  await things.deleteOne(subscriptionMatch(subjectType, subjectId));
  cache.delete(cacheKey(subjectType, subjectId));
  return { ok: true };
};

// The app subject owns the aggregate namespace budget. Per-user limits are an
// app policy (default + relational user override), not the end user's personal
// Thingtime subscription.
export const resolveAppStorageBudget = async (appId: string, _endUserId?: string): Promise<number | null> => {
  const appSub = await getSubscription('app', appId);
  return appSub.effective.appStorageBytes;
};
