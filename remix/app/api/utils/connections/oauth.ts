import { randomUUID } from 'node:crypto';

import { signJwt, verifyJwt } from '../auth/jwt';
import { upsertAccountAndLink, type PublicConnection } from './connections';
import { connectionProviderById, type ConnectionProvider } from './providers';

// SSO account linking: POST /api/v1/connections/oauth/begin hands the client
// the provider's authorize URL; the provider's own sign-in page collects the
// credentials (Thingtime never sees a third-party password); the GET callback
// exchanges the code server-side and saves the token response into the
// external-account's secure blob. CSRF/state protection rides the house JWT
// signer: the state is a short-lived signed JWT bound to the beginning user's
// id, so a callback can only complete for the session that started it.

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

const STATE_JTI_PREFIX = 'connections-oauth:';
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

const oauthCreds = (provider: ConnectionProvider): { clientId: string; clientSecret: string } | null => {
  if (!provider.oauth) return null;
  const clientId = (process.env[provider.oauth.clientIdEnv] || '').trim();
  const clientSecret = (process.env[provider.oauth.clientSecretEnv] || '').trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
};

export const beginOAuth = async (
  user: SessionUser,
  input: { provider?: unknown },
  requestOrigin: string
): Promise<{ ok: true; authorizeUrl: string; provider: string } | Fail> => {
  const provider = connectionProviderById(input.provider);
  if (!provider) return fail(400, 'Unknown provider');
  if (!provider.oauth) return fail(400, `${provider.name} does not use OAuth — connect it via POST /api/v1/connections`);
  const creds = oauthCreds(provider);
  if (!creds) {
    return fail(400, `${provider.name} is not configured on this deployment yet (set ${provider.oauth.clientIdEnv} and ${provider.oauth.clientSecretEnv})`);
  }
  const state = await signJwt({
    sub: user.id,
    jti: `${STATE_JTI_PREFIX}${provider.id}:${randomUUID()}`,
    expiresIn: STATE_TTL
  });
  return {
    ok: true,
    provider: provider.id,
    authorizeUrl: provider.oauth.buildAuthorizeUrl({ clientId: creds.clientId, redirectUri: redirectUriFor(requestOrigin), state })
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

  const claims = await verifyJwt(state);
  if (!claims || !claims.jti.startsWith(STATE_JTI_PREFIX)) return fail(400, 'The sign-in state is invalid or expired — start the connect again');
  if (claims.sub !== user.id) return fail(403, 'This sign-in was started from a different Thingtime session');
  const providerId = claims.jti.slice(STATE_JTI_PREFIX.length).split(':')[0];
  const provider = connectionProviderById(providerId);
  if (!provider?.oauth) return fail(400, 'The sign-in state names an unknown provider');
  const creds = oauthCreds(provider);
  if (!creds) return fail(400, `${provider.name} is not configured on this deployment`);

  const exchanged = await provider.oauth.exchangeCode({
    code,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    redirectUri: redirectUriFor(requestOrigin)
  });
  if (exchanged.ok === false) return exchanged;

  const resolved = await provider.oauth.resolveAccountFromTokens(exchanged.tokens);
  if (resolved.ok === false) return resolved;

  const linked = await upsertAccountAndLink(user, provider, resolved.account, exchanged.tokens);
  if (linked.ok === false) return linked;
  return { ok: true, connection: linked.connection, provider: provider.id };
};
