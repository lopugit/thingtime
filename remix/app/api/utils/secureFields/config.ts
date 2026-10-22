import { getSettingsCollection } from '../mongodb/collections';

// Global, admin-editable secure-field storage config. Each field below is user
// private state that normally lives ONLY inside the BinData `secure` blob on
// user things (invisible to the $** wildcard text index, so never enumerable
// via q=<value> search). An admin can flip a field to plaintext mode, which
// maintains a root-level plaintext MIRROR of the blob value on every user
// thing so the DB can be queried directly (e.g. Compass `{ email: "..." }`)
// while debugging. The blob stays the single source of truth in both modes —
// the mirror is derived, regenerable data reconciled by the
// users-email-mirror-sync migration and self-healed on every secure-blob
// write. Defaults are SECURE; production should stay secure.
//
// Only fields in SECURE_FIELD_DEFAULTS can ever be toggled (an allowlist, like
// RATE_LIMIT_DEFAULTS): passwordHash and the rest of the blob are deliberately
// NOT here and must never be mirrorable.

export type SecureFieldRule = { secure: boolean };
export type SecureFieldsConfig = Record<string, SecureFieldRule>;

export const SECURE_FIELD_DEFAULTS: SecureFieldsConfig = {
  // The user's email address. secure=true → blob-only (hashed uniqueKey is the
  // only index trace). secure=false → root `email` mirror on user things; the
  // wildcard text index WILL tokenize it (search results still exclude user
  // things via the PROTECTED_THINGTIME $nin, but the index entries exist).
  email: { secure: true }
};

export const SECURE_FIELDS = Object.keys(SECURE_FIELD_DEFAULTS);

const SETTINGS_KEY = 'secureFields';
const CONFIG_TTL_MS = 15_000;

let cache: { at: number; config: SecureFieldsConfig } | null = null;

const clampRule = (rule: any, fallback: SecureFieldRule): SecureFieldRule => ({
  // Coerce to a strict boolean; anything but an explicit false stays secure,
  // so a malformed/partial patch can never silently disable blobbing.
  secure: rule?.secure === undefined ? fallback.secure : rule.secure !== false
});

// Only allowlisted fields survive, each clamped — a stored/patched config can
// never widen the togglable field set beyond SECURE_FIELD_DEFAULTS.
const normalize = (fields: any): SecureFieldsConfig => {
  const out: SecureFieldsConfig = {};
  for (const [name, def] of Object.entries(SECURE_FIELD_DEFAULTS)) {
    out[name] = clampRule(fields?.[name], def);
  }
  return out;
};

export const getSecureFieldsConfig = async (force = false): Promise<SecureFieldsConfig> => {
  if (!force && cache && Date.now() - cache.at < CONFIG_TTL_MS) return cache.config;
  try {
    const doc = await (await getSettingsCollection()).findOne({ key: SETTINGS_KEY });
    const config = normalize(doc?.fields);
    cache = { at: Date.now(), config };
    return config;
  } catch {
    // fall back to the last cache or the (secure) defaults if the read fails
    return cache?.config || normalize(null);
  }
};

export const setSecureFieldsConfig = async (patch: SecureFieldsConfig, updatedBy: string): Promise<SecureFieldsConfig> => {
  const current = await getSecureFieldsConfig(true);
  const fields: SecureFieldsConfig = {};
  for (const [name, def] of Object.entries(SECURE_FIELD_DEFAULTS)) {
    const p = patch?.[name] && typeof patch[name] === 'object' ? patch[name] : {};
    fields[name] = clampRule({ ...current[name], ...p }, def);
  }
  await (await getSettingsCollection()).updateOne(
    { key: SETTINGS_KEY },
    { $set: { key: SETTINGS_KEY, fields, updatedAt: new Date(), updatedBy } },
    { upsert: true }
  );
  cache = { at: Date.now(), config: fields };
  return fields;
};
