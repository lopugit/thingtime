import { randomBytes } from 'node:crypto';

// The subscription-tier catalog is platform configuration: revisions and the
// tier settings pointer live on the HOME deployment only, never on a
// data-plane endpoint override (a foreign DB must not answer entitlements).
import { ensureIndexes, getSettingsCollection, getHomeThingsCollection as getThingsCollection } from '../mongodb/collections';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import {
  EMPTY_TIER_INCLUSIONS,
  EMPTY_TIER_PRICES,
  DEFAULT_SUBSCRIPTION_TIER,
  QUOTA_OVERRIDE_FIELDS,
  REQUIRED_TIER_QUOTA_FIELDS,
  SUBSCRIPTION_TIER_CATALOG,
  TIER_DISCOUNT_COMPARISONS,
  computeTierDiscounts,
  sanitizeTierQuotas,
  speedTestsPerHour,
  type SubscriptionTierDescriptor,
  type SubscriptionTierStatus,
  type TierDiscountKey,
  type TierDiscounts,
  type TierDiscountOverrides,
  type TierInclusions,
  type TierPrices,
  type TierQuotas
} from './tierCatalog';

// Mongo-backed tier catalog. Every published revision is immutable: editing a
// live/archived tier first creates a draft with the next integer version, and
// assignments store that draft's exact versionId when it becomes live.

export const SUBSCRIPTION_TIER_KIND = 'subscription-tier';
const TIER_DOC_FILTER = {
  thingtime: SUBSCRIPTION_TIER_KIND,
  'crystal.quotaKind': SUBSCRIPTION_TIER_KIND
} as const;
const MAX_NAME_CHARS = 80;
const MAX_TAGLINE_CHARS = 240;
const MAX_BANNER_URL_CHARS = 2048;
const MAX_EDITOR_JSON_BYTES = 256 * 1024;
const MAX_EDITOR_BLOCKS = 300;
const MAX_PRICE_MINOR = 1_000_000_000_000;

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export type TierMutationInput = {
  title?: unknown;
  tagline?: unknown;
  emoji?: unknown;
  bannerImageUrl?: unknown;
  sortOrder?: unknown;
  metered?: unknown;
  currency?: unknown;
  prices?: unknown;
  discountOverrides?: unknown;
  inclusions?: unknown;
  quotas?: unknown;
};

type SanitizedTierContent = Omit<
  SubscriptionTierDescriptor,
  'id' | 'versionId' | 'version' | 'status' | 'discounts' | 'createdAt' | 'updatedAt' | 'publishedAt' | 'archivedAt'
>;

const toIso = (value: unknown): string | null => {
  const date = value instanceof Date ? value : value ? new Date(value as any) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};

const sanitizeText = (value: unknown, max: number, label: string, required = false) => {
  if (value === null || value === undefined) {
    return required ? fail(400, `${label} is required`) : { ok: true as const, value: '' };
  }
  if (typeof value !== 'string') return fail(400, `${label} must be text`);
  const text = value.trim();
  if (required && !text) return fail(400, `${label} is required`);
  if (text.length > max) return fail(400, `${label} must be at most ${max} characters`);
  return { ok: true as const, value: text };
};

const sanitizeBannerImageUrl = (value: unknown) => {
  if (value === null || value === undefined || value === '') return { ok: true as const, value: null };
  if (typeof value !== 'string' || value.trim().length > MAX_BANNER_URL_CHARS) {
    return fail(400, `bannerImageUrl must be an http(s) URL up to ${MAX_BANNER_URL_CHARS} characters`);
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsafe protocol');
    return { ok: true as const, value: url.toString() };
  } catch {
    return fail(400, 'bannerImageUrl must be a valid http(s) URL');
  }
};

const sanitizePrices = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail(400, 'prices must include daily, weekly, monthly, and yearly minor-unit values');
  }
  const input = value as Record<string, unknown>;
  const prices: TierPrices = { ...EMPTY_TIER_PRICES };
  for (const period of ['daily', 'weekly', 'monthly', 'yearly'] as const) {
    const raw = input[period];
    if (raw === null || raw === undefined || raw === '') {
      prices[period] = null;
      continue;
    }
    const numeric = Number(raw);
    if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > MAX_PRICE_MINOR) {
      return fail(400, `${period} price must be a non-negative integer in minor currency units, or null`);
    }
    prices[period] = numeric;
  }
  return { ok: true as const, prices };
};

const sanitizeDiscountOverrides = (value: unknown) => {
  if (value === null || value === undefined) {
    return { ok: true as const, overrides: {} as TierDiscountOverrides };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return fail(400, 'discountOverrides must be an object of comparison percentages');
  }
  const known = new Set<string>(TIER_DISCOUNT_COMPARISONS.map((entry) => entry.key));
  const overrides: TierDiscountOverrides = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!known.has(key)) return fail(400, `Unknown discount comparison: ${key}`);
    if (raw === null || raw === undefined || raw === '') continue;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
      return fail(400, `${key} custom discount must be between 0 and 100 percent`);
    }
    overrides[key as TierDiscountKey] = Math.round((numeric + Number.EPSILON) * 100) / 100;
  }
  return { ok: true as const, overrides };
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

const savedDiscountsFromUnknown = (value: unknown): TierDiscounts | null => {
  if (!isPlainRecord(value)) return null;
  const discounts = {} as TierDiscounts;
  for (const comparison of TIER_DISCOUNT_COMPARISONS) {
    const raw = value[comparison.key];
    if (raw === null) {
      discounts[comparison.key] = null;
    } else if (typeof raw === 'number' && Number.isFinite(raw)) {
      discounts[comparison.key] = raw;
    } else {
      return null;
    }
  }
  return discounts;
};

const sanitizeInclusions = (value: unknown) => {
  if (value === null || value === undefined) {
    return { ok: true as const, inclusions: { ...EMPTY_TIER_INCLUSIONS } };
  }
  if (!isPlainRecord(value) || value.kind !== 'rich-text' || !Array.isArray(value.blocks)) {
    return fail(400, 'inclusions must be an Editor.js rich-text document');
  }
  if (value.blocks.length > MAX_EDITOR_BLOCKS) {
    return fail(400, `inclusions can contain at most ${MAX_EDITOR_BLOCKS} Editor.js blocks`);
  }
  for (const block of value.blocks) {
    if (!isPlainRecord(block) || typeof block.type !== 'string' || !isPlainRecord(block.data)) {
      return fail(400, 'Every inclusions block needs a string type and object data');
    }
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return fail(400, 'inclusions must be serializable JSON');
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_EDITOR_JSON_BYTES) {
    return fail(400, `inclusions must be at most ${MAX_EDITOR_JSON_BYTES / 1024} KiB`);
  }
  return { ok: true as const, inclusions: JSON.parse(serialized) as TierInclusions };
};

export const sanitizeTierContent = (input: TierMutationInput): { ok: true; content: SanitizedTierContent } | Fail => {
  const title = sanitizeText(input.title, MAX_NAME_CHARS, 'Tier name', true);
  if (title.ok === false) return title;
  const tagline = sanitizeText(input.tagline, MAX_TAGLINE_CHARS, 'Tagline');
  if (tagline.ok === false) return tagline;
  const emoji = sanitizeText(input.emoji, 16, 'Emoji');
  if (emoji.ok === false) return emoji;
  const banner = sanitizeBannerImageUrl(input.bannerImageUrl);
  if (banner.ok === false) return banner;
  const prices = sanitizePrices(input.prices);
  if (prices.ok === false) return prices;
  const discountOverrides = sanitizeDiscountOverrides(input.discountOverrides);
  if (discountOverrides.ok === false) return discountOverrides;
  const inclusions = sanitizeInclusions(input.inclusions);
  if (inclusions.ok === false) return inclusions;
  const quotas = sanitizeTierQuotas(input.quotas);
  if (quotas.ok === false) return fail(400, quotas.error);

  const currency = typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) return fail(400, 'currency must be a three-letter ISO currency code');
  const sortOrder = Number(input.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < -10000 || sortOrder > 10000) {
    return fail(400, 'sortOrder must be an integer between -10000 and 10000');
  }
  if (typeof input.metered !== 'boolean') return fail(400, 'metered must be true or false');
  if (input.metered && quotas.quotas.speedTestsPerHour === undefined) {
    // Immutable PAYG revisions predate this optional allowance. Resolve the
    // missing field without rejecting or rewriting their published history.
    quotas.quotas.speedTestsPerHour = null;
  }
  if (input.metered && QUOTA_OVERRIDE_FIELDS.some((field) => quotas.quotas[field] !== null)) {
    return fail(400, 'Metered tiers must use unlimited quota defaults for every allowance');
  }

  return {
    ok: true,
    content: {
      title: title.value,
      tagline: tagline.value,
      description: tagline.value,
      emoji: emoji.value,
      bannerImageUrl: banner.value,
      sortOrder,
      metered: input.metered,
      currency,
      prices: prices.prices,
      discountOverrides: discountOverrides.overrides,
      inclusions: inclusions.inclusions,
      quotas: quotas.quotas
    }
  };
};

const tierIdFromTitle = (title: string): string => {
  const slug =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'tier';
  return `${slug}-${randomBytes(4).toString('hex')}`;
};

const versionShareId = (tierId: string, version: number): string => `subscription-tier-${tierId}-v${version}`;

const descriptorToInsert = (descriptor: SubscriptionTierDescriptor, actorId: string, now: Date, sourceVersionId: string | null = null) => ({
  shareId: descriptor.versionId,
  schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
  thingtime: [SUBSCRIPTION_TIER_KIND],
  crystal: {
    quotaKind: SUBSCRIPTION_TIER_KIND,
    tierId: descriptor.id,
    version: descriptor.version,
    status: descriptor.status,
    title: descriptor.title,
    tagline: descriptor.tagline,
    emoji: descriptor.emoji,
    bannerImageUrl: descriptor.bannerImageUrl,
    sortOrder: descriptor.sortOrder,
    metered: descriptor.metered,
    currency: descriptor.currency,
    prices: descriptor.prices,
    discountOverrides: descriptor.discountOverrides,
    discounts: descriptor.discounts,
    discountFormulaVersion: 1,
    inclusions: descriptor.inclusions,
    quotas: descriptor.quotas,
    sourceVersionId,
    createdBy: actorId,
    updatedBy: actorId,
    ...(descriptor.status === 'live' ? { publishedAt: now } : {})
  },
  ownerId: actorId,
  acl: [ACL_OWNER],
  targetId: null,
  tags: [],
  createdAt: now,
  updatedAt: now
});

const descriptorFromDoc = (doc: any): SubscriptionTierDescriptor | null => {
  const crystal = doc?.crystal;
  const thingtime = Array.isArray(doc?.thingtime) ? doc.thingtime : [doc?.thingtime];
  if (!thingtime.includes(SUBSCRIPTION_TIER_KIND) || !crystal || crystal.quotaKind !== SUBSCRIPTION_TIER_KIND) {
    return null;
  }
  const tierId = typeof crystal.tierId === 'string' ? crystal.tierId : '';
  const version = Number(crystal.version);
  const status = crystal.status as SubscriptionTierStatus;
  if (!tierId || !Number.isSafeInteger(version) || version < 1 || !['draft', 'live', 'archived'].includes(status)) {
    return null;
  }
  const sanitized = sanitizeTierContent({
    title: crystal.title,
    tagline: crystal.tagline,
    emoji: crystal.emoji ?? '',
    bannerImageUrl: crystal.bannerImageUrl ?? null,
    sortOrder: crystal.sortOrder ?? 0,
    metered: crystal.metered === true,
    currency: crystal.currency ?? 'USD',
    prices: crystal.prices ?? EMPTY_TIER_PRICES,
    discountOverrides: crystal.discountOverrides ?? {},
    inclusions: crystal.inclusions ?? EMPTY_TIER_INCLUSIONS,
    quotas: crystal.quotas
  });
  if (sanitized.ok === false) return null;
  const savedDiscounts = savedDiscountsFromUnknown(crystal.discounts);
  return {
    id: tierId,
    versionId: String(doc.shareId),
    version,
    status,
    ...sanitized.content,
    quotas: { ...sanitized.content.quotas, speedTestsPerHour: speedTestsPerHour(tierId, sanitized.content.quotas) },
    // Published history must not drift when a future formula changes. New and
    // updated revisions persist the resolved matrix; only legacy docs compute.
    discounts: savedDiscounts ?? computeTierDiscounts(sanitized.content.prices, sanitized.content.discountOverrides),
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
    publishedAt: toIso(crystal.publishedAt),
    archivedAt: toIso(crystal.archivedAt)
  };
};

let bootstrapPromise: Promise<void> | null = null;

export const ensureBuiltInSubscriptionTiers = async (): Promise<void> => {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    // The warmup is deliberately fire-and-forget; first catalog access must
    // still await the unique revision/live indexes before seeding across
    // concurrent serverless instances.
    await ensureIndexes();
    const things = await getThingsCollection();
    const now = new Date();
    await Promise.all(
      SUBSCRIPTION_TIER_CATALOG.map(async (descriptor) => {
        const existing = await things.findOne({ shareId: descriptor.versionId });
        if (existing) {
          const tier = descriptorFromDoc(existing);
          if (tier?.id === descriptor.id && tier.version === descriptor.version) return;
          throw new Error(`Reserved subscription tier id ${descriptor.versionId} is occupied by a non-tier Thing`);
        }
        try {
          await things.insertOne(descriptorToInsert(descriptor, 'system', now));
        } catch (error: any) {
          if (error?.code !== 11000) throw error;
          const winner = descriptorFromDoc(await things.findOne({ shareId: descriptor.versionId }));
          if (winner?.id === descriptor.id && winner.version === descriptor.version) return;
          throw new Error(`Reserved subscription tier id ${descriptor.versionId} could not be bootstrapped`);
        }
      })
    );
  })().catch((error) => {
    bootstrapPromise = null;
    throw error;
  });
  return bootstrapPromise;
};

export const listSubscriptionTierVersions = async (statuses?: SubscriptionTierStatus[]): Promise<SubscriptionTierDescriptor[]> => {
  await ensureBuiltInSubscriptionTiers();
  await recoverInterruptedTierPublishes();
  const things = await getThingsCollection();
  const docs = await things
    .find({
      ...TIER_DOC_FILTER,
      ...(statuses?.length ? { 'crystal.status': { $in: statuses } } : {})
    })
    .sort({ 'crystal.sortOrder': 1, 'crystal.title': 1, 'crystal.version': -1 })
    .toArray();
  return docs.map(descriptorFromDoc).filter((tier): tier is SubscriptionTierDescriptor => !!tier);
};

export const listLiveSubscriptionTiers = async (): Promise<SubscriptionTierDescriptor[]> => {
  const live = await listSubscriptionTierVersions(['live']);
  const things = await getThingsCollection();
  const transitions = await things
    .find({
      ...TIER_DOC_FILTER,
      'crystal.status': 'draft',
      'crystal.publishIntent.previousVersionId': { $type: 'string' }
    })
    .toArray();
  const missing = transitions.filter((target) => !live.some((tier) => tier.id === target.crystal?.tierId));
  if (missing.length) {
    const previousIds = missing.map((target) => String(target.crystal.publishIntent.previousVersionId));
    const previousDocs = await things.find({ ...TIER_DOC_FILTER, shareId: { $in: previousIds } }).toArray();
    for (const doc of previousDocs) {
      const tier = descriptorFromDoc(doc);
      if (tier && !live.some((entry) => entry.id === tier.id)) {
        // During the two atomic writes of a standalone-Mongo publish, keep the
        // prior revision effectively live for readers. Its persisted status stays
        // archived and is never rewritten merely by this read-through.
        live.push({ ...tier, status: 'live' });
      }
    }
  }
  // Promotion may clear the intent between the first live read and the
  // transition read. Re-read once and let the newer live revision replace the
  // availability fallback while retaining an earlier revision for any tier
  // caught in the archive→promote gap.
  const refreshedDocs = await things.find({ ...TIER_DOC_FILTER, 'crystal.status': 'live' }).toArray();
  const byTier = new Map(live.map((tier) => [tier.id, tier]));
  for (const doc of refreshedDocs) {
    const tier = descriptorFromDoc(doc);
    if (tier) byTier.set(tier.id, tier);
  }
  return [...byTier.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
};

export const getSubscriptionTierVersion = async (versionId: unknown): Promise<SubscriptionTierDescriptor | null> => {
  const id = typeof versionId === 'string' ? versionId.trim() : '';
  if (!id) return null;
  await ensureBuiltInSubscriptionTiers();
  await recoverInterruptedTierPublishes();
  const doc = await (
    await getThingsCollection()
  ).findOne({
    shareId: id,
    ...TIER_DOC_FILTER
  });
  return descriptorFromDoc(doc);
};

export const getLiveSubscriptionTier = async (tierIdInput: unknown, versionIdInput?: unknown): Promise<SubscriptionTierDescriptor | null> => {
  const tierId = typeof tierIdInput === 'string' ? tierIdInput.trim() : '';
  const versionId = typeof versionIdInput === 'string' ? versionIdInput.trim() : '';
  if (!tierId) return null;
  await ensureBuiltInSubscriptionTiers();
  await recoverInterruptedTierPublishes();
  const doc = await (
    await getThingsCollection()
  ).findOne({
    ...TIER_DOC_FILTER,
    'crystal.tierId': tierId,
    'crystal.status': 'live',
    ...(versionId ? { shareId: versionId } : {})
  });
  if (doc) return descriptorFromDoc(doc);
  const things = await getThingsCollection();
  const transition = await things.findOne({
    ...TIER_DOC_FILTER,
    'crystal.tierId': tierId,
    'crystal.status': 'draft',
    'crystal.publishIntent.previousVersionId': versionId || { $type: 'string' }
  });
  if (!transition) {
    // Promotion can clear the intent after the first live read. A second live
    // read closes that document-level handoff gap.
    return descriptorFromDoc(
      await things.findOne({
        ...TIER_DOC_FILTER,
        'crystal.tierId': tierId,
        'crystal.status': 'live',
        ...(versionId ? { shareId: versionId } : {})
      })
    );
  }
  const previousVersionId = String(transition.crystal.publishIntent.previousVersionId);
  const previous = descriptorFromDoc(
    await things.findOne({
      ...TIER_DOC_FILTER,
      shareId: previousVersionId
    })
  );
  return previous ? { ...previous, status: 'live' } : null;
};

export const createSubscriptionTierDraft = async (
  input: TierMutationInput,
  actorId: string
): Promise<{ ok: true; tier: SubscriptionTierDescriptor } | Fail> => {
  const sanitized = sanitizeTierContent(input);
  if (sanitized.ok === false) return sanitized;
  await ensureBuiltInSubscriptionTiers();
  await recoverInterruptedTierPublishes();
  const tierId = tierIdFromTitle(sanitized.content.title);
  const now = new Date();
  const tier: SubscriptionTierDescriptor = {
    id: tierId,
    versionId: versionShareId(tierId, 1),
    version: 1,
    status: 'draft',
    ...sanitized.content,
    discounts: computeTierDiscounts(sanitized.content.prices, sanitized.content.discountOverrides),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    publishedAt: null,
    archivedAt: null
  };
  try {
    await (await getThingsCollection()).insertOne(descriptorToInsert(tier, actorId, now));
  } catch (error: any) {
    if (error?.code === 11000) return fail(409, 'A tier with that revision already exists; try again');
    throw error;
  }
  return { ok: true, tier };
};

export const createSubscriptionTierDraftVersion = async (
  sourceVersionId: unknown,
  actorId: string
): Promise<{ ok: true; tier: SubscriptionTierDescriptor } | Fail> => {
  const source = await getSubscriptionTierVersion(sourceVersionId);
  if (!source) return fail(404, 'Tier version not found');
  const things = await getThingsCollection();
  const existingDraft = await things.findOne({
    ...TIER_DOC_FILTER,
    'crystal.tierId': source.id,
    'crystal.status': 'draft'
  });
  if (existingDraft) return fail(409, 'This tier already has a draft version');
  const latest = await things
    .find({ ...TIER_DOC_FILTER, 'crystal.tierId': source.id })
    .sort({ 'crystal.version': -1 })
    .limit(1)
    .next();
  const version = Math.max(source.version, Number(latest?.crystal?.version || 0)) + 1;
  const now = new Date();
  const tier: SubscriptionTierDescriptor = {
    ...source,
    versionId: versionShareId(source.id, version),
    version,
    status: 'draft',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    publishedAt: null,
    archivedAt: null
  };
  try {
    await things.insertOne(descriptorToInsert(tier, actorId, now, source.versionId));
  } catch (error: any) {
    if (error?.code === 11000) return fail(409, 'Another draft version was created; refresh and continue there');
    throw error;
  }
  return { ok: true, tier };
};

export const updateSubscriptionTierDraft = async (
  versionIdInput: unknown,
  input: TierMutationInput,
  actorId: string
): Promise<{ ok: true; tier: SubscriptionTierDescriptor } | Fail> => {
  const versionId = typeof versionIdInput === 'string' ? versionIdInput.trim() : '';
  if (!versionId) return fail(400, 'versionId is required');
  const sanitized = sanitizeTierContent(input);
  if (sanitized.ok === false) return sanitized;
  await ensureBuiltInSubscriptionTiers();
  await recoverInterruptedTierPublishes();
  const now = new Date();
  const content = sanitized.content;
  const discounts = computeTierDiscounts(content.prices, content.discountOverrides);
  const updated = await (
    await getThingsCollection()
  ).findOneAndUpdate(
    {
      shareId: versionId,
      ...TIER_DOC_FILTER,
      'crystal.status': 'draft',
      'crystal.publishIntent': { $exists: false }
    },
    {
      $set: {
        'crystal.title': content.title,
        'crystal.tagline': content.tagline,
        'crystal.emoji': content.emoji,
        'crystal.bannerImageUrl': content.bannerImageUrl,
        'crystal.sortOrder': content.sortOrder,
        'crystal.metered': content.metered,
        'crystal.currency': content.currency,
        'crystal.prices': content.prices,
        'crystal.discountOverrides': content.discountOverrides,
        'crystal.discounts': discounts,
        'crystal.discountFormulaVersion': 1,
        'crystal.inclusions': content.inclusions,
        'crystal.quotas': content.quotas,
        'crystal.updatedBy': actorId,
        updatedAt: now
      }
    },
    { returnDocument: 'after' }
  );
  if (!updated) return fail(409, 'Only draft tier versions can be edited');
  const tier = descriptorFromDoc(updated);
  return tier ? { ok: true, tier } : fail(500, 'Saved tier could not be read back');
};

const PUBLISH_LOCK_MS = 5 * 60 * 1000;
const publishLockKey = (tierId: string) => `subscription-tier-publish:${tierId}`;

const acquirePublishLock = async (tierId: string, token: string): Promise<boolean> => {
  const now = new Date();
  try {
    const lock = await (
      await getSettingsCollection()
    ).findOneAndUpdate(
      {
        key: publishLockKey(tierId),
        $or: [{ lockExpiresAt: { $exists: false } }, { lockExpiresAt: { $lte: now } }, { lockToken: token }]
      },
      {
        $set: {
          lockToken: token,
          lockExpiresAt: new Date(now.getTime() + PUBLISH_LOCK_MS),
          updatedAt: now
        },
        $setOnInsert: {
          key: publishLockKey(tierId),
          schemaVersion: COLLECTION_SCHEMA_VERSIONS.settings,
          createdAt: now
        }
      },
      { upsert: true, returnDocument: 'after' }
    );
    return lock?.lockToken === token;
  } catch (error: any) {
    if (error?.code === 11000) return false;
    throw error;
  }
};

const renewPublishLock = async (tierId: string, token: string): Promise<boolean> => {
  const now = new Date();
  const renewed = await (
    await getSettingsCollection()
  ).updateOne(
    {
      key: publishLockKey(tierId),
      lockToken: token,
      lockExpiresAt: { $gt: now }
    },
    {
      $set: {
        lockExpiresAt: new Date(now.getTime() + PUBLISH_LOCK_MS),
        updatedAt: now
      }
    }
  );
  return renewed.matchedCount === 1;
};

const releasePublishLock = async (tierId: string, token: string): Promise<void> => {
  try {
    await (
      await getSettingsCollection()
    ).updateOne(
      { key: publishLockKey(tierId), lockToken: token },
      {
        $unset: { lockToken: '', lockExpiresAt: '' },
        $set: { updatedAt: new Date() }
      }
    );
  } catch {
    // Unlock is best-effort: token matching prevents deleting a successor's
    // lease and the bounded expiry is the durable fallback. A successful tier
    // publish must not become a 500 solely because settings cleanup failed.
  }
};

const promoteDraftUnderLock = async (
  versionId: string,
  actorId: string,
  token: string
): Promise<{ ok: true; tier: SubscriptionTierDescriptor } | Fail> => {
  const things = await getThingsCollection();
  const target = await things.findOne({ shareId: versionId, ...TIER_DOC_FILTER });
  if (!target) return fail(404, 'Tier version not found');
  if (target.crystal?.status === 'live') {
    const tier = descriptorFromDoc(target);
    return tier ? { ok: true, tier } : fail(500, 'Published tier could not be read back');
  }
  if (target.crystal?.status !== 'draft') {
    return fail(409, 'Only a draft tier version can be published');
  }
  const tierId = String(target.crystal?.tierId ?? '');
  if (!tierId || !(await renewPublishLock(tierId, token))) {
    return fail(409, 'The tier publish lease expired; refresh and try again');
  }

  const now = new Date();
  const previous = await things.findOne({
    ...TIER_DOC_FILTER,
    'crystal.tierId': tierId,
    'crystal.status': 'live'
  });
  const previousVersionId = previous?.shareId ?? target.crystal?.publishIntent?.previousVersionId ?? null;
  const observedIntentToken = typeof target.crystal?.publishIntent?.token === 'string' ? target.crystal.publishIntent.token : null;
  if (!(await renewPublishLock(tierId, token))) {
    return fail(409, 'The tier publish lease expired; refresh and try again');
  }
  const marked = await things.updateOne(
    {
      shareId: versionId,
      ...TIER_DOC_FILTER,
      'crystal.status': 'draft',
      // Compare the intent observed with the target. A stale holder cannot
      // overwrite a recovery journal written by the successor that took its
      // expired lease.
      ...(observedIntentToken ? { 'crystal.publishIntent.token': observedIntentToken } : { 'crystal.publishIntent': { $exists: false } })
    },
    {
      $set: {
        'crystal.publishIntent': { token, previousVersionId, actorId, startedAt: now },
        'crystal.updatedBy': actorId,
        updatedAt: now
      }
    }
  );
  if (!marked.matchedCount) return fail(409, 'The tier changed while publishing; refresh and try again');

  try {
    if (!(await renewPublishLock(tierId, token))) {
      return fail(409, 'The tier publish lease expired; refresh and try again');
    }
    // Archive only the revision observed before this publish. A stale holder
    // can never archive a successor's newly-live target after its lease expires.
    if (previousVersionId && previousVersionId !== versionId) {
      await things.updateOne(
        {
          shareId: previousVersionId,
          ...TIER_DOC_FILTER,
          'crystal.status': 'live'
        },
        {
          $set: {
            'crystal.status': 'archived',
            'crystal.archivedAt': now,
            'crystal.updatedBy': actorId,
            updatedAt: now
          }
        }
      );
    }
    if (!(await renewPublishLock(tierId, token))) {
      return fail(409, 'The tier publish lease expired; refresh and try again');
    }
    const published = await things.findOneAndUpdate(
      {
        shareId: versionId,
        ...TIER_DOC_FILTER,
        'crystal.status': 'draft',
        'crystal.publishIntent.token': token
      },
      {
        $set: {
          'crystal.status': 'live',
          'crystal.publishedAt': now,
          'crystal.updatedBy': actorId,
          updatedAt: now
        },
        $unset: { 'crystal.archivedAt': '', 'crystal.publishIntent': '' }
      },
      { returnDocument: 'after' }
    );
    const tier = descriptorFromDoc(published);
    if (!tier) throw new Error('Tier changed while publishing');
    return { ok: true, tier };
  } catch (error) {
    // Leave the token-scoped intent durable. The next catalog access resumes it
    // under a fresh lease, and read-through keeps the prior revision available
    // meanwhile. Cross-document compensation here would let an expired holder
    // restore or clear state after a successor has taken over.
    throw error;
  }
};

let recoveryPromise: Promise<void> | null = null;
let recoveredAt = 0;

const recoverInterruptedTierPublishes = async (): Promise<void> => {
  if (recoveryPromise) return recoveryPromise;
  if (Date.now() - recoveredAt < 5000) return;
  recoveryPromise = (async () => {
    const things = await getThingsCollection();
    const interrupted = await things
      .find({
        ...TIER_DOC_FILTER,
        'crystal.status': 'draft',
        'crystal.publishIntent': { $exists: true }
      })
      .limit(20)
      .toArray();
    for (const target of interrupted) {
      const tierId = String(target.crystal?.tierId ?? '');
      if (!tierId) continue;
      const token = randomBytes(16).toString('hex');
      if (!(await acquirePublishLock(tierId, token))) continue;
      try {
        await promoteDraftUnderLock(String(target.shareId), String(target.crystal?.publishIntent?.actorId || 'system'), token);
      } finally {
        await releasePublishLock(tierId, token);
      }
    }
    recoveredAt = Date.now();
  })().finally(() => {
    recoveryPromise = null;
  });
  return recoveryPromise;
};

export const publishSubscriptionTierDraft = async (
  versionIdInput: unknown,
  actorId: string
): Promise<{ ok: true; tier: SubscriptionTierDescriptor } | Fail> => {
  const versionId = typeof versionIdInput === 'string' ? versionIdInput.trim() : '';
  if (!versionId) return fail(400, 'versionId is required');
  await ensureBuiltInSubscriptionTiers();
  await recoverInterruptedTierPublishes();
  const things = await getThingsCollection();
  const target = await things.findOne({ shareId: versionId, ...TIER_DOC_FILTER });
  if (!target) return fail(404, 'Tier version not found');
  if (target.crystal?.status === 'live') {
    const tier = descriptorFromDoc(target);
    return tier ? { ok: true, tier } : fail(500, 'Published tier could not be read back');
  }
  if (target.crystal?.status !== 'draft') return fail(409, 'Only a draft tier version can be published');
  const tierId = String(target.crystal?.tierId ?? '');
  const token = randomBytes(16).toString('hex');
  if (!(await acquirePublishLock(tierId, token))) {
    return fail(409, 'Another publish is already running for this tier; refresh and try again');
  }
  try {
    return await promoteDraftUnderLock(versionId, actorId, token);
  } catch (error: any) {
    if (error?.code === 11000 || error?.message === 'Tier changed while publishing') {
      return fail(409, 'The tier changed while publishing; refresh and try again');
    }
    throw error;
  } finally {
    await releasePublishLock(tierId, token);
  }
};

export const archiveSubscriptionTierVersion = async (
  versionIdInput: unknown,
  actorId: string
): Promise<{ ok: true; tier: SubscriptionTierDescriptor } | Fail> => {
  const versionId = typeof versionIdInput === 'string' ? versionIdInput.trim() : '';
  if (!versionId) return fail(400, 'versionId is required');
  const existing = await getSubscriptionTierVersion(versionId);
  if (!existing) return fail(404, 'Tier version not found');
  if (existing.status === 'archived') return { ok: true, tier: existing };
  if (existing.status === 'live' && existing.id === DEFAULT_SUBSCRIPTION_TIER) {
    return fail(409, 'The live default tier cannot be archived; publish its replacement draft instead');
  }
  const now = new Date();
  const updated = await (
    await getThingsCollection()
  ).findOneAndUpdate(
    {
      shareId: versionId,
      ...TIER_DOC_FILTER,
      // Status is a CAS boundary: a draft that became the live default after
      // the guard above must not be archived by this stale request.
      'crystal.status': existing.status,
      'crystal.publishIntent': { $exists: false }
    },
    {
      $set: {
        'crystal.status': 'archived',
        'crystal.archivedAt': now,
        'crystal.updatedBy': actorId,
        updatedAt: now
      }
    },
    { returnDocument: 'after' }
  );
  if (!updated) {
    const current = await getSubscriptionTierVersion(versionId);
    return current?.status === 'archived' ? { ok: true, tier: current } : fail(409, 'Tier changed while archiving; refresh and try again');
  }
  const tier = descriptorFromDoc(updated);
  return tier ? { ok: true, tier } : fail(500, 'Archived tier could not be read back');
};

export const tierQuotasFromUnknown = (value: unknown): TierQuotas | null => {
  const sanitized = sanitizeTierQuotas(value);
  return sanitized.ok ? sanitized.quotas : null;
};

export const tierAssignmentSnapshot = (tier: SubscriptionTierDescriptor) => ({
  tierId: tier.id,
  versionId: tier.versionId,
  version: tier.version,
  title: tier.title,
  metered: tier.metered,
  quotas: tier.quotas
});

export const isCompleteTierQuotas = (value: unknown): value is TierQuotas => {
  const quotas = tierQuotasFromUnknown(value);
  return !!quotas && REQUIRED_TIER_QUOTA_FIELDS.every((field) => field in quotas);
};
