import { createCookie } from '~/api/cookies';

// httpOnly cookie that carries the signed JWT for browser sessions. The JWT is
// already signed, so the cookie itself just needs to be httpOnly + secure. API
// clients can skip the cookie and send `Authorization: Bearer <jwt>` instead.
export const authCookie = createCookie('tt_auth', {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 60 * 60 * 24 * 30 // 30 days
});

// Resolve the bearer token from the Authorization header first, then the cookie.
export const getAuthToken = async (request: Request): Promise<string | null> => {
  const header = request.headers.get('Authorization');
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  const cookieValue = await authCookie.parse(request.headers.get('Cookie'));
  return typeof cookieValue === 'string' && cookieValue ? cookieValue : null;
};

// Serialize helpers for setting / clearing the auth cookie on responses.
export const serializeAuthCookie = (jwt: string) => authCookie.serialize(jwt);
export const clearAuthCookie = () => authCookie.serialize('', { maxAge: 0 });
