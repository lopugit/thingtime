import { getSettingsCollection } from '../mongodb/collections';

// The `Thingtime.LopuAccess` settings singleton (design note "Lopu verified
// access, usage accounting and credits" §1): whether Lopu is invite-only,
// whether an unverified account may still run turns on its own Secure Vault
// provider, the starter credits a fresh account is granted once, and the
// balance below which the client warns. Same store pattern as
// lopuChatDefaults.ts: every read hits the home-DB singleton so an admin save
// is visible immediately on every warm instance; only a Mongo outage serves
// the last-known-good value, and a cold instance in an outage serves the hard
// default (which locks Lopu — fail closed, never open).

export const LOPU_ACCESS_KEY = 'Thingtime.LopuAccess' as const;

export type LopuAccessSettings = {
  // Lopu is invite-only: an account needs meta.lopuVerified (admins always pass)
  requireVerification: boolean;
  // an unverified account may still run turns on its own vault provider
  allowByoUnverified: boolean;
  // credits granted once, when the account is first created (0 = none)
  starterCredits: number;
  // the balance (credits) under which the client shows the amber warning
  lowBalanceWarningCredits: number;
};

export const DEFAULT_LOPU_ACCESS_SETTINGS: Readonly<LopuAccessSettings> = Object.freeze({
  requireVerification: true,
  allowByoUnverified: false,
  starterCredits: 0,
  lowBalanceWarningCredits: 1
});

export const LOPU_ACCESS_MAX_STARTER_CREDITS = 1000;
export const LOPU_ACCESS_MAX_LOW_BALANCE_CREDITS = 1000;

const SETTING_KEYS = ['requireVerification', 'allowByoUnverified', 'starterCredits', 'lowBalanceWarningCredits'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

// credits keep at most 6 decimals (one micro) and never go negative
const credits = (value: unknown, fallback: number, max: number): number => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(max, Math.round(number * 1_000_000) / 1_000_000);
};

// Forgiving read: a missing or corrupt document never locks the singleton
// into an unusable state — unknown fields are dropped, bad values fall back
// to the hard default for that field.
export const normalizeLopuAccessSettings = (value: unknown): LopuAccessSettings => {
  const raw = isRecord(value) ? value : {};
  return {
    requireVerification: typeof raw.requireVerification === 'boolean' ? raw.requireVerification : DEFAULT_LOPU_ACCESS_SETTINGS.requireVerification,
    allowByoUnverified: typeof raw.allowByoUnverified === 'boolean' ? raw.allowByoUnverified : DEFAULT_LOPU_ACCESS_SETTINGS.allowByoUnverified,
    starterCredits: credits(raw.starterCredits, DEFAULT_LOPU_ACCESS_SETTINGS.starterCredits, LOPU_ACCESS_MAX_STARTER_CREDITS),
    lowBalanceWarningCredits: credits(raw.lowBalanceWarningCredits, DEFAULT_LOPU_ACCESS_SETTINGS.lowBalanceWarningCredits, LOPU_ACCESS_MAX_LOW_BALANCE_CREDITS)
  };
};

export type ValidateLopuAccessSettingsResult = { ok: true; settings: LopuAccessSettings } | { ok: false; error: string };

// Strict write: the admin editor may send the whole shape or just the fields
// it changed (merged over `current`); every present field must be well
// formed — no silent clamping on the write path.
export const validateLopuAccessSettings = (value: unknown, current: LopuAccessSettings = DEFAULT_LOPU_ACCESS_SETTINGS): ValidateLopuAccessSettingsResult => {
  if (!isRecord(value)) return { ok: false, error: 'Send an object with requireVerification, allowByoUnverified, starterCredits and lowBalanceWarningCredits' };
  const unknown = Object.keys(value).filter((key) => !(SETTING_KEYS as readonly string[]).includes(key));
  if (unknown.length) return { ok: false, error: `Unknown Lopu access setting${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}` };
  const next: LopuAccessSettings = { ...current };
  for (const key of ['requireVerification', 'allowByoUnverified'] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'boolean') return { ok: false, error: `${key} must be true or false` };
    next[key] = value[key] as boolean;
  }
  const numeric: Array<[keyof LopuAccessSettings, number]> = [
    ['starterCredits', LOPU_ACCESS_MAX_STARTER_CREDITS],
    ['lowBalanceWarningCredits', LOPU_ACCESS_MAX_LOW_BALANCE_CREDITS]
  ];
  for (const [key, max] of numeric) {
    const raw = value[key];
    if (raw === undefined) continue;
    const number = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
    if (!Number.isFinite(number) || number < 0 || number > max) return { ok: false, error: `${key} must be a number of credits between 0 and ${max}` };
    (next as Record<string, unknown>)[key] = Math.round(number * 1_000_000) / 1_000_000;
  }
  return { ok: true, settings: next };
};

type StoreDependencies = {
  readStoredSettings: () => Promise<unknown>;
  writeStoredSettings: (settings: LopuAccessSettings, updatedBy: string) => Promise<void>;
};

export const createLopuAccessStore = (dependencies: StoreDependencies) => {
  let lastKnownGood: LopuAccessSettings | null = null;

  const getSettings = async (): Promise<LopuAccessSettings> => {
    try {
      const settings = normalizeLopuAccessSettings(await dependencies.readStoredSettings());
      lastKnownGood = settings;
      return { ...settings };
    } catch {
      // availability over freshness, and the hard default is the LOCKED
      // posture — an outage never opens Lopu to unverified accounts
      return { ...(lastKnownGood || DEFAULT_LOPU_ACCESS_SETTINGS) };
    }
  };

  // `value` may be partial: it is merged over the current stored settings
  // before strict validation, so the editor can save one switch at a time.
  const setSettings = async (value: unknown, updatedBy: string): Promise<LopuAccessSettings> => {
    const current = await getSettings();
    const validated = validateLopuAccessSettings(value, current);
    if (validated.ok === false) throw new TypeError(validated.error);
    const settings = { ...validated.settings };
    await dependencies.writeStoredSettings(settings, updatedBy);
    lastKnownGood = settings;
    return { ...settings };
  };

  return { getSettings, setSettings };
};

const store = createLopuAccessStore({
  readStoredSettings: async () => {
    const doc = await (await getSettingsCollection()).findOne(
      { key: LOPU_ACCESS_KEY },
      { projection: { _id: 0, requireVerification: 1, allowByoUnverified: 1, starterCredits: 1, lowBalanceWarningCredits: 1 } }
    );
    return doc ?? undefined;
  },
  writeStoredSettings: async (settings, updatedBy) => {
    await (await getSettingsCollection()).updateOne(
      { key: LOPU_ACCESS_KEY },
      {
        $set: {
          key: LOPU_ACCESS_KEY,
          requireVerification: settings.requireVerification,
          allowByoUnverified: settings.allowByoUnverified,
          starterCredits: settings.starterCredits,
          lowBalanceWarningCredits: settings.lowBalanceWarningCredits,
          updatedAt: new Date(),
          updatedBy
        }
      },
      { upsert: true }
    );
  }
});

export const getStoredLopuAccessSettings = store.getSettings;
export const setStoredLopuAccessSettings = store.setSettings;
