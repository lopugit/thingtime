import { fail, isFail } from '../things/things';
import type { Fail } from '../things/things';

// HTTP client for talking to ANOTHER Thingtime deployment's public API with a
// stored bearer token. This is the only module that dials a caller-supplied
// host, so every guard lives here:
//   • base URLs are origins only — https required except localhost-shaped dev
//     hosts, no embedded credentials, no path/query/hash
//   • redirects are never followed (a redirect to an internal host would turn
//     a vetted origin into an SSRF hop)
//   • every call carries a timeout and a response-size cap
// The token sent to a remote is ONLY that link's stored remote token — never
// the local caller's own session JWT.

const REMOTE_TIMEOUT_MS = 15_000;
// paginated things responses are the biggest payload we read (each thing's
// crystal+extended can reach ~1MB) — cap well above a page, far below "swallow
// anything"
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

const isLocalHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost')
  );
};

// Normalize + vet a user-supplied deployment URL down to a bare origin.
export const normalizeDeploymentBaseUrl = (value: unknown): string | Fail => {
  if (typeof value !== 'string' || !value.trim()) return fail(400, 'Deployment URL is required');
  const raw = value.trim();
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return fail(400, 'That deployment URL doesn’t look like a URL');
  }
  if (url.username || url.password) return fail(400, 'Deployment URLs must not embed credentials');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return fail(400, 'Deployment URLs must be http(s)');
  }
  if (url.protocol === 'http:' && !isLocalHostname(url.hostname)) {
    return fail(400, 'Remote deployments must use https (http is allowed for localhost only)');
  }
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    return fail(400, 'Deployment URLs are origins only — drop the path/query');
  }
  return url.origin;
};

type RemoteResponse = { status: number; json: any; setCookies: string[] };

export const remoteFetch = async (
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string | null; body?: unknown } = {}
): Promise<RemoteResponse | Fail> => {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method || 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
    });
  } catch (err: any) {
    const reason = err?.name === 'TimeoutError' ? 'timed out' : 'is unreachable';
    return fail(502, `That deployment ${reason}`);
  }

  if (response.status >= 300 && response.status < 400) {
    return fail(502, 'That deployment redirected the request — link its canonical URL directly');
  }

  const text = await readBoundedText(response);
  if (isFail(text)) return text;

  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    return fail(502, 'That deployment didn’t answer with JSON — is it a Thingtime deployment?');
  }

  const setCookies =
    typeof (response.headers as any).getSetCookie === 'function'
      ? ((response.headers as any).getSetCookie() as string[])
      : response.headers.get('set-cookie')
        ? [response.headers.get('set-cookie') as string]
        : [];

  return { status: response.status, json, setCookies };
};

const readBoundedText = async (response: Response): Promise<string | Fail> => {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      return fail(502, 'That deployment answered with an impossibly large response');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
};

// Pull the tt_auth JWT out of a login response's Set-Cookie headers. Thingtime
// login puts the token in an httpOnly cookie only (never the body), and the
// cookie value is the plain URI-encoded JWT (api/cookies.ts encodeCookieValue).
const authTokenFromSetCookies = (setCookies: string[]): string | null => {
  for (const cookie of setCookies) {
    const match = /(?:^|;\s*)tt_auth=([^;]+)/.exec(cookie) || (/^tt_auth=([^;]+)/.exec(cookie.trim()) as any);
    if (match && match[1]) {
      try {
        const token = decodeURIComponent(match[1]);
        if (token) return token;
      } catch {
        return match[1];
      }
    }
  }
  return null;
};

export type RemotePublicUser = {
  id: string;
  username: string;
  displayName: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
};

export type RemoteLoginResult =
  | { ok: true; token: string; user: RemotePublicUser }
  | { ok: true; requiresOtp: true; challenge: string; expiresAt: string }
  | Fail;

// Server-side login against a remote deployment. Credentials pass straight
// through to the remote and are never stored — only the resulting token is.
export const remoteLogin = async (
  baseUrl: string,
  input: { username?: string; password?: string; challenge?: string; code?: string }
): Promise<RemoteLoginResult> => {
  const body =
    input.challenge !== undefined
      ? { challenge: input.challenge, code: input.code }
      : { username: input.username, password: input.password };
  const response = await remoteFetch(baseUrl, '/api/v1/login', { method: 'POST', body });
  if (isFail(response)) return response;
  if (response.json?.requiresOtp && typeof response.json?.challenge === 'string') {
    return { ok: true, requiresOtp: true, challenge: response.json.challenge, expiresAt: response.json.expiresAt };
  }
  if (response.status !== 200 || response.json?.ok !== true) {
    return fail(
      response.status === 429 ? 429 : 401,
      response.json?.error || 'That deployment rejected the login'
    );
  }
  const token = authTokenFromSetCookies(response.setCookies);
  if (!token) return fail(502, 'That deployment logged in but returned no session token');
  const user = response.json?.user;
  if (!user?.id || !user?.username) return fail(502, 'That deployment returned no account identity');
  return { ok: true, token, user };
};

// GET /api/v1/auth/me — identity probe; also THE token-liveness check.
export const remoteMe = async (baseUrl: string, token: string): Promise<RemotePublicUser | Fail> => {
  const response = await remoteFetch(baseUrl, '/api/v1/auth/me', { token });
  if (isFail(response)) return response;
  const user = response.json?.user;
  if (!user?.id || !user?.username) {
    return fail(401, 'That deployment no longer accepts the link’s token — re-link to refresh it');
  }
  return user;
};

// Try to upgrade a (30-day) login token into a non-expiring deployment-link
// token. Older deployments don't have the endpoint — null means "keep the
// login token", never an error.
export const remoteMintLinkToken = async (
  baseUrl: string,
  token: string
): Promise<{ token: string } | null> => {
  const response = await remoteFetch(baseUrl, '/api/v1/deployment-links/token', { method: 'POST', token, body: {} });
  if (isFail(response)) return null;
  if (response.status !== 200 || response.json?.ok !== true || typeof response.json?.token !== 'string') return null;
  return { token: response.json.token };
};

// Best-effort remote session revocation on unlink — a failure only means the
// remote session ages out on its own expiry instead.
export const remoteLogout = async (baseUrl: string, token: string): Promise<void> => {
  const response = await remoteFetch(baseUrl, '/api/v1/auth/logout', { method: 'POST', token, body: {} });
  void response;
};

export type RemoteThing = {
  id: string;
  thingtime: string[];
  visibility?: string;
  acl?: string[];
  targetId: string | null;
  crystal: Record<string, any>;
  extended: unknown | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export const remoteListThings = async (
  baseUrl: string,
  token: string,
  query: { cursor?: string | null; limit?: number }
): Promise<{ things: RemoteThing[]; nextCursor: string | null } | Fail> => {
  const params = new URLSearchParams();
  if (query.cursor) params.set('cursor', query.cursor);
  params.set('limit', String(query.limit || 50));
  const response = await remoteFetch(baseUrl, `/api/v1/things?${params}`, { token });
  if (isFail(response)) return response;
  if (response.status !== 200 || response.json?.ok !== true || !Array.isArray(response.json?.things)) {
    return fail(response.status === 401 ? 401 : 502, response.json?.error || 'That deployment refused to list things');
  }
  return { things: response.json.things, nextCursor: response.json.nextCursor ?? null };
};

export const remotePutThing = async (
  baseUrl: string,
  token: string,
  body: Record<string, unknown>
): Promise<{ ok: true } | Fail> => {
  const response = await remoteFetch(baseUrl, '/api/v1/things', { method: 'PUT', token, body });
  if (isFail(response)) return response;
  if (response.json?.ok !== true) {
    const passThrough = [429, 401, 404, 409];
    return fail(
      passThrough.includes(response.status) ? response.status : 502,
      response.json?.error || `That deployment rejected the write (${response.status})`
    );
  }
  return { ok: true };
};

export const remoteUpdateProfile = async (
  baseUrl: string,
  token: string,
  body: Record<string, unknown>
): Promise<{ ok: true } | Fail> => {
  const response = await remoteFetch(baseUrl, '/api/v1/users/profile', { method: 'POST', token, body });
  if (isFail(response)) return response;
  if (response.json?.ok !== true) {
    return fail(502, response.json?.error || 'That deployment rejected the profile update');
  }
  return { ok: true };
};
