import { createCookie } from '~/api/cookies';

// httpOnly cookie holding the JWTs of EVERY signed-in account (the account
// switcher roster) as a JSON array of token strings. `tt_auth` stays the single
// ACTIVE credential — everything that authenticates requests keeps reading it —
// while this cookie only feeds the switcher (list / switch / remove).
export const accountsCookie = createCookie('tt_accounts', {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 60 * 60 * 24 * 30 // 30 days, same as tt_auth
});

// Browsers cap a cookie at ~4KB; five ES256 JWTs JSON-encoded stay well under
// it with headroom for the active cookie beside them.
export const MAX_ACCOUNTS = 5;

// Roster tokens from the request cookie. Anything that isn't a non-empty
// string array collapses to [] — a tampered cookie never throws.
export const parseAccountTokens = async (request: Request): Promise<string[]> => {
  const value = await accountsCookie.parse(request.headers.get('Cookie'));
  if (!Array.isArray(value)) return [];
  return value.filter((token): token is string => typeof token === 'string' && !!token);
};

export const serializeAccountsCookie = (tokens: string[]) => accountsCookie.serialize(tokens);
export const clearAccountsCookie = () => accountsCookie.serialize([], { maxAge: 0 });
