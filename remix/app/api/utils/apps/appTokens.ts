import { signJwt, verifyJwt } from '../auth/jwt';
import { createSession, getLiveSession } from '../auth/sessions';
import { findUserById, toPublicUser } from '../auth/users';
import type { PublicUser } from '../auth/users';
import { appAllowsOrigin, findAppByClientId } from './apps';

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

export type AppTokenGrant = { token: string; tokenType: 'Bearer'; expiresAt: Date };

export const issueAppToken = async (
  userId: string,
  clientId: string,
  origin: string
): Promise<AppTokenGrant> => {
  const expiresAt = new Date(Date.now() + APP_TOKEN_TTL_MS);
  const session = await createSession(userId, {
    purpose: 'app',
    expiresAt,
    meta: { clientId, origin }
  });
  const token = await signJwt({ sub: userId, jti: session.jti, expiresIn: '30d' });
  return { token, tokenType: 'Bearer', expiresAt };
};

export type AppTokenContext = {
  user: PublicUser;
  clientId: string;
  origin: string;
  jti: string;
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

  return { user: toPublicUser(user), clientId, origin, jti: claims.jti };
};
