export type StorageUsage = {
  usedBytes: number;
  allowanceBytes: number;
};

export type AppStorageReservation = StorageUsage & {
  userAllowanceBytes: number;
};

export type DualStorageAdmission =
  | { ok: true; app: AppStorageReservation; user: StorageUsage }
  | { ok: false; exhausted: 'app' | 'user' };

// Stored quota fields are server-owned integers. Keeping the normalization in
// one dependency-free helper makes old/partial app docs safe to project while
// the migration is pending, without making them writable before accounting is
// initialized.
export const storedByteCount = (value: unknown, fallback: number): number =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback;

export const storageUsage = (usedBytes: unknown, allowanceBytes: unknown, fallbackAllowance: number): StorageUsage => {
  const allowance = storedByteCount(allowanceBytes, fallbackAllowance);
  return {
    usedBytes: storedByteCount(usedBytes, 0),
    allowanceBytes: allowance
  };
};

export const remainingStorageBytes = (usage: StorageUsage): number =>
  Math.max(0, usage.allowanceBytes - usage.usedBytes);

// A registered-app write spans two independently atomic counters: the whole
// app and this app user. Reserve the broadest resource first. If the narrower
// user ledger refuses (or errors), compensate the app reservation exactly once.
// A process crash can therefore only leave conservative over-counting, repaired
// by the namespace-sum migration; neither counter can be overshot by races.
export const admitAppAndUserStorage = async (operations: {
  reserveApp: () => Promise<AppStorageReservation | null>;
  reserveUser: (allowanceBytes: number) => Promise<StorageUsage | null>;
  refundApp: () => Promise<void>;
}): Promise<DualStorageAdmission> => {
  const app = await operations.reserveApp();
  if (!app) return { ok: false, exhausted: 'app' };

  let user: StorageUsage | null;
  try {
    user = await operations.reserveUser(app.userAllowanceBytes);
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
