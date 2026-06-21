import { getAuthToken } from './authCookie';
import { verifyJwt } from './jwt';
import { getLiveSession } from './sessions';
import { findUserById, PublicUser, toPublicUser } from './users';

// Resolve the authenticated user for a request, or null.
// Verifies: JWT signature + exp → session is still live in Mongo → user exists.
export const getCurrentUser = async (request: Request): Promise<PublicUser | null> => {
  const token = await getAuthToken(request);
  if (!token) return null;

  const claims = await verifyJwt(token);
  if (!claims) return null;

  // revocation check: the JWT's jti must map to a live (un-revoked) session
  const session = await getLiveSession(claims.jti);
  if (!session) return null;

  const user = await findUserById(claims.sub);
  if (!user) return null;

  return toPublicUser(user);
};
