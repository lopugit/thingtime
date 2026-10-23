import { createCookie } from '~/api/cookies';

// httpOnly cookie identifying this browser's account-switcher roster. It holds
// ONLY an opaque roster id — the account list itself lives in the Mongo
// `rosters` collection (accounts.ts), so the switcher is unlimited and the
// cookie stays constant-size. `tt_auth` remains the single ACTIVE credential.
//
// Rosters minted before the Mongo backing stored a JSON array of JWTs in this
// same cookie; parseAccountsCookie still surfaces that legacy shape so
// resolveRoster can fold it into a roster doc.
export const accountsCookie = createCookie('tt_accounts', {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 60 * 60 * 24 * 30 // 30 days, same as tt_auth
});

export type AccountsCookieValue = {
  rosterId: string | null;
  // JWTs from a pre-Mongo roster cookie, pending fold-in.
  legacyTokens: string[];
};

// Tampered/unknown cookie shapes collapse to an empty value — never throw.
export const parseAccountsCookie = async (request: Request): Promise<AccountsCookieValue> => {
  const value = await accountsCookie.parse(request.headers.get('Cookie'));
  if (typeof value === 'string' && value) return { rosterId: value, legacyTokens: [] };
  if (Array.isArray(value)) {
    return {
      rosterId: null,
      legacyTokens: value.filter((token): token is string => typeof token === 'string' && !!token)
    };
  }
  return { rosterId: null, legacyTokens: [] };
};

export const serializeAccountsCookie = (rosterId: string) => accountsCookie.serialize(rosterId);
export const clearAccountsCookie = () => accountsCookie.serialize('', { maxAge: 0 });
