import { getAuthToken } from './authCookie';
import { verifyJwt } from './jwt';
import type { JwtClaims } from './jwt';
import { getLiveSession } from './sessions';
import { findUserById, toPublicUser } from './users';
import type { PublicUser } from './users';

const SERVICE_EMAIL_VERIFICATION_GRACE_MS = 1000 * 60 * 60 * 24 * 7;

const serviceEmailVerificationDueAt = (user: any) => {
  if (user.emailVerificationRequiredBy) {
    return new Date(user.emailVerificationRequiredBy).getTime();
  }

  return new Date(user.createdAt).getTime() + SERVICE_EMAIL_VERIFICATION_GRACE_MS;
};

export type ResolvedTokenUser = { user: PublicUser; claims: JwtClaims };

// Resolve a signed JWT to its live user, or null. This is THE token→user path:
// getCurrentUser (active cookie / Bearer) and the account-switcher roster
// (accounts.ts) both go through it so a token is either valid everywhere or
// nowhere. Verifies: JWT signature + exp → session is still live in Mongo →
// user exists.
export const resolveTokenUser = async (token: string): Promise<ResolvedTokenUser | null> => {
  const claims = await verifyJwt(token);
  if (!claims) return null;

  // Revocation check: the JWT's jti must map to a live session for the same
  // user. Without the userId binding, a token signed with any live jti could
  // claim a different sub.
  const session = await getLiveSession(claims.jti);
  if (!session) return null;
  if (String(session.userId) !== claims.sub) return null;

  const user = await findUserById(claims.sub);
  if (!user) return null;
  if (
    user.accountKind === 'service' &&
    !user.emailVerified &&
    serviceEmailVerificationDueAt(user) < Date.now()
  ) {
    return null;
  }

  return { user: toPublicUser(user), claims };
};

// Resolve the authenticated user for a request, or null.
export const getCurrentUser = async (request: Request): Promise<PublicUser | null> => {
  const token = await getAuthToken(request);
  if (!token) return null;

  const resolved = await resolveTokenUser(token);
  return resolved ? resolved.user : null;
};
