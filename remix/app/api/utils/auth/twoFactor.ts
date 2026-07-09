import { ObjectId } from 'mongodb';

import { getUsersCollection } from '../mongodb/collections';

// Opt-in email 2FA flag lives in users.meta.twoFactorEmailEnabled — login
// checks it before minting a session (see loginUser.ts).

export const getTwoFactorEmailEnabled = async (userId: string): Promise<boolean> => {
  const users = await getUsersCollection();
  const doc = await users.findOne({ _id: new ObjectId(userId) }, { projection: { 'meta.twoFactorEmailEnabled': 1 } });
  return !!doc?.meta?.twoFactorEmailEnabled;
};

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
  const users = await getUsersCollection();
  await users.updateOne(
    { _id: new ObjectId(userId) },
    { $set: { 'meta.twoFactorEmailEnabled': enabled, updatedAt: new Date() } }
  );
  return { ok: true, enabled };
};
