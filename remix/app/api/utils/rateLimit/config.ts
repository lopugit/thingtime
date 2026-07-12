import { getSettingsCollection } from '../mongodb/collections';

// Global, admin-editable rate-limit config. The endpoints below are the ones we
// throttle, with their DEFAULT limits; an admin overrides them via the admin
// panel (stored as a singleton `settings` doc, merged over these defaults). The
// merged config is cached briefly so limits are read cheaply per request while
// admin edits still take effect within seconds.

export type RateLimitRule = { limit: number; windowMs: number; enabled: boolean };
export type RateLimitConfig = Record<string, RateLimitRule>;

export const RATE_LIMIT_DEFAULTS: RateLimitConfig = {
  'things.react': { limit: 60, windowMs: 60_000, enabled: true },
  'things.comment': { limit: 20, windowMs: 60_000, enabled: true },
  // any other mutating write through /api/v1/things (create/upsert/patch/delete
  // posts and other thing kinds) — reactions/comments route to their own keys
  'things.write': { limit: 60, windowMs: 60_000, enabled: true },
  // Admin-only raw queries can still be expensive; keep accidental repeated
  // scans bounded independently from the ordinary app APIs.
  'mongodb.query': { limit: 30, windowMs: 60_000, enabled: true },
  // service accounts do legitimate bulk writes (e.g. chunked snapshot sync), so
  // they get a higher ceiling — but a BOUNDED one, never an exemption: anyone
  // can provision a service account, so accountKind confers no trust
  'things.write.service': { limit: 600, windowMs: 60_000, enabled: true }
};

export const RATE_LIMIT_ENDPOINTS = Object.keys(RATE_LIMIT_DEFAULTS);

const SETTINGS_KEY = 'rateLimits';
const CONFIG_TTL_MS = 15_000;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

let cache: { at: number; config: RateLimitConfig } | null = null;

const clampRule = (rule: any, fallback: RateLimitRule): RateLimitRule => ({
  limit: Number.isFinite(rule?.limit) ? Math.max(1, Math.min(100_000, Math.floor(rule.limit))) : fallback.limit,
  windowMs: Number.isFinite(rule?.windowMs)
    ? Math.max(1000, Math.min(MAX_WINDOW_MS, Math.floor(rule.windowMs)))
    : fallback.windowMs,
  enabled: rule?.enabled === undefined ? fallback.enabled : rule.enabled !== false
});

// Only known endpoints survive, each clamped — a stored/patched config can never
// widen the endpoint set or set nonsensical values.
const normalize = (endpoints: any): RateLimitConfig => {
  const out: RateLimitConfig = {};
  for (const [name, def] of Object.entries(RATE_LIMIT_DEFAULTS)) {
    out[name] = clampRule(endpoints?.[name], def);
  }
  return out;
};

export const getRateLimitConfig = async (force = false): Promise<RateLimitConfig> => {
  if (!force && cache && Date.now() - cache.at < CONFIG_TTL_MS) return cache.config;
  try {
    const doc = await (await getSettingsCollection()).findOne({ key: SETTINGS_KEY });
    const config = normalize(doc?.endpoints);
    cache = { at: Date.now(), config };
    return config;
  } catch {
    // fall back to the last cache or the defaults if the settings read fails
    return cache?.config || normalize(null);
  }
};

export const setRateLimitConfig = async (patch: RateLimitConfig, updatedBy: string): Promise<RateLimitConfig> => {
  const current = await getRateLimitConfig(true);
  const endpoints: RateLimitConfig = {};
  for (const [name, def] of Object.entries(RATE_LIMIT_DEFAULTS)) {
    // Merge the patch OVER the current stored rule, so a partial patch (e.g.
    // only { limit }) keeps the endpoint's other fields instead of resetting
    // them to defaults; then clamp. Non-object patch entries are ignored.
    const p = patch?.[name] && typeof patch[name] === 'object' ? patch[name] : {};
    endpoints[name] = clampRule({ ...current[name], ...p }, def);
  }
  await (await getSettingsCollection()).updateOne(
    { key: SETTINGS_KEY },
    { $set: { key: SETTINGS_KEY, endpoints, updatedAt: new Date(), updatedBy } },
    { upsert: true }
  );
  cache = { at: Date.now(), config: endpoints };
  return endpoints;
};
