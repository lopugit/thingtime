import { getAuthToken } from './authCookie';
import { verifyJwt } from './jwt';
import { getLiveSession } from './sessions';
import { findUserById, toPublicUser } from './users';
import type { PublicUser } from './users';
import { isAdminUsername } from './admin';

const SERVICE_EMAIL_VERIFICATION_GRACE_MS = 1000 * 60 * 60 * 24 * 7;

const serviceEmailVerificationDueAt = (user: any) => {
  if (user.emailVerificationRequiredBy) {
    return new Date(user.emailVerificationRequiredBy).getTime();
  }

  return new Date(user.createdAt).getTime() + SERVICE_EMAIL_VERIFICATION_GRACE_MS;
};

// Resolve the authenticated user for a request, or null.
// Verifies: JWT signature + exp → session is still live in Mongo → user exists.
export const getCurrentUser = async (request: Request): Promise<PublicUser | null> => {
  const token = await getAuthToken(request);
  if (!token) return null;

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

  return toPublicUser(user);
};

// Resolves the authed user only when they are an admin (see admin.ts). Routes:
//   const admin = await requireAdmin(request);
//   if (!admin) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
// A logged-in non-admin gets the same 401 as a logged-out caller — admin
// endpoints don't confirm they exist to non-admins.
export const requireAdmin = async (request: Request): Promise<PublicUser | null> => {
  const user = await getCurrentUser(request);
  if (!user || !isAdminUsername(user.username)) return null;
  return user;
};
