import { getAuthToken } from './authCookie';
import { verifyJwt } from './jwt';
import type { JwtClaims } from './jwt';
import { getLiveSession } from './sessions';
import { findUserById, toPublicUserWithStorage } from './users';
import type { PublicUser } from './users';
import { sessionPurposeCanActAsAccount } from './credentialPurpose';

const SERVICE_EMAIL_VERIFICATION_GRACE_MS = 1000 * 60 * 60 * 24 * 7;

const serviceEmailVerificationDueAt = (user: any) => {
  if (user.emailVerificationRequiredBy) {
    return new Date(user.emailVerificationRequiredBy).getTime();
  }

  return new Date(user.createdAt).getTime() + SERVICE_EMAIL_VERIFICATION_GRACE_MS;
};

export const serviceAccountAuthenticationAllowed = (user: any, now = Date.now()): boolean =>
  user.accountKind !== 'service' || !!user.emailVerified || serviceEmailVerificationDueAt(user) >= now;

export type ResolvedTokenUser = { user: PublicUser; claims: JwtClaims };

// Scoped credentials must opt into a dedicated resolver. Keeping the purpose
// predicate exported gives every new credential family a pure regression test:
// a device node can never become a full browser session merely because it uses
// the shared sessions collection.
export const isFullAccountSessionPurpose = (purpose: unknown): boolean => purpose === undefined || purpose === 'browser' || purpose === 'service';

// Resolve a live session id to its user, or null. This is THE session→user
// path: JWT resolution below and the account-switcher roster entries
// (accounts.ts, which stores {userId, jti} references) both go through it, so
// a session is either valid everywhere or nowhere. Verifies: session is still
// live in Mongo → it belongs to the expected user → the user exists.
export const resolveSessionUser = async (jti: string, expectedUserId: string): Promise<PublicUser | null> => {
  // Revocation check: the jti must map to a live session for the same user.
  // Without the userId binding, any live jti could claim a different user.
  const session = await getLiveSession(jti);
  if (!session) return null;
  if (String(session.userId) !== expectedUserId) return null;
  // App-scoped tokens (third-party "Login with Thingtime" grants) are never
  // full account credentials: they only work through the app-token path
  // (apps/appTokens.ts), which checks the purpose itself. Sandbox tokens
  // couldn't resolve anyway (their userId is no real user), but reject them
  // explicitly all the same. Personal access tokens (the Settings token
  // minter, auth/patTokens.ts) are likewise scoped credentials, not full
  // sessions — they only resolve through resolveThingsActor and the token
  // introspection endpoint, never here, so a PAT can never mint more tokens,
  // change auth settings, or reach unscoped surfaces.
  if (!sessionPurposeCanActAsAccount(session.purpose)) return null;

  const user = await findUserById(expectedUserId);
  if (!user) return null;
  if (!serviceAccountAuthenticationAllowed(user)) {
    return null;
  }

	return toPublicUserWithStorage(user);
};

// Resolve a signed JWT to its live user, or null. Verifies the signature + exp,
// then defers to the shared session→user path above.
export const resolveTokenUser = async (token: string): Promise<ResolvedTokenUser | null> => {
  const claims = await verifyJwt(token);
  if (!claims) return null;

  const user = await resolveSessionUser(claims.jti, claims.sub);
  if (!user) return null;

  return { user, claims };
};

// Resolve the authenticated user for a request, or null.
export const getCurrentUser = async (request: Request): Promise<PublicUser | null> => {
  const token = await getAuthToken(request);
  if (!token) return null;

  const resolved = await resolveTokenUser(token);
  return resolved ? resolved.user : null;
};
