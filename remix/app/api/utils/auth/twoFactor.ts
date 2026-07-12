import { getUserTwoFactorEmailEnabled, setUserTwoFactorEmailEnabled } from './users';

// Opt-in email 2FA flag lives in user meta (meta.twoFactorEmailEnabled) — login
// checks it before minting a session (see loginUser.ts). Reads and writes go
// through the dual-era user store: thing-era users keep the flag inside the
// secure blob, legacy users under users.meta.

export const getTwoFactorEmailEnabled = (userId: string): Promise<boolean> =>
  getUserTwoFactorEmailEnabled(userId);

export type SetTwoFactorResult =
  | { ok: false; status: number; error: string }
  | { ok: true; enabled: boolean };

export const setTwoFactorEmailEnabled = async (
  userId: string,
  enabled: boolean,
  emailVerified: boolean
): Promise<SetTwoFactorResult> => {
  // Codes are delivered to the account email — enabling 2FA behind an
  // unverified address would be a self-lockout waiting to happen.
  if (enabled && !emailVerified) {
    return { ok: false, status: 400, error: 'Verify your email before enabling email 2FA' };
  }
  if (!(await setUserTwoFactorEmailEnabled(userId, enabled))) {
    return { ok: false, status: 404, error: 'Account not found' };
  }
  return { ok: true, enabled };
};
