import { newAuthToken } from './tokens';

// Shared single-use, time-limited token machinery for the auth flows that mint
// them (email verification, password reset). Both used to carry a line-for-line
// copy of the same doc shape + atomic burn + invalid/used/expired mapping — a
// security-sensitive path where a hardening fix to one copy must reach the other.
// Parameterized only by the collection getter + schemaVersion + TTL.

export type SingleUseTokenDoc = {
  token: string;
  userId: string;
  email: string;
  schemaVersion: number;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
};

export type ConsumeTokenResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: 'invalid' | 'used' | 'expired' };

// Issue a token: random opaque value, normalized email, now + TTL expiry.
export const createSingleUseToken = async ({
  getCollection,
  schemaVersion,
  userId,
  email,
  expiresInMs
}: {
  getCollection: () => Promise<any>;
  schemaVersion: number;
  userId: string;
  email: string;
  expiresInMs: number;
}): Promise<SingleUseTokenDoc> => {
  const now = new Date();
  const doc: SingleUseTokenDoc = {
    token: newAuthToken(),
    userId,
    email: email.trim().toLowerCase(),
    schemaVersion,
    createdAt: now,
    expiresAt: new Date(now.getTime() + expiresInMs),
    consumedAt: null
  };
  await (await getCollection()).insertOne(doc);
  return doc;
};

// Validate + burn a token atomically. Single-use: if two clicks race, only one
// update can match consumedAt: null; the loser sees the token as used/expired.
export const consumeSingleUseToken = async (
  getCollection: () => Promise<any>,
  token: string
): Promise<ConsumeTokenResult> => {
  const coll = await getCollection();
  const now = new Date();

  const consumed = await coll.findOneAndUpdate(
    {
      token,
      consumedAt: null,
      expiresAt: { $gt: now }
    },
    { $set: { consumedAt: now } },
    { returnDocument: 'after' }
  );

  if (consumed) return { ok: true, userId: consumed.userId, email: consumed.email };

  const doc = await coll.findOne({ token });
  if (!doc) return { ok: false, reason: 'invalid' };
  if (doc.consumedAt) return { ok: false, reason: 'used' };
  return { ok: false, reason: 'expired' };
};
