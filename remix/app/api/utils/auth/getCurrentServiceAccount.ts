import { getAuthToken } from './authCookie';
import { serviceAccountAuthenticationAllowed } from './getCurrentUser';
import { verifyJwt } from './jwt';
import { getLiveSession } from './sessions';
import { findUserById, toPublicUser } from './users';
import type { PublicUser } from './users';

export type ServiceAccountAuthResult =
  | { ok: true; user: PublicUser }
  | { ok: false; status: 401; code: 'UNAUTHORIZED'; error: 'Unauthorized' }
  | {
      ok: false;
      status: 403;
      code: 'SERVICE_ACCOUNT_REQUIRED';
      error: 'A service-account credential is required';
    };

const unauthorized = (): ServiceAccountAuthResult => ({
  ok: false,
  status: 401,
  code: 'UNAUTHORIZED',
  error: 'Unauthorized'
});

const serviceRequired = (): ServiceAccountAuthResult => ({
  ok: false,
  status: 403,
  code: 'SERVICE_ACCOUNT_REQUIRED',
  error: 'A service-account credential is required'
});

// Resolve either Authorization: Bearer or the normal httpOnly auth cookie,
// but accept only a live JWT whose Mongo session was minted specifically for
// service work. Checking accountKind alone is insufficient: a browser-purpose
// session must not silently become a server-to-server quota credential.
export const getCurrentServiceAccount = async (request: Request): Promise<ServiceAccountAuthResult> => {
  const token = await getAuthToken(request);
  if (!token) return unauthorized();

  const claims = await verifyJwt(token);
  if (!claims) return unauthorized();

  const session = await getLiveSession(claims.jti);
  if (!session || String(session.userId) !== claims.sub) return unauthorized();
  if (session.purpose !== 'service') return serviceRequired();

  const user = await findUserById(claims.sub);
  if (!user) return unauthorized();
  if (user.accountKind !== 'service') return serviceRequired();
  if (!serviceAccountAuthenticationAllowed(user)) return unauthorized();

  return { ok: true, user: toPublicUser(user) };
};
