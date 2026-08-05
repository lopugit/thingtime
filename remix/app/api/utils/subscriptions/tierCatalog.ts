// Relative + extensioned so `node --test` can load this module without the
// bundler's `~` alias (same stance as mongodb/collectionNames.ts).
import { DEFAULT_APP_STORAGE_ALLOWANCE_BYTES, MAX_APPS_PER_USER } from '../../../schemas/registry.ts';

// The subscription tier catalog — a pure module (no Mongo, no Node built-ins)
// so the client tier selector and the server quota resolver share one source
// of truth, exactly like auth/patScopes.ts does for PAT permissions.
//
// The model:
//   • A SUBJECT (a user, or an app by clientId) has at most one subscription
//     assignment (a protected `subscription` thing — see
//     api/utils/subscriptions/subscriptions.ts). No assignment means `free`.
//   • A TIER supplies the default quota numbers. `payg` is the metered tier:
//     no hard caps (every quota is null = unbounded), usage is measured by the
//     existing byte ledgers and billed instead of blocked.
//   • ADMIN OVERRIDES are orthogonal to the tier: a per-field partial stored
//     on the assignment. An override field wins over the tier default;
//     explicitly-null override fields mean "unlimited for this subject".
//     A subject with any override shows as "custom" in the admin UI.
//   • `null` ANYWHERE in resolved quotas means unlimited — enforcement sites
//     skip their cap check for null.

export type SubscriptionTierId = 'free' | 'plus' | 'pro' | 'payg';

export type TierQuotas = {
  // Aggregate storage budget across every user namespace owned by an app.
  appStorageBytes: number | null;
  // Per-user overall storage allowance in bytes (surfaced on the user; the
  // admin UI edits it — general enforcement is a follow-up, see PR notes).
  userStorageBytes: number | null;
  // How many apps one user may register.
  maxApps: number | null;
  // How many personal access tokens one user may hold.
  maxPats: number | null;
};

export type SubscriptionTierDescriptor = {
  id: SubscriptionTierId;
  title: string;
  description: string;
  emoji: string;
  // Metered tiers bill usage instead of blocking at a cap.
  metered: boolean;
  quotas: TierQuotas;
};

const MB = 1024 * 1024;
const GB = 1024 * MB;

// Free mirrors today's hardcoded product caps, so an unassigned subject
// behaves exactly as before this system existed. (maxPats mirrors
// MAX_PAT_TOKENS_PER_USER in auth/patTokens.ts — that module is Mongo-bound
// and cannot be imported from this pure catalog.)
export const SUBSCRIPTION_TIER_CATALOG: SubscriptionTierDescriptor[] = [
  {
    id: 'free',
    title: 'Free',
    description: 'The default tier every account starts on.',
    emoji: '🌱',
    metered: false,
    quotas: {
      appStorageBytes: DEFAULT_APP_STORAGE_ALLOWANCE_BYTES,
      userStorageBytes: 500 * MB,
      maxApps: MAX_APPS_PER_USER,
      maxPats: 200
    }
  },
  {
    id: 'plus',
    title: 'Plus',
    description: 'Roomier budgets for active builders.',
    emoji: '🌿',
    metered: false,
    quotas: {
      appStorageBytes: 25 * GB,
      userStorageBytes: 5 * GB,
      maxApps: 50,
      maxPats: 500
    }
  },
  {
    id: 'pro',
    title: 'Pro',
    description: 'High ceilings for heavy apps and fleets of tokens.',
    emoji: '🌳',
    metered: false,
    quotas: {
      appStorageBytes: 100 * GB,
      userStorageBytes: 20 * GB,
      maxApps: 100,
      maxPats: 1000
    }
  },
  {
    id: 'payg',
    title: 'Pay as you go',
    description: 'No hard caps — usage is metered by the byte ledgers and billed.',
    emoji: '⚡️',
    metered: true,
    quotas: {
      appStorageBytes: null,
      userStorageBytes: null,
      maxApps: null,
      maxPats: null
    }
  }
];

export const DEFAULT_SUBSCRIPTION_TIER: SubscriptionTierId = 'free';

export const isKnownSubscriptionTier = (value: unknown): value is SubscriptionTierId =>
  SUBSCRIPTION_TIER_CATALOG.some((tier) => tier.id === value);

export const subscriptionTierById = (id: SubscriptionTierId): SubscriptionTierDescriptor =>
  SUBSCRIPTION_TIER_CATALOG.find((tier) => tier.id === id) ?? SUBSCRIPTION_TIER_CATALOG[0];

// Admin overrides: a partial of TierQuotas. Absent field = inherit the tier;
// number = replace; null = unlimited.
export type QuotaOverrides = Partial<TierQuotas>;

export const QUOTA_OVERRIDE_FIELDS = ['appStorageBytes', 'userStorageBytes', 'maxApps', 'maxPats'] as const;

// Clamp bounds — same stance as rateLimit/config.ts clampRule: an admin typo
// can never persist a nonsense number.
export const QUOTA_OVERRIDE_BOUNDS: Record<keyof TierQuotas, { min: number; max: number }> = {
  appStorageBytes: { min: 0, max: 1024 * GB },
  userStorageBytes: { min: 0, max: 1024 * GB },
  maxApps: { min: 0, max: 100000 },
  maxPats: { min: 0, max: 1000000 }
};

// Validate + clamp an override payload. Unknown keys fail loudly (a typo'd
// field should surface, not silently do nothing — patScopes stance).
export const sanitizeQuotaOverrides = (
  input: unknown
): { ok: true; overrides: QuotaOverrides | null } | { ok: false; error: string } => {
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
      return { ok: false, error: `${field} must be a number of ${field.endsWith('Bytes') ? 'bytes' : 'items'}, or null for unlimited` };
    }
    const bounds = QUOTA_OVERRIDE_BOUNDS[field];
    overrides[field] = Math.min(bounds.max, Math.max(bounds.min, Math.floor(value)));
  }

  return { ok: true, overrides: Object.keys(overrides).length ? overrides : null };
};

// The one merge rule: override field (including explicit null) wins; anything
// absent inherits the tier.
export const resolveTierQuotas = (tierId: SubscriptionTierId, overrides?: QuotaOverrides | null): TierQuotas => {
  const base = subscriptionTierById(tierId).quotas;
  if (!overrides) return { ...base };
  const resolved: TierQuotas = { ...base };
  for (const field of QUOTA_OVERRIDE_FIELDS) {
    if (field in overrides) resolved[field] = overrides[field] ?? null;
  }
  return resolved;
};
