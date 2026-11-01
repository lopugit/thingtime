import { createHash, createHmac } from 'node:crypto';

// Tiny shared kernel for the connections family — the error union and the
// deterministic-id hash live in exactly one place so the persisted shareId
// grammars (ext-account/ext-link/ext-post/ext-filter/ext-verdict) can never
// drift between modules.

export type Fail = { ok: false; status: number; error: string };
export const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

// What the OAuth callback is allowed to tell /connections went wrong.
//
// The callback is a plain GET landing: it answers with a redirect carrying a
// flag, and the page turns that flag into a Lopu toast. Anything it puts in
// that URL is therefore text ANYONE can choose — the route is reachable by
// aiming a signed-in victim at a crafted link, and `?oauthError=…` is readable
// straight off the address bar without involving the callback at all. Prose in
// the URL is consequently attacker-authored copy wearing Thingtime's own
// chrome ("your session expired, re-verify at …"), which is the whole value of
// a phishing lure. So the wire carries a CODE from this closed set and the
// page owns every word it renders (components/Connections/shared.ts).
//
// Keep this a flat, opaque slug list: the codes ARE the contract with the
// client mirror, and oauthErrorCopy.test.ts pins the two sets equal so adding
// one here without copy there fails the suite rather than silently degrading
// to the generic line.
export const OAUTH_ERROR_CODES = ['declined', 'state', 'session', 'provider', 'exchange', 'rateLimited', 'failed'] as const;
export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];

export const sha48 = (parts: string[]): string => {
  const hash = createHash('sha256');
  parts.forEach((part, index) => {
    if (index) hash.update('\0');
    hash.update(part);
  });
  return hash.digest('hex').slice(0, 48);
};

// Any stable server secret works as HMAC key material; every deployed config
// sets at least one of the JWT vars (auth requires it), so a verifier stays
// derivable across restarts and instances for the state's 15-minute life.
// Mirrors notifications/emails.ts's unsubscribe-token key resolution.
const pkceSecret = () =>
  process.env.CONNECTIONS_PKCE_SECRET?.trim() ||
  process.env.JWT_SECRET?.trim() ||
  process.env.JWT_PRIVATE_KEY?.trim() ||
  'dev-insecure-secret-change-me';

// The PKCE verifier for an outbound OAuth round trip, DERIVED from a server
// secret and the state's public nonce rather than carried inside the state.
//
// The state is a signed — not encrypted — JWT: it travels to the provider and
// comes back in the callback URL right beside the authorization code, and its
// payload is plain base64url that anyone who sees that URL can read (provider
// logs, browser history, a Referer off the callback page). A verifier embedded
// there is readable by exactly the attacker PKCE exists to stop — whoever
// intercepted the code — so the flow would keep PKCE's shape and none of its
// guarantee. Deriving it keeps the round trip stateless while the verifier
// itself never leaves this process.
//
// 32 HMAC bytes render as 43 base64url characters, which is RFC 7636's minimum
// verifier length and uses only its unreserved alphabet.
export const pkceVerifierFor = (providerId: string, nonce: string): string =>
  createHmac('sha256', pkceSecret()).update(`connections-pkce:v1:${providerId}:${nonce}`).digest('base64url');
