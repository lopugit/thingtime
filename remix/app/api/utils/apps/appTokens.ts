import { signJwt, verifyJwt } from '../auth/jwt';
import { createSession, getLiveSession } from '../auth/sessions';
import { findUserById, toPublicUser } from '../auth/users';
import type { PublicUser } from '../auth/users';
import { getSessionsCollection } from '../mongodb/collections';
import { appAllowsOrigin, findAppByClientId } from './apps';
import { sessionScopes } from './scopes';
import type { AppScopeId } from './scopes';
import { MAX_APP_SESSIONS_PER_APP_USER } from '~/schemas/registry';

// App-scoped tokens: the credential a third-party site holds after a user
// approves "Login with Thingtime". Same revocable-JWT model as every other
// Thingtime credential (FUNDAMENTALS.md §5) — the session doc carries
// purpose 'app' + { clientId, origin }, and the general auth path
// (getCurrentUser/resolveSessionUser) rejects purpose 'app' outright, so an
// app token can never act as the user's full account credential.

const APP_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;

// The user identity shared with an embedding site — deliberately minimal
// (never email, verification state, storage, or admin flags).
export type EmbedUser = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export const toEmbedUser = (user: PublicUser): EmbedUser => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl
});

export type AppTokenGrant = {
  token: string;
  tokenType: 'Bearer';
  expiresAt: Date;
  scopes: AppScopeId[];
  sharedThings: string[];
};

export const issueAppToken = async (
  userId: string,
  clientId: string,
  origin: string,
  scopes: AppScopeId[],
  sharedThings: string[] = []
): Promise<AppTokenGrant> => {
  const expiresAt = new Date(Date.now() + APP_TOKEN_TTL_MS);
  const session = await createSession(userId, {
    purpose: 'app',
    expiresAt,
    meta: { clientId, origin, scopes, sharedThings }
  });
  const token = await signJwt({ sub: userId, jti: session.jti, expiresIn: '30d' });

  // Bound accumulation: keep only the newest N live sessions for this
  // (user, app) and revoke the rest. Racing mints can briefly overshoot the
  // cap (each keeps its own newest-N view); the next mint prunes the drift.
  // The find is served by the sessions userId index.
  const sessions = await getSessionsCollection();
  const liveForApp = { purpose: 'app', userId, 'meta.clientId': clientId, revokedAt: null };
  const keep = await sessions
    .find(liveForApp, { projection: { jti: 1 } })
    .sort({ createdAt: -1 })
    .limit(MAX_APP_SESSIONS_PER_APP_USER)
    .toArray();
  await sessions.updateMany(
    { ...liveForApp, jti: { $nin: keep.map((doc: any) => doc.jti) } },
    { $set: { revokedAt: new Date() } }
  );

  return { token, tokenType: 'Bearer', expiresAt, scopes, sharedThings };
};

export type AppTokenContext = {
  user: PublicUser;
  clientId: string;
  origin: string;
  jti: string;
  scopes: AppScopeId[];
  sharedThings: string[];
};

// Resolve an app-scoped Bearer token, or null. Bearer-only on purpose: app
// tokens live in third-party page JS and never ride a Thingtime cookie, so a
// cross-site request can't use ambient credentials. The grant also dies with
// its app: the app must still exist and must still allow the bound origin.
export const resolveAppToken = async (request: Request): Promise<AppTokenContext | null> => {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const claims = await verifyJwt(token);
  if (!claims) return null;

  const session = await getLiveSession(claims.jti);
  if (!session || session.purpose !== 'app') return null;
  if (String(session.userId) !== claims.sub) return null;

  const clientId = session.meta?.clientId;
  const origin = session.meta?.origin;
  if (typeof clientId !== 'string' || typeof origin !== 'string') return null;

  const app = await findAppByClientId(clientId);
  if (!app || !appAllowsOrigin(app, origin)) return null;

  const user = await findUserById(claims.sub);
  if (!user) return null;

  const sharedThings = Array.isArray(session.meta?.sharedThings)
    ? session.meta.sharedThings.filter((id: unknown) => typeof id === 'string')
    : [];

  return {
    user: toPublicUser(user),
    clientId,
    origin,
    jti: claims.jti,
    scopes: sessionScopes(session.meta),
    sharedThings
  };
};
