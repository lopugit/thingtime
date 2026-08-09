export type StorageUsage = {
  usedBytes: number;
  // null is the explicit metered/unlimited plan. Usage is still counted.
  allowanceBytes: number | null;
};

export type FiniteStorageUsage = {
  usedBytes: number;
  allowanceBytes: number;
};

export type AppStorageReservation = StorageUsage & {
  userAllowanceBytes: number;
};

export type DualStorageAdmission =
  | { ok: true; app: AppStorageReservation; user: FiniteStorageUsage }
  | { ok: false; exhausted: 'app' | 'user' };

// Stored quota fields are server-owned integers. Keeping the normalization in
// one dependency-free helper makes old/partial app docs safe to project while
// the migration is pending, without making them writable before accounting is
// initialized.
export const storedByteCount = (value: unknown, fallback: number): number =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback;

export const storedByteAllowance = (value: unknown, fallback: number | null): number | null =>
  value === null ? null : Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback;

export function storageUsage(usedBytes: unknown, allowanceBytes: unknown, fallbackAllowance: number): FiniteStorageUsage;
export function storageUsage(usedBytes: unknown, allowanceBytes: unknown, fallbackAllowance: number | null): StorageUsage;
export function storageUsage(
  usedBytes: unknown,
  allowanceBytes: unknown,
  fallbackAllowance: number | null
): StorageUsage {
  const allowance = storedByteAllowance(allowanceBytes, fallbackAllowance);
  return {
    usedBytes: storedByteCount(usedBytes, 0),
    allowanceBytes: allowance
  };
}

export const remainingStorageBytes = (usage: StorageUsage): number | null =>
  usage.allowanceBytes === null ? null : Math.max(0, usage.allowanceBytes - usage.usedBytes);

// The configured app-user value is always finite. A user override wins over
// the app default, then the whole-app ceiling clamps it so no sub-tier can
// ever promise more than the app itself owns.
export const effectiveAppUserAllowance = (
  defaultAllowanceBytes: number,
  overrideAllowanceBytes: unknown,
  appAllowanceBytes: number | null
): number => {
  const configured = storedByteCount(overrideAllowanceBytes, defaultAllowanceBytes);
  return appAllowanceBytes === null ? configured : Math.min(configured, appAllowanceBytes);
};

// A registered-app write spans two independently atomic counters: the whole
// app and this app user. Reserve the broadest resource first. If the narrower
// user ledger refuses (or errors), compensate the app reservation exactly once.
// A process crash can therefore only leave conservative over-counting, repaired
// by the namespace-sum migration; neither counter can be overshot by races.
export const admitAppAndUserStorage = async (operations: {
  reserveApp: () => Promise<AppStorageReservation | null>;
  reserveUser: (
    defaultAllowanceBytes: number,
    appAllowanceBytes: number | null
  ) => Promise<FiniteStorageUsage | null>;
  refundApp: () => Promise<void>;
}): Promise<DualStorageAdmission> => {
  const app = await operations.reserveApp();
  if (!app) return { ok: false, exhausted: 'app' };

  let user: FiniteStorageUsage | null;
  try {
    user = await operations.reserveUser(app.userAllowanceBytes, app.allowanceBytes);
  } catch (error) {
    // Do not retry an ambiguous refund: a network error may mean Mongo applied
    // it. One best-effort compensation preserves the no-undercount invariant.
    try {
      await operations.refundApp();
    } catch {
      // The original accounting failure is the actionable error. Any leaked
      // reservation is conservative and the reconcile pass repairs it.
    }
    throw error;
  }

  if (!user) {
    await operations.refundApp();
    return { ok: false, exhausted: 'user' };
  }

  return { ok: true, app, user };
};
