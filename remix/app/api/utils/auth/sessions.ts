import { getSessionsCollection } from '../mongodb/collections';
import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';

const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;

export type SessionDoc = {
  jti: string;
  userId: string;
  schemaVersion: number;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  type: 'tt.session';
  // 'deployment-link' — minted by /api/v1/deployment-links/token for another
  // Thingtime deployment to sync with; full-credential like 'service', and
  // revocable the same way
  purpose?: 'browser' | 'service' | 'app' | 'app-sandbox' | 'pat' | 'deployment-link' | 'oauth-code' | 'chatgpt-oauth-code' | 'chatgpt-mcp' | 'chatgpt-mcp-refresh' | 'chatgpt-mcp-connection';
  meta?: Record<string, any>;
};

export type CreateSessionOptions = {
  expiresAt?: Date | null;
  purpose?: SessionDoc['purpose'];
  meta?: Record<string, any>;
};

// Create a server-side session. The `jti` goes into the JWT so the token can be
// revoked by flipping/deleting this record (FUNDAMENTALS.md §5).
export const createSession = async (
  userId: string,
  options: CreateSessionOptions = {}
): Promise<SessionDoc> => {
  const now = new Date();
  const session: SessionDoc = {
    jti: crypto.randomUUID(),
    userId,
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.sessions,
    createdAt: now,
    expiresAt:
      options.expiresAt === undefined
        ? new Date(now.getTime() + THIRTY_DAYS_MS)
        : options.expiresAt,
    revokedAt: null,
    type: 'tt.session',
    purpose: options.purpose ?? 'browser',
    meta: options.meta ?? {}
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
