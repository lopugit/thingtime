import { getAuthToken } from './authCookie';
import { verifyJwt } from './jwt';
import { getLiveSession } from './sessions';
import { findUserById, toPublicUser } from './users';
import type { PublicUser } from './users';

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

  return toPublicUser(user);
};
