import { getSessionsCollection } from '../mongodb/collections';

const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;

export type SessionDoc = {
  jti: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  type: 'tt.session';
};

// Create a server-side session. The `jti` goes into the JWT so the token can be
// revoked by flipping/deleting this record (FUNDAMENTALS.md §5).
export const createSession = async (userId: string): Promise<SessionDoc> => {
  const now = new Date();
  const session: SessionDoc = {
    jti: crypto.randomUUID(),
    userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + THIRTY_DAYS_MS),
    revokedAt: null,
    type: 'tt.session'
  };
  await (await getSessionsCollection()).insertOne(session);
  return session;
};

// Returns the session only if it exists, isn't revoked, and hasn't expired.
export const getLiveSession = async (jti: string) => {
  const session = await (await getSessionsCollection()).findOne({ jti });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) return null;
  return session;
};

export const revokeSession = async (jti: string) => {
  await (await getSessionsCollection()).updateOne({ jti }, { $set: { revokedAt: new Date() } });
};
