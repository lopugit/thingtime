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

// Subscription assignments (FUNDAMENTALS.md: everything is a thing) — one
// PROTECTED `subscription` thing per subject, deterministic shareId (same
// idempotent-upsert pattern as the app-storage ledger in apps/namespace.ts).
// The generic /api/v1/things CRUD refuses the kind, so a tier can never be
// self-assigned: only the admin-gated endpoints write here.
//
// Subjects: a USER (subjectId = user id) or an APP (subjectId = clientId).
// The doc's ownerId is the affected user (the subject, or the app's owner) so
// subjects can read their own assignment first-party; acl stays ['tt:user'].

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
  const doc = await things.findOne(subscriptionMatch(subjectType, subjectId));
  const info = doc ? toInfo(subjectType, subjectId, doc) : defaultSubscription(subjectType, subjectId);
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
  if (!sanitized.ok) return fail(400, sanitized.error);

  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 500) : null;
  const now = new Date();
  const things = await getThingsCollection();

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
  subjectId: string
): Promise<{ ok: true }> => {
  const things = await getThingsCollection();
  await things.deleteOne(subscriptionMatch(subjectType, subjectId));
  cache.delete(cacheKey(subjectType, subjectId));
  return { ok: true };
};

// The (user, app) namespace budget resolves through BOTH subjects: an
// app-level assignment (this app gets more per user) wins over the end user's
// own tier (a pro user gets bigger namespaces everywhere). null = unlimited.
export const resolveAppStorageBudget = async (appId: string, endUserId: string): Promise<number | null> => {
  const appSub = await getSubscription('app', appId);
  if (!appSub.isDefault) return appSub.effective.appStorageBytes;
  const userSub = await getSubscription('user', endUserId);
  return userSub.effective.appStorageBytes;
};
