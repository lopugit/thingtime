// Relative + extensioned so `node --test` can load this module without the
// bundler's `~` alias (same stance as mongodb/collectionNames.ts).
import { DEFAULT_APP_STORAGE_ALLOWANCE_BYTES, MAX_APPS_PER_USER } from '../../../schemas/registry.ts';

// Pure subscription-tier types, defaults, money math, and quota sanitizers.
// Mongo-backed version history lives in tierCatalogStore.ts; keeping this file
// pure lets the browser tier cards and node:test share the exact same pricing
// and quota rules without bundling a database client.

export type SubscriptionTierId = string;
export type SubscriptionTierStatus = 'draft' | 'live' | 'archived';

export type TierQuotas = {
  appStorageBytes: number | null;
  userStorageBytes: number | null;
  maxApps: number | null;
  maxPats: number | null;
  // Absent only on immutable revisions predating network-test entitlements.
  speedTestsPerHour?: number | null;
};

export type TierPricePeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type TierPrices = Record<TierPricePeriod, number | null>;

export const TIER_DISCOUNT_COMPARISONS = [
  { key: 'weeklyFromDaily', target: 'weekly', source: 'daily', label: 'Weekly compared with daily' },
  { key: 'monthlyFromDaily', target: 'monthly', source: 'daily', label: 'Monthly compared with daily' },
  { key: 'monthlyFromWeekly', target: 'monthly', source: 'weekly', label: 'Monthly compared with weekly' },
  { key: 'yearlyFromDaily', target: 'yearly', source: 'daily', label: 'Yearly compared with daily' },
  { key: 'yearlyFromWeekly', target: 'yearly', source: 'weekly', label: 'Yearly compared with weekly' },
  { key: 'yearlyFromMonthly', target: 'yearly', source: 'monthly', label: 'Yearly compared with monthly' }
] as const;

export type TierDiscountKey = (typeof TIER_DISCOUNT_COMPARISONS)[number]['key'];
export type TierDiscountOverrides = Partial<Record<TierDiscountKey, number>>;
export type TierDiscounts = Record<TierDiscountKey, number | null>;

export type TierInclusions = {
  kind: 'rich-text';
  blocks: Array<{ type: string; data: Record<string, unknown>; id?: string; tunes?: Record<string, unknown> }>;
};

export type SubscriptionTierDescriptor = {
  // Stable product id plus immutable revision identity.
  id: SubscriptionTierId;
  versionId: string;
  version: number;
  status: SubscriptionTierStatus;
  title: string;
  tagline: string;
  // Compatibility alias used by existing tier-card callers.
  description: string;
  emoji: string;
  bannerImageUrl: string | null;
  sortOrder: number;
  metered: boolean;
  currency: string;
  // Integer minor units (cents for two-decimal currencies), never floats.
  prices: TierPrices;
  discountOverrides: TierDiscountOverrides;
  discounts: TierDiscounts;
  inclusions: TierInclusions;
  quotas: TierQuotas;
  createdAt?: string | null;
  updatedAt?: string | null;
  publishedAt?: string | null;
  archivedAt?: string | null;
};

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const EMPTY_TIER_PRICES: TierPrices = {
  daily: null,
  weekly: null,
  monthly: null,
  yearly: null
};

export const EMPTY_TIER_INCLUSIONS: TierInclusions = {
  kind: 'rich-text',
  blocks: [{ type: 'paragraph', data: { text: '' } }]
};

const EMPTY_DISCOUNTS: TierDiscounts = {
  weeklyFromDaily: null,
  monthlyFromDaily: null,
  monthlyFromWeekly: null,
  yearlyFromDaily: null,
  yearlyFromWeekly: null,
  yearlyFromMonthly: null
};

// Normalize every renewal option to one year before comparing it. This makes
// all six comparisons internally consistent (365 daily, 52 weekly, 12 monthly,
// one yearly renewal) and avoids pretending every month has exactly 28 days.
const RENEWALS_PER_YEAR: Record<TierPricePeriod, number> = {
  daily: 365,
  weekly: 52,
  monthly: 12,
  yearly: 1
};

const roundPercent = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export const computeTierDiscounts = (prices: TierPrices, overrides: TierDiscountOverrides = {}): TierDiscounts => {
  const result: TierDiscounts = { ...EMPTY_DISCOUNTS };
  for (const comparison of TIER_DISCOUNT_COMPARISONS) {
    const custom = overrides[comparison.key];
    if (typeof custom === 'number' && Number.isFinite(custom)) {
      result[comparison.key] = roundPercent(custom);
      continue;
    }
    const sourcePrice = prices[comparison.source];
    const targetPrice = prices[comparison.target];
    if (
      sourcePrice === null ||
      targetPrice === null ||
      !Number.isSafeInteger(sourcePrice) ||
      !Number.isSafeInteger(targetPrice) ||
      sourcePrice <= 0 ||
      targetPrice < 0
    ) {
      result[comparison.key] = null;
      continue;
    }
    const sourceAnnual = sourcePrice * RENEWALS_PER_YEAR[comparison.source];
    const targetAnnual = targetPrice * RENEWALS_PER_YEAR[comparison.target];
    result[comparison.key] = roundPercent((1 - targetAnnual / sourceAnnual) * 100);
  }
  return result;
};

// ISO 4217 currencies do not all use two fractional digits (JPY uses zero,
// KWD uses three). The currency itself is the durable exponent source, so UI
// amount conversion and display stay aligned without a second editable field.
export const currencyMinorUnitFactor = (currency: string): number => {
  try {
    const digits = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: String(currency || '')
        .trim()
        .toUpperCase()
    }).resolvedOptions().maximumFractionDigits;
    return 10 ** Math.min(4, Math.max(0, digits));
  } catch {
    return 100;
  }
};

const builtIn = (
  id: 'free' | 'plus' | 'pro' | 'payg',
  title: string,
  tagline: string,
  emoji: string,
  sortOrder: number,
  metered: boolean,
  quotas: TierQuotas
): SubscriptionTierDescriptor => ({
  id,
  versionId: `subscription-tier-${id}-v1`,
  version: 1,
  status: 'live',
  title,
  tagline,
  description: tagline,
  emoji,
  bannerImageUrl: null,
  sortOrder,
  metered,
  currency: 'USD',
  prices: { ...EMPTY_TIER_PRICES },
  discountOverrides: {},
  discounts: { ...EMPTY_DISCOUNTS },
  inclusions: {
    kind: 'rich-text',
    blocks: [{ type: 'paragraph', data: { text: tagline } }]
  },
  quotas
});

// Bootstrap catalog. These immutable v1 descriptors are inserted into the
// Thingtime database on first catalog access; after an admin publishes v2 the
// old v1 record remains archived so historical assignments still resolve.
export const SUBSCRIPTION_TIER_CATALOG: SubscriptionTierDescriptor[] = [
  builtIn('free', 'Free', 'The default tier every account starts on.', '🌱', 0, false, {
    appStorageBytes: DEFAULT_APP_STORAGE_ALLOWANCE_BYTES,
    userStorageBytes: 500 * MB,
    maxApps: MAX_APPS_PER_USER,
    maxPats: 200,
    speedTestsPerHour: 4
  }),
  builtIn('plus', 'Plus', 'Roomier budgets for active builders.', '🌿', 10, false, {
    appStorageBytes: 25 * GB,
    userStorageBytes: 5 * GB,
    maxApps: 50,
    maxPats: 500,
    speedTestsPerHour: 20
  }),
  builtIn('pro', 'Pro', 'High ceilings for heavy apps and fleets of tokens.', '🌳', 20, false, {
    appStorageBytes: 100 * GB,
    userStorageBytes: 20 * GB,
    maxApps: 100,
    maxPats: 1000,
    speedTestsPerHour: null
  }),
  builtIn('payg', 'Pay as you go', 'No hard caps — usage is metered by the byte ledgers and billed.', '⚡️', 30, true, {
    appStorageBytes: null,
    userStorageBytes: null,
    maxApps: null,
    maxPats: null,
    speedTestsPerHour: null
  })
];

export const DEFAULT_SUBSCRIPTION_TIER: SubscriptionTierId = 'free';

// Static checks remain useful for reading legacy assignments that predate the
// database catalog. New assignments are validated against live DB revisions.
export const isKnownSubscriptionTier = (value: unknown): value is SubscriptionTierId =>
  typeof value === 'string' && SUBSCRIPTION_TIER_CATALOG.some((tier) => tier.id === value);

export const subscriptionTierById = (id: SubscriptionTierId): SubscriptionTierDescriptor =>
  SUBSCRIPTION_TIER_CATALOG.find((tier) => tier.id === id) ?? SUBSCRIPTION_TIER_CATALOG[0];

export type QuotaOverrides = Partial<TierQuotas>;

export const QUOTA_OVERRIDE_FIELDS = ['appStorageBytes', 'userStorageBytes', 'maxApps', 'maxPats', 'speedTestsPerHour'] as const;

export const QUOTA_OVERRIDE_BOUNDS: Record<keyof TierQuotas, { min: number; max: number }> = {
  appStorageBytes: { min: 0, max: 1024 * GB },
  userStorageBytes: { min: 0, max: 1024 * GB },
  maxApps: { min: 0, max: 100000 },
  maxPats: { min: 0, max: 1000000 },
  speedTestsPerHour: { min: 0, max: 1000 }
};

export const sanitizeQuotaOverrides = (input: unknown): { ok: true; overrides: QuotaOverrides | null } | { ok: false; error: string } => {
  if (input === undefined || input === null) return { ok: true, overrides: null };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'overrides must be an object of quota fields' };
  }

  const overrides: QuotaOverrides = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!(QUOTA_OVERRIDE_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: `Unknown quota field: ${key}` };
    }
    const field = key as keyof TierQuotas;
    if (raw === null) {
      overrides[field] = null;
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      return {
        ok: false,
        error: `${field} must be a number of ${field.endsWith('Bytes') ? 'bytes' : 'items'}, or null for unlimited`
      };
    }
    const bounds = QUOTA_OVERRIDE_BOUNDS[field];
    overrides[field] = Math.min(bounds.max, Math.max(bounds.min, Math.floor(value)));
  }

  return { ok: true, overrides: Object.keys(overrides).length ? overrides : null };
};

export const sanitizeTierQuotas = (input: unknown): { ok: true; quotas: TierQuotas } | { ok: false; error: string } => {
  const sanitized = sanitizeQuotaOverrides(input);
  if (sanitized.ok === false) return sanitized;
  const quotas = sanitized.overrides;
  if (!quotas || QUOTA_OVERRIDE_FIELDS.some((field) => field !== 'speedTestsPerHour' && !(field in quotas))) {
    return { ok: false, error: 'quotas must include appStorageBytes, userStorageBytes, maxApps, and maxPats' };
  }
  return { ok: true, quotas: quotas as TierQuotas };
};

export const resolveQuotas = (base: TierQuotas, overrides?: QuotaOverrides | null): TierQuotas => {
  if (!overrides) return { ...base };
  const resolved: TierQuotas = { ...base };
  for (const field of QUOTA_OVERRIDE_FIELDS) {
    if (field in overrides) resolved[field] = overrides[field] ?? null;
  }
  return resolved;
};

export const resolveTierQuotas = (tierId: SubscriptionTierId, overrides?: QuotaOverrides | null): TierQuotas =>
  resolveQuotas(subscriptionTierById(tierId).quotas, overrides);

// New entitlements must also work for historical, pinned assignments without
// rewriting their pricing/storage history. Explicit revision/admin values win.
export const speedTestsPerHour = (tierId: string, quotas: Pick<TierQuotas, 'speedTestsPerHour'>): number | null => {
  const value = quotas.speedTestsPerHour;
  if (value === null) return null;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1000) return value;
  if (value !== undefined) return 0; // malformed entitlement never grants access
  return subscriptionTierById(tierId).quotas.speedTestsPerHour ?? null;
};

export const speedTestAllowanceLabel = (allowance: number | null): string => (allowance === null ? 'Unlimited' : `${allowance} tests / hour`);
