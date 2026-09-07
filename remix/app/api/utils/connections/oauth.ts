import { createHash, randomUUID } from 'node:crypto';

import { signPurposeToken, verifyPurposeToken } from '../auth/jwt';
import { upsertAccountAndLink, type PublicConnection } from './connections';
import { connectionProviderById, oauthCredsFor } from './providers';
import { fail, pkceVerifierFor, type Fail } from './shared';

// SSO account linking: POST /api/v1/connections/oauth/begin hands the client
// the provider's authorize URL; the provider's own sign-in page collects the
// credentials (Thingtime never sees a third-party password); the GET callback
// exchanges the code server-side and saves the token response into the
// external-account's secure blob. CSRF/state protection rides the house JWT
// signer: the state is a short-lived signed JWT bound to the beginning user's
// id, so a callback can only complete for the session that started it.
//
// It is a PURPOSE token, not a session JWT (signJwt), for the same reason the
// ChatGPT connector signs its OAuth request state that way: this token is the
// one credential-shaped value Thingtime deliberately hands to an arbitrary
// third party — it rides the authorize URL into the provider, its logs, the
// browser's history, and the callback's Referer. signJwt mints a `sub`+`jti`
// pair that IS the shape of a session cookie, and it is only inert today
// because every verifyJwt consumer independently re-checks the jti against a
// live Mongo session. The purpose claim makes that fencing structural instead
// of incidental: verifyJwt requires a jti, this token has none, so no session,
// PAT, app-token, or authorization-code path can ever be fed one of these.
const STATE_PURPOSE = 'connections-oauth';
const STATE_TTL = '15m';

type SessionUser = { id: string; username: string };

export const oauthCallbackPath = '/api/v1/connections/oauth/callback';

// Proxied dev stacks (Vite → Nitro, Tailscale funnel → Vite) reach Nitro on a
// loopback origin; honour the forwarded host so authorize redirects return to
// the address the browser actually used.
export const requestOrigin = (request: Request): string => {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  if (forwardedHost) return `${forwardedProto}://${forwardedHost.split(',')[0].trim()}`;
  return new URL(request.url).origin;
};

// The redirect URI must EXACTLY match what the provider app has registered.
// CONNECTIONS_OAUTH_REDIRECT_BASE pins it (e.g. the Tailscale funnel origin in
// local dev — TikTok and Meta require https); otherwise the request origin.
const redirectUriFor = (requestOrigin: string): string => {
  const base = (process.env.CONNECTIONS_OAUTH_REDIRECT_BASE || '').trim().replace(/\/+$/, '') || requestOrigin.replace(/\/+$/, '');
  return `${base}${oauthCallbackPath}`;
};

export const beginOAuth = async (
  user: SessionUser,
  input: { provider?: unknown },
  requestOrigin: string
): Promise<{ ok: true; authorizeUrl: string; provider: string } | Fail> => {
  const provider = connectionProviderById(input.provider);
  if (!provider) return fail(400, 'Unknown provider');
  if (!provider.oauth) return fail(400, `${provider.name} does not use OAuth — connect it via POST /api/v1/connections`);
  const creds = oauthCredsFor(provider);
  if (!creds) {
    return fail(400, `${provider.name} is not configured on this deployment yet (set ${provider.oauth.clientIdEnv} and ${provider.oauth.clientSecretEnv})`);
  }
  // PKCE (X requires it): the S256 verifier is derived from a server secret and
  // this nonce, so only the nonce rides the state JWT through the provider round
  // trip. The flow stays stateless and an attacker altering the nonce breaks the
  // signature, but — unlike carrying the verifier itself — whoever reads the
  // callback URL cannot recover it. See pkceVerifierFor in ./shared.
  const nonce = randomUUID();
  const codeVerifier = provider.oauth.pkce ? pkceVerifierFor(provider.id, nonce) : null;
  const codeChallenge = codeVerifier ? createHash('sha256').update(codeVerifier).digest('base64url') : undefined;
  const state = await signPurposeToken(STATE_PURPOSE, { sub: user.id, provider: provider.id, nonce }, STATE_TTL);
  return {
    ok: true,
    provider: provider.id,
    authorizeUrl: provider.oauth.buildAuthorizeUrl({ clientId: creds.clientId, redirectUri: redirectUriFor(requestOrigin), state, codeChallenge })
  };
};

// Callback: verify the state belongs to THIS session's user and names a real
// provider, exchange the code, resolve the external identity with the fresh
// tokens, then upsert account+link with the tokens sealed in the secure blob.
export const completeOAuth = async (
  user: SessionUser,
  params: { code?: string | null; state?: string | null; error?: string | null; errorDescription?: string | null },
  requestOrigin: string
): Promise<{ ok: true; connection: PublicConnection; provider: string } | Fail> => {
  if (params.error) {
    return fail(400, `The provider declined the sign-in: ${String(params.errorDescription || params.error).slice(0, 200)}`);
  }
  const state = typeof params.state === 'string' ? params.state : '';
  const code = typeof params.code === 'string' ? params.code : '';
  if (!state || !code) return fail(400, 'The sign-in response was missing its code or state');

  // verifyPurposeToken checks the signature, the expiry, and the purpose — a
  // session cookie, a PAT, or another purpose's token can never satisfy it.
  const claims = await verifyPurposeToken(state, STATE_PURPOSE);
  if (!claims) return fail(400, 'The sign-in state is invalid or expired — start the connect again');
  if (typeof claims.sub !== 'string' || claims.sub !== user.id) {
    return fail(403, 'This sign-in was started from a different Thingtime session');
  }
  const providerId = typeof claims.provider === 'string' ? claims.provider : '';
  const nonce = typeof claims.nonce === 'string' ? claims.nonce : '';
  const provider = connectionProviderById(providerId);
  if (!provider?.oauth) return fail(400, 'The sign-in state names an unknown provider');
  const creds = oauthCredsFor(provider);
  if (!creds) return fail(400, `${provider.name} is not configured on this deployment`);
  // Recomputed, not read back out of the state — the same derivation beginOAuth
  // used, keyed by the nonce the signature covers.
  const codeVerifier = provider.oauth.pkce ? pkceVerifierFor(provider.id, nonce) : undefined;

  const exchanged = await provider.oauth.exchangeCode({
    code,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    redirectUri: redirectUriFor(requestOrigin),
    codeVerifier
  });
  if (exchanged.ok === false) return exchanged;

  const resolved = await provider.oauth.resolveAccountFromTokens(exchanged.tokens);
  if (resolved.ok === false) return resolved;

  const linked = await upsertAccountAndLink(user, provider, resolved.account, exchanged.tokens);
  if (linked.ok === false) return linked;
  return { ok: true, connection: linked.connection, provider: provider.id };
};
