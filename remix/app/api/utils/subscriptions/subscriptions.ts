import { createHash } from 'node:crypto';

import { getThingsCollection } from '../mongodb/collections';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import {
  DEFAULT_SUBSCRIPTION_TIER,
  isKnownSubscriptionTier,
  resolveQuotas,
  sanitizeQuotaOverrides,
  subscriptionTierById,
  type QuotaOverrides,
  type SubscriptionTierId,
  type TierQuotas
} from './tierCatalog';
import { getLiveSubscriptionTier, getSubscriptionTierVersion, tierAssignmentSnapshot, tierQuotasFromUnknown } from './tierCatalogStore';

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

const hasOwn = (value: unknown, key: string): boolean => !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key);

export type SubscriptionInfo = {
  subjectType: SubscriptionSubjectType;
  subjectId: string;
  tier: SubscriptionTierId;
  // Exact immutable catalog revision selected for this assignment.
  tierVersionId: string;
  tierVersion: number;
  tierName: string;
  metered: boolean;
  // null = no admin override (pure tier defaults)
  overrides: QuotaOverrides | null;
  note: string | null;
  updatedBy: string | null;
  updatedAt: Date | null;
  // tier defaults + overrides, merged — what enforcement reads
  effective: TierQuotas;
  // true = this is the explicitly pinned default assignment (or a legacy
  // subject that predates materialized assignments).
  isDefault: boolean;
};

type TierSnapshot = ReturnType<typeof tierAssignmentSnapshot>;

const staticTierSnapshot = (tierId: unknown): TierSnapshot => {
  const descriptor = isKnownSubscriptionTier(tierId) ? subscriptionTierById(tierId) : subscriptionTierById(DEFAULT_SUBSCRIPTION_TIER);
  return tierAssignmentSnapshot(descriptor);
};

const initialSubscriptionSnapshot = (value: unknown): TierSnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const seed = value as Record<string, unknown>;
  const quotas = tierQuotasFromUnknown(seed.quotas);
  if (
    typeof seed.tierId !== 'string' ||
    !seed.tierId.trim() ||
    typeof seed.versionId !== 'string' ||
    !seed.versionId.trim() ||
    !Number.isSafeInteger(seed.version) ||
    Number(seed.version) < 1 ||
    typeof seed.title !== 'string' ||
    typeof seed.metered !== 'boolean' ||
    !quotas
  ) {
    return null;
  }
  return {
    tierId: seed.tierId.trim(),
    versionId: seed.versionId.trim(),
    version: Number(seed.version),
    title: seed.title,
    metered: seed.metered,
    quotas
  };
};

const snapshotFromCrystal = (crystal: any, prefix: '' | 'subscription'): TierSnapshot => {
  const field = (name: string) => `${prefix}${prefix ? name.charAt(0).toUpperCase() + name.slice(1) : name}`;
  const rawTier = crystal?.[field('tier')];
  const legacy = staticTierSnapshot(rawTier);
  const quotas = tierQuotasFromUnknown(crystal?.[field('tierQuotas')]) ?? legacy.quotas;
  return {
    tierId: typeof rawTier === 'string' && rawTier.trim() ? rawTier.trim() : legacy.tierId,
    versionId:
      typeof crystal?.[field('tierVersionId')] === 'string' && crystal[field('tierVersionId')] ? crystal[field('tierVersionId')] : legacy.versionId,
    version:
      Number.isSafeInteger(crystal?.[field('tierVersion')]) && Number(crystal[field('tierVersion')]) > 0
        ? Number(crystal[field('tierVersion')])
        : legacy.version,
    title: typeof crystal?.[field('tierName')] === 'string' && crystal[field('tierName')] ? crystal[field('tierName')] : legacy.title,
    metered: typeof crystal?.[field('tierMetered')] === 'boolean' ? crystal[field('tierMetered')] : legacy.metered,
    quotas
  };
};

const defaultSubscription = (
  subjectType: SubscriptionSubjectType,
  subjectId: string,
  snapshot = staticTierSnapshot(DEFAULT_SUBSCRIPTION_TIER)
): SubscriptionInfo => ({
  subjectType,
  subjectId,
  tier: snapshot.tierId,
  tierVersionId: snapshot.versionId,
  tierVersion: snapshot.version,
  tierName: snapshot.title,
  metered: snapshot.metered,
  overrides: null,
  note: null,
  updatedBy: null,
  updatedAt: null,
  effective: { ...snapshot.quotas },
  isDefault: true
});

const toInfo = (subjectType: SubscriptionSubjectType, subjectId: string, doc: any): SubscriptionInfo => {
  const crystal = doc?.crystal ?? {};
  const snapshot = snapshotFromCrystal(crystal, '');
  const sanitized = sanitizeQuotaOverrides(crystal.overrides);
  const overrides = sanitized.ok ? sanitized.overrides : null;
  return {
    subjectType,
    subjectId,
    tier: snapshot.tierId,
    tierVersionId: snapshot.versionId,
    tierVersion: snapshot.version,
    tierName: snapshot.title,
    metered: snapshot.metered,
    overrides,
    note: typeof crystal.note === 'string' && crystal.note ? crystal.note : null,
    updatedBy: typeof crystal.updatedBy === 'string' ? crystal.updatedBy : null,
    updatedAt: doc?.updatedAt instanceof Date ? doc.updatedAt : null,
    effective: resolveQuotas(snapshot.quotas, overrides),
    isDefault: crystal.isDefaultAssignment === true
  };
};

// App plans live on the app Thing itself, beside the aggregate byte counter.
// Tier/override changes and the runtime allowance therefore move in one
// atomic update instead of a subscription Thing drifting from the hot ledger.
const toAppInfo = (subjectId: string, doc: any): SubscriptionInfo => {
  if (!doc) return defaultSubscription('app', subjectId);
  const crystal = doc.crystal ?? {};
  const snapshot = snapshotFromCrystal(crystal, 'subscription');
  const hasOverride = hasOwn(crystal, 'storageAllowanceOverrideBytes');
  const rawOverride = crystal.storageAllowanceOverrideBytes;
  const overrideIsValid = rawOverride === null || (Number.isSafeInteger(rawOverride) && Number(rawOverride) >= 0);
  const overrides: QuotaOverrides | null = hasOverride && overrideIsValid ? { appStorageBytes: rawOverride as number | null } : null;
  const effective = resolveQuotas(snapshot.quotas, overrides);
  const actualAllowance = crystal.storageAllowanceBytes;
  if (actualAllowance === null || (Number.isSafeInteger(actualAllowance) && Number(actualAllowance) >= 0)) {
    effective.appStorageBytes = actualAllowance as number | null;
  }
  return {
    subjectType: 'app',
    subjectId,
    tier: snapshot.tierId,
    tierVersionId: snapshot.versionId,
    tierVersion: snapshot.version,
    tierName: snapshot.title,
    metered: snapshot.metered,
    overrides,
    note: typeof crystal.subscriptionNote === 'string' && crystal.subscriptionNote ? crystal.subscriptionNote : null,
    updatedBy: typeof crystal.subscriptionUpdatedBy === 'string' ? crystal.subscriptionUpdatedBy : null,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt : null,
    effective,
    isDefault: snapshot.tierId === DEFAULT_SUBSCRIPTION_TIER && !overrides
  };
};

// Enforcement sits on hot write paths (every namespace charge, every app/PAT
// mint), so lookups ride a short cache — same 15s stance as the rate-limit
// config. setSubscription invalidates immediately; other server instances
// converge within the TTL.
const CACHE_TTL_MS = 15000;
const cache = new Map<string, { at: number; info: SubscriptionInfo }>();
const cacheKey = (subjectType: SubscriptionSubjectType, subjectId: string) => `${subjectType}\0${subjectId}`;

export const getSubscription = async (subjectType: SubscriptionSubjectType, subjectId: string): Promise<SubscriptionInfo> => {
  const key = cacheKey(subjectType, subjectId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.info;

  const things = await getThingsCollection();
  const doc = await things.findOne(subjectType === 'app' ? appMatch(subjectId) : subscriptionMatch(subjectType, subjectId));
  const userSeed =
    subjectType === 'user' && !doc
      ? await things.findOne({ shareId: subjectId, thingtime: 'user' }, { projection: { initialSubscription: 1 } })
      : null;
  const pinnedSignup = initialSubscriptionSnapshot(userSeed?.initialSubscription);
  const info =
    subjectType === 'app'
      ? doc
        ? toAppInfo(subjectId, doc)
        : defaultSubscription('app', subjectId)
      : doc
      ? toInfo(subjectType, subjectId, doc)
      : defaultSubscription(subjectType, subjectId, pinnedSignup ?? undefined);
  cache.set(key, { at: Date.now(), info });
  return info;
};

// Batch counterpart for the admin lists: one indexed query for N subjects,
// implicit free for anyone without a doc. Bypasses the cache — admin reads
// want current truth.
export const getSubscriptions = async (subjectType: SubscriptionSubjectType, subjectIds: string[]): Promise<Map<string, SubscriptionInfo>> => {
  const ids = [...new Set(subjectIds.filter((id) => typeof id === 'string' && id))];
  const result = new Map<string, SubscriptionInfo>();
  if (!ids.length) return result;

  const things = await getThingsCollection();
  if (subjectType === 'app') {
    const docs = await things.find({ thingtime: 'app', 'crystal.clientId': { $in: ids } }).toArray();
    const byClientId = new Map(docs.map((doc: any) => [String(doc.crystal?.clientId ?? ''), doc]));
    for (const id of ids) {
      const doc = byClientId.get(id);
      result.set(id, doc ? toAppInfo(id, doc) : defaultSubscription('app', id));
    }
    return result;
  }
  const [docs, users] = await Promise.all([
    things.find({ thingtime: SUBSCRIPTION_KIND, shareId: { $in: ids.map((id) => subscriptionShareId(subjectType, id)) } }).toArray(),
    things.find({ thingtime: 'user', shareId: { $in: ids } }, { projection: { shareId: 1, initialSubscription: 1 } }).toArray()
  ]);
  const byShareId = new Map(docs.map((doc: any) => [doc.shareId, doc]));
  const seedByUserId = new Map<string, TierSnapshot | null>(
    users.map((doc: any) => [String(doc.shareId), initialSubscriptionSnapshot(doc.initialSubscription)])
  );

  for (const id of ids) {
    const doc = byShareId.get(subscriptionShareId(subjectType, id));
    result.set(id, doc ? toInfo(subjectType, id, doc) : defaultSubscription(subjectType, id, seedByUserId.get(id) ?? undefined));
  }
  return result;
};

export type SetSubscriptionInput = {
  subjectType: SubscriptionSubjectType;
  subjectId: string;
  // The affected user: the subject itself for users, the app's owner for apps.
  ownerId: string;
  tier: unknown;
  tierVersionId?: unknown;
  overrides?: unknown;
  note?: unknown;
  updatedBy: string;
  isDefaultAssignment?: boolean;
};

export const setSubscription = async (input: SetSubscriptionInput): Promise<{ ok: true; subscription: SubscriptionInfo } | Fail> => {
  let selectedTier = await getLiveSubscriptionTier(input.tier, input.tierVersionId);
  let archivedExpectedVersionId: string | null = null;
  if (!selectedTier && input.tierVersionId) {
    const [exact, current] = await Promise.all([
      getSubscriptionTierVersion(input.tierVersionId),
      getSubscription(input.subjectType, input.subjectId)
    ]);
    // An administrator may update notes/overrides without forcing an existing
    // historical assignment onto a new plan. Archived revisions are accepted
    // only when they are already this subject's exact pinned revision.
    if (exact?.status === 'archived' && exact.id === input.tier && current.tierVersionId === exact.versionId) {
      selectedTier = exact;
      archivedExpectedVersionId = exact.versionId;
    }
  }
  if (!selectedTier) {
    return fail(400, `Unknown or non-live tier revision: ${String(input.tier)} — refresh the catalog at /api/v1/tiers`);
  }
  const snapshot = tierAssignmentSnapshot(selectedTier);
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
    const allowanceBytes = hasAllowanceOverride ? overrides!.appStorageBytes ?? null : snapshot.quotas.appStorageBytes;
    const filter: Record<string, unknown> = {
      ...appMatch(input.subjectId),
      ...(archivedExpectedVersionId
        ? {
            $or: [
              { 'crystal.subscriptionTierVersionId': archivedExpectedVersionId },
              {
                'crystal.subscriptionTierVersionId': { $exists: false },
                'crystal.subscriptionTier': snapshot.tierId
              }
            ]
          }
        : {}),
      ...(allowanceBytes === null
        ? {}
        : {
            $expr: {
              $lte: [{ $ifNull: ['$crystal.storageUsedBytes', 0] }, allowanceBytes]
            }
          })
    };
    const set: Record<string, unknown> = {
      'crystal.subscriptionTier': snapshot.tierId,
      'crystal.subscriptionTierVersionId': snapshot.versionId,
      'crystal.subscriptionTierVersion': snapshot.version,
      'crystal.subscriptionTierName': snapshot.title,
      'crystal.subscriptionTierMetered': snapshot.metered,
      'crystal.subscriptionTierQuotas': snapshot.quotas,
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
        projection: {
          'crystal.storageUsedBytes': 1,
          'crystal.subscriptionTier': 1,
          'crystal.subscriptionTierVersionId': 1
        }
      });
      if (!existing) return fail(404, 'App not found');
      if (archivedExpectedVersionId) {
        const currentVersionId = existing.crystal?.subscriptionTierVersionId;
        const legacySameTier = !currentVersionId && existing.crystal?.subscriptionTier === snapshot.tierId;
        if (currentVersionId !== archivedExpectedVersionId && !legacySameTier) {
          return fail(409, 'The subscription changed while saving; refresh and try again');
        }
      }
      return fail(409, `The app already uses ${Number(existing.crystal?.storageUsedBytes || 0)} bytes, above that plan's allowance`);
    }
    cache.delete(cacheKey('app', input.subjectId));
    return { ok: true, subscription: toAppInfo(input.subjectId, updated) };
  }

  if (hasOwn(sanitized.overrides, 'appStorageBytes')) {
    return fail(400, 'appStorageBytes applies to app subscriptions, not user subscriptions');
  }

  const baseSubscriptionMatch = subscriptionMatch(input.subjectType, input.subjectId);
  const existingAssignment = archivedExpectedVersionId
    ? await things.findOne(baseSubscriptionMatch, {
        projection: { 'crystal.tierVersionId': 1, 'crystal.tier': 1 }
      })
    : null;
  const assignmentMatch = archivedExpectedVersionId
    ? {
        ...baseSubscriptionMatch,
        ...(existingAssignment
          ? {
              $or: [
                { 'crystal.tierVersionId': archivedExpectedVersionId },
                {
                  'crystal.tierVersionId': { $exists: false },
                  'crystal.tier': snapshot.tierId
                }
              ]
            }
          : { 'crystal.tierVersionId': { $exists: false } })
      }
    : baseSubscriptionMatch;
  const assignmentUpdate = {
    $set: {
      'crystal.tier': snapshot.tierId,
      'crystal.tierVersionId': snapshot.versionId,
      'crystal.tierVersion': snapshot.version,
      'crystal.tierName': snapshot.title,
      'crystal.tierMetered': snapshot.metered,
      'crystal.tierQuotas': snapshot.quotas,
      'crystal.overrides': sanitized.overrides,
      'crystal.note': note,
      'crystal.updatedBy': input.updatedBy,
      'crystal.isDefaultAssignment': input.isDefaultAssignment === true,
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
  };
  let write;
  try {
    write = await things.updateOne(assignmentMatch, assignmentUpdate, { upsert: true });
  } catch (err: any) {
    if (err?.code !== 11000) throw err;
    if (archivedExpectedVersionId) {
      return fail(409, 'The subscription changed while saving; refresh and try again');
    }
    // A legitimate concurrent assignment insert can win the upsert race. Retry
    // only against a real protected subscription Thing. A normal Thing that
    // squatted the deterministic shareId does not match and fails closed.
    write = await things.updateOne(baseSubscriptionMatch, assignmentUpdate, { upsert: false });
    if (!write.matchedCount) {
      return fail(409, 'The subscription assignment id is unavailable; contact an administrator');
    }
  }

  if (archivedExpectedVersionId && existingAssignment && !write?.matchedCount) {
    return fail(409, 'The subscription changed while saving; refresh and try again');
  }

  cache.delete(cacheKey(input.subjectType, input.subjectId));
  return { ok: true, subscription: await getSubscription(input.subjectType, input.subjectId) };
};

// Reset a subject to the current live default revision. User resets remain a
// concrete protected Thing so their exact default version is traceable later.
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
  const reset = await setSubscription({
    subjectType: 'user',
    subjectId,
    ownerId: subjectId,
    tier: DEFAULT_SUBSCRIPTION_TIER,
    overrides: null,
    updatedBy,
    isDefaultAssignment: true
  });
  return reset.ok ? { ok: true } : reset;
};

// The app subject owns the aggregate namespace budget. Per-user limits are an
// app policy (default + relational user override), not the end user's personal
// Thingtime subscription.
export const resolveAppStorageBudget = async (appId: string, _endUserId?: string): Promise<number | null> => {
  const appSub = await getSubscription('app', appId);
  return appSub.effective.appStorageBytes;
};
