import type { Binary } from 'mongodb';
import { currentSessionRepository, currentPatSessionPersistence, PatSessionLimitError } from './sessionRepository';
import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
export { REVOKED_SESSION_REAP_MS, revokedSessionPipeline } from './sessionCore';

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
  // 'device-pairing'/'watch-pairing'/'device' — native device handshakes and the long-lived
  // credential it upgrades into, revocable the same way
  // 'file-sync-transfer' — no credential of its own; binds the exact issuing
  // browser and paired device sessions to one existing upload reservation.
  // A file-sync-photo-run can mint only exact original reservations for its current private Photos backup.
  purpose?: 'browser' | 'service' | 'app' | 'app-sandbox' | 'pat' | 'deployment-link' | 'device-pairing' | 'watch-pairing' | 'device' | 'file-sync-transfer' | 'file-sync-photo-run' | 'oauth-code' | 'chatgpt-oauth-code' | 'chatgpt-oauth-relay' | 'chatgpt-mcp' | 'chatgpt-mcp-refresh' | 'chatgpt-mcp-connection' | 'chatgpt-mcp-mutation' | 'chatgpt-mcp-mutation-chunk';
  secureVaultKey?: Binary;
  meta?: Record<string, any>;
};

export type CreateSessionOptions = {
  /** Internal PAT mint admission; never copied from a request/session payload. */
  patLimit?: number | null;
  // A signed one-time authorization request can supply its preallocated ID so
  // repeated consent submissions collide on the existing unique jti index.
  jti?: string;
  expiresAt?: Date | null;
  purpose?: SessionDoc['purpose'];
  meta?: Record<string, any>;
	session?: any;
};

// Create a server-side session. The `jti` goes into the JWT so the token can be
// revoked by flipping/deleting this record (FUNDAMENTALS.md §5).
export const createSession = async (userId: string, options: CreateSessionOptions = {}): Promise<SessionDoc> => {
  const now = new Date();
  const session: SessionDoc = {
    jti: options.jti ?? crypto.randomUUID(),
    userId,
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.sessions,
    createdAt: now,
		expiresAt: options.expiresAt === undefined ? new Date(now.getTime() + THIRTY_DAYS_MS) : options.expiresAt,
    revokedAt: null,
    type: 'tt.session',
    purpose: options.purpose ?? 'browser',
    meta: options.meta ?? {}
  };
	if (options.patLimit !== undefined) {
    if (session.purpose !== 'pat' || options.session || (options.patLimit !== null && (!Number.isSafeInteger(options.patLimit) || options.patLimit < 0))) throw new Error('Invalid personal token mint admission');
    if (!await currentPatSessionPersistence().insert(session, options.patLimit)) throw new PatSessionLimitError();
  } else await currentSessionRepository().insert(session, options.session);
  return session;
};

// Returns the session only if it exists, isn't revoked, and hasn't expired.
export const getLiveSession = async (jti: string) => {
  const session = await currentSessionRepository().findByJti(jti);
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) return null;
  return session;
};

// Repository implementations apply the same authoritative revocation policy:
// preserve an existing expiry, give non-expiring rows a finite reap date, and
// remove secureVaultKey in the same mutation. Reads still enforce expiry even
// where the backend has no TTL cleanup worker yet.
export const revokeSession = async (jti: string) => {
  await currentSessionRepository().revoke(jti, new Date());
};
