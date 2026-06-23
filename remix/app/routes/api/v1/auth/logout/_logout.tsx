import { json } from '@vercel/remix';

import { clearAuthCookie, getAuthToken } from '~/api/utils/auth/authCookie';
import { verifyJwt } from '~/api/utils/auth/jwt';
import { revokeSession } from '~/api/utils/auth/sessions';

// POST /api/v1/auth/logout — revoke the session in Mongo and clear the cookie.
export const action = async ({ request }: { request: Request }) => {
  const token = await getAuthToken(request);
  if (token) {
    const claims = await verifyJwt(token);
    if (claims) await revokeSession(claims.jti);
  }
  return json({ ok: true }, { headers: { 'Set-Cookie': await clearAuthCookie() } });
};
