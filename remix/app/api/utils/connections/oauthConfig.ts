import { createHash } from 'node:crypto';
import { vaultRequest } from '../auth/vaultRequest';
import { resolvePublicOrigin } from '../auth/publicOrigin';
import { getDeploymentDataEnvironment } from '../deployment/dataEnvironment';

export const oauthCallbackPath = '/api/v1/connections/oauth/callback';
export type OAuthClientConfig = {
  clientId: string; clientSecret: string; redirectUri: string;
  origin: string; environment: string; binding: string;
  authMethod?: 'none' | 'client_secret_basic';
};
// Fixed selectors only. Multiple service cards intentionally share one app.
const labels: Record<string, string> = {
  GOOGLE_CLIENT_ID: 'connections-google-oauth', FACEBOOK_APP_ID: 'connections-facebook-oauth',
  INSTAGRAM_APP_ID: 'connections-instagram-oauth', TIKTOK_CLIENT_KEY: 'connections-tiktok-oauth',
  REDDIT_CLIENT_ID: 'connections-reddit-oauth', MASTODON_CLIENT_ID: 'connections-mastodon-oauth',
  TWITCH_CLIENT_ID: 'connections-twitch-oauth', X_CLIENT_ID: 'connections-x-oauth',
  TUMBLR_CLIENT_ID: 'connections-tumblr-oauth', PINTEREST_CLIENT_ID: 'connections-pinterest-oauth',
  LINKEDIN_CLIENT_ID: 'connections-linkedin-oauth', SPOTIFY_CLIENT_ID: 'connections-spotify-oauth',
  CHATGPT_OAUTH_CLIENT_ID: 'connections-chatgpt-oauth'
};
const object = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const own = (value: unknown, key: string) => object(value) && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
export const exactOAuthOrigin = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.origin !== value || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) return null;
    return url.origin;
  } catch { return null; }
};

// Legacy callback-base compatibility is a same-origin pin, never an override
// that borrows a production callback for a preview/local request.
export const oauthRedirectUri = (origin: string): string | null => {
  if (!exactOAuthOrigin(origin)) return null;
  const configured = process.env.CONNECTIONS_OAUTH_REDIRECT_BASE?.trim();
  if (configured && configured.replace(/\/$/, '') !== origin) return null;
  return `${origin}${oauthCallbackPath}`;
};

export const parseOAuthClientConfig = (raw: string | null, selector: string, origin: string, environment: string): OAuthClientConfig | null => {
  try {
    if (!Object.prototype.hasOwnProperty.call(labels, selector) || !exactOAuthOrigin(origin) || !environment || !raw) return null;
    const bundle = JSON.parse(raw);
    const value = own(own(own(own(bundle, 'environments'), environment), 'origins'), origin);
    if (!object(value) || typeof value.clientId !== 'string' || !value.clientId.trim() || value.clientId !== value.clientId.trim() ||
      typeof value.clientSecret !== 'string' || value.clientSecret !== value.clientSecret.trim() ||
      value.redirectUri !== oauthRedirectUri(origin)) return null;
    const publicClient = selector === 'CHATGPT_OAUTH_CLIENT_ID' && value.authMethod === 'none';
    if (!value.clientSecret && !publicClient) return null;
    if (value.authMethod !== undefined && (selector !== 'CHATGPT_OAUTH_CLIENT_ID' || !['none', 'client_secret_basic'].includes(value.authMethod))) return null;
    if (publicClient && value.clientSecret) return null;
    // The secret stays server-only. Its digest is also kept out of signed state:
    // that state carries the public client/origin binding, allowing normal secret
    // rotation while rejecting client/callback/environment changes.
    const binding = createHash('sha256').update(JSON.stringify([labels[selector], environment, origin, value.clientId, value.redirectUri, value.authMethod || 'client_secret_basic'])).digest('hex');
    return { clientId: value.clientId, clientSecret: value.clientSecret, redirectUri: value.redirectUri, origin, environment, binding,
      ...(selector === 'CHATGPT_OAUTH_CLIENT_ID' ? { authMethod: value.authMethod || 'client_secret_basic' } : {}) };
  } catch { return null; }
};

// Coalesce per request only: bounded by the fixed label set, automatically
// released with the request, and no stale cross-request rotation window.
const requestReads = new WeakMap<Request, Map<string, Promise<string | null>>>();
export const oauthClientConfig = async (selector: string, origin?: string): Promise<OAuthClientConfig | null> => {
  const label = Object.prototype.hasOwnProperty.call(labels, selector) ? labels[selector] : null, request = vaultRequest();
  const environment = getDeploymentDataEnvironment();
  const requestOrigin = request ? resolvePublicOrigin(request).origin : undefined;
  if (origin && requestOrigin && origin !== requestOrigin) return null;
  origin ||= requestOrigin;
  if (!label || !origin || !exactOAuthOrigin(origin) || !environment) return null;
  try {
    const read = async () => (await import('../admin/integrations')).readAdminAutomationSecret(label);
    let pending: Promise<string | null>;
    if (request) {
      let cache = requestReads.get(request);
      if (!cache) requestReads.set(request, cache = new Map());
      pending = cache.get(label) || read();
      cache.set(label, pending);
    } else pending = read();
    return parseOAuthClientConfig(await pending, selector, origin, environment.id);
  } catch { return null; }
};

export const oauthGrantMatches = (tokens: { oauthBinding?: string; clientId?: string; oauthOrigin?: string; oauthEnvironment?: string }, config: OAuthClientConfig) =>
  tokens.oauthBinding === config.binding && tokens.clientId === config.clientId && tokens.oauthOrigin === config.origin && tokens.oauthEnvironment === config.environment;
