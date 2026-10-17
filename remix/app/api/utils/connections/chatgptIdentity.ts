import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { ConnectionProvider, OAuthTokens } from './providers';
import { fail } from './shared';

const ISSUER = 'https://auth.openai.com';
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`), { timeoutDuration: 8000 });
const authMethod = () => process.env.CHATGPT_OAUTH_AUTH_METHOD || 'client_secret_basic';
const configured = () =>
  Boolean(process.env.CHATGPT_OAUTH_CLIENT_ID?.trim()) &&
  (authMethod() === 'none' || (authMethod() === 'client_secret_basic' && Boolean(process.env.CHATGPT_OAUTH_CLIENT_SECRET?.trim())));

export const verifyChatGPTIdentity = async (idToken: string, clientId: string, nonce: string, key: JWTVerifyGetKey = jwks) => {
  const { payload } = await jwtVerify(idToken, key, {
    issuer: ISSUER,
    audience: clientId,
    algorithms: ['RS256'],
    requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
    clockTolerance: 5
  });
  if (!nonce || payload.nonce !== nonce || !payload.sub || typeof payload.iat !== 'number' || payload.iat > Date.now() / 1000 + 5) {
    throw new Error('ChatGPT identity could not be verified.');
  }
  return payload;
};

// The hosted partner contract supplies an ID token, not an inference/API grant.
// Keep that distinction in the token format and never use this JWT as a bearer.
export const chatgptIdentityProvider: ConnectionProvider = {
  id: 'chatgpt',
  name: 'ChatGPT identity',
  icon: '✳️',
  auth: 'oauth2',
  accountOnly: true,
  contentVisibility: 'personal',
  configured,
  fields: [],
  about: 'Connect a ChatGPT identity through an approved OpenAI client. This does not grant API or subscription inference access.',
  fetchFeed: async () => ({ ok: true, items: [] }),
  oauth: {
    clientIdEnv: 'CHATGPT_OAUTH_CLIENT_ID',
    clientSecretEnv: 'CHATGPT_OAUTH_CLIENT_SECRET',
    clientSecretOptional: () => authMethod() === 'none',
    pkce: true,
    buildAuthorizeUrl: ({ clientId, redirectUri, state, codeChallenge, nonce }) => {
      const url = new URL(`${ISSUER}/api/accounts/authorize`);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid profile email',
        state,
        nonce: nonce || '',
        code_challenge: codeChallenge || '',
        code_challenge_method: 'S256'
      }).toString();
      return url.toString();
    },
    exchangeCode: async ({ code, clientId, clientSecret, redirectUri, codeVerifier, nonce }) => {
      if (!configured() || !codeVerifier || !nonce) return fail(503, 'ChatGPT sign-in is not configured.');
      try {
        const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' };
        if (authMethod() === 'client_secret_basic') {
          const encode = (value: string) => new URLSearchParams({ value }).toString().slice(6);
          headers.authorization = `Basic ${Buffer.from(`${encode(clientId)}:${encode(clientSecret)}`).toString('base64')}`;
        }
        const response = await fetch(`${ISSUER}/api/accounts/oauth/token`, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(8000),
          headers,
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            code,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier
          })
        });
        if (!response.ok) {
          await response.body?.cancel();
          return fail(502, 'ChatGPT could not complete sign-in. Start again.');
        }
        const reader = response.body?.getReader();
        if (!reader) return fail(502, 'ChatGPT returned no identity.');
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 64 * 1024) {
            await reader.cancel();
            return fail(502, 'ChatGPT returned an invalid identity.');
          }
          chunks.push(next.value);
        }
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof data.id_token !== 'string') return fail(502, 'ChatGPT returned no identity.');
        const identity = await verifyChatGPTIdentity(data.id_token, clientId, nonce);
        const tokens: OAuthTokens = {
          accessToken: '',
          idToken: data.id_token,
          clientId,
          oidcNonce: nonce,
          providerUserId: identity.sub,
          scopes: ['openid', 'profile', 'email'],
          expiresAt: new Date(identity.exp! * 1000).toISOString()
        };
        return { ok: true, tokens };
      } catch {
        return fail(502, 'ChatGPT identity could not be verified. Start sign-in again.');
      }
    },
    resolveAccountFromTokens: async (tokens) => {
      try {
        if (!tokens.idToken || !tokens.clientId || !tokens.oidcNonce) return fail(401, 'Reconnect this ChatGPT identity.');
        const identity = await verifyChatGPTIdentity(tokens.idToken, tokens.clientId, tokens.oidcNonce);
        const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 200) : '');
        return {
          ok: true,
          account: {
            providerAccountId: `${tokens.clientId}:${identity.sub}`,
            displayName: text(identity.name) || 'ChatGPT account',
            handle: identity.email_verified === true ? text(identity.email) : '',
            avatarUrl: null,
            profileUrl: null,
            config: {}
          }
        };
      } catch {
        return fail(401, 'Reconnect this ChatGPT identity.');
      }
    }
  }
};
