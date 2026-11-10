import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { fail, isFail } from '../things/things';
import type { Fail } from '../things/things';

// HTTP client for talking to ANOTHER Thingtime deployment's public API with a
// stored bearer token. This is the only module that dials a caller-supplied
// host, so every guard lives here:
//   • base URLs are origins only — https required except localhost-shaped dev
//     hosts, no embedded credentials, no path/query/hash
//   • the host must RESOLVE to public address space, checked at dial time, not
//     only when the link was saved (a name vets clean once and can repoint)
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

// ── bounded untrusted strings ───────────────────────────────────────────────
//
// MAX_RESPONSE_BYTES bounds what we READ; it does not bound what we KEEP. Two
// kinds of remote-chosen text outlive the response:
//   • `error` messages ride a Fail all the way into the sync report, which the
//     route persists as the link's lastSyncSummary — i.e. inside the user
//     thing's secure blob — and the UI renders in a toast
//   • the identity fields below are written into the saved link itself
// A hostile (or merely broken) deployment answering with megabytes in either
// field would otherwise push the owner's account document at Mongo's 16MB
// limit and make every later secure write fail. Both are bounded here, at the
// one place remote text enters, so no caller has to remember to do it.
const MAX_REMOTE_ERROR_CHARS = 300;
// far above any real value (ObjectId hex is 24, usernames are short slugs) —
// this only has to reject the absurd
const MAX_REMOTE_IDENTITY_CHARS = 200;

// Display text: truncating is the right semantic — the operator still gets the
// useful head of the remote's complaint.
export const remoteErrorText = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const text = value.trim();
  return text.length <= MAX_REMOTE_ERROR_CHARS ? text : `${text.slice(0, MAX_REMOTE_ERROR_CHARS)}…`;
};

// Identifiers, by contrast, are never truncated: a silently shortened id would
// still compare equal to itself on the next pass and quietly bind the link to
// the wrong account string. An oversized identity is refused instead.
export const isUsableRemoteIdentity = (value: unknown): value is string =>
  typeof value === 'string' && !!value && value.length <= MAX_REMOTE_IDENTITY_CHARS;

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

// Non-public targets a linked *deployment* could never legitimately live at.
// Without this, a signed-in user can point a link at any https host the server
// can reach — private VPC ranges, link-local, cloud metadata — and read the
// outcome back through the sync report. The https-only rule already blocks the
// plain-HTTP metadata services, but it does not block internal HTTPS.
//
// Localhost-shaped hosts are exempt on purpose: they are the supported
// dev-against-dev path, and reaching them needs a URL the operator typed.
export const isBlockedDeploymentHostname = (hostname: string): boolean => {
  if (isLocalHostname(hostname)) return false;
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  // a real deployment is reached by name; an IP literal is either an internal
  // address or an attempt to sidestep name-based vetting
  if (isIP(host) !== 0) return true;
  return host === 'metadata.google.internal' || host.endsWith('.internal') || host.endsWith('.local');
};

// ── resolved-address fence ──────────────────────────────────────────────────
//
// The syntactic rules above vet the STRING a user typed. They cannot see where
// a name actually points, so `https://deploy.attacker.example` — an ordinary
// public hostname whose A record is 169.254.169.254 or 10.0.0.5 — passes every
// check above and still lands the server on the private network. That is the
// exact threat the block-list comment claims to cover, so the name has to be
// resolved and the ANSWER judged before we dial.
//
// It matters more here than at link time: `baseUrl` is stored and re-dialled on
// every sync pass, so a name that vetted clean weeks ago gets a fresh verdict
// on each call.
//
// Ranges below mirror `blockedTargetReason` in
// `api/utils/connections/providers.ts` (the outbound-feed fetcher). Both fences
// exist because both features dial user-supplied hosts; once #295 lands they
// should converge on one shared guarded-fetch helper rather than two copies.
const ipv4Blocked = (address: string): boolean => {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local — cloud metadata lives here
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
};

// Expand any textual IPv6 form to its 8 numeric groups so the range checks
// never depend on spelling: a resolver can hand back `::ffff:7f00:1`, which a
// check written against `::ffff:127.0.0.1` would silently miss.
const ipv6Groups = (value: string): number[] | null => {
  let text = value;
  const dotted = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const octets = dotted[2].split('.').map((part) => Number(part));
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
    text = `${dotted[1]}${(((octets[0] << 8) | octets[1]) >>> 0).toString(16)}:${(((octets[2] << 8) | octets[3]) >>> 0).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] => (part ? part.split(':').map((group) => Number.parseInt(group, 16)) : []);
  const head = parseGroups(halves[0]);
  const tail = halves.length === 2 ? parseGroups(halves[1]) : [];
  const groups =
    halves.length === 2 ? [...head, ...new Array(Math.max(0, 8 - head.length - tail.length)).fill(0), ...tail] : head;
  if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return null;
  return groups;
};

const ipv6Blocked = (address: string): boolean => {
  const groups = ipv6Groups(address.toLowerCase().split('%')[0]); // drop any zone index
  if (!groups) return true; // unparseable — refuse rather than guess
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) carry a v4
  // address in the low 32 bits; `::`/`::1` fall out of the same branch as
  // 0.0.0.0/0.0.0.1, which the v4 rules already block.
  if (groups.slice(0, 5).every((group) => group === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
    return ipv4Blocked(`${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`);
  }
  const head = groups[0];
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((head & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((head & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
};

export const isBlockedDeploymentAddress = (address: string, family: number): boolean =>
  family === 6 ? ipv6Blocked(address) : ipv4Blocked(address);

// true = refuse the dial. Localhost-shaped hosts keep their documented dev
// exemption (they resolve to loopback, which the v4 rules block by design).
// An unresolvable name is NOT refused here: fetch() will fail on it anyway, and
// inventing a refusal would only turn a DNS outage into a confusing "not a
// public deployment" error.
export const resolvedDeploymentHostBlocked = async (hostname: string): Promise<boolean> => {
  if (isLocalHostname(hostname)) return false;
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  const literal = isIP(host);
  if (literal) return isBlockedDeploymentAddress(host, literal);
  let resolved: { address: string; family: number }[];
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    return false;
  }
  // ANY answer in reserved space refuses the whole name — a round-robin record
  // mixing one public and one private address is the classic bypass.
  return resolved.some((entry) => isBlockedDeploymentAddress(entry.address, entry.family));
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
  if (isBlockedDeploymentHostname(url.hostname)) {
    return fail(400, 'That host isn’t reachable as a deployment — link to a public deployment hostname');
  }
  return url.origin;
};

type RemoteResponse = { status: number; json: any; setCookies: string[] };

export const remoteFetch = async (
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string | null; body?: unknown } = {}
): Promise<RemoteResponse | Fail> => {
  // Re-vet at DIAL time, not just when the link was saved: `baseUrl` is stored
  // and reused on every sync pass, so this is the only check a name that
  // repointed after linking has to pass.
  let target: URL;
  try {
    target = new URL(baseUrl);
  } catch {
    return fail(400, 'That deployment URL is no longer valid — re-link it');
  }
  if (await resolvedDeploymentHostBlocked(target.hostname)) {
    return fail(400, 'That host isn’t reachable as a deployment — link to a public deployment hostname');
  }

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
      remoteErrorText(response.json?.error, 'That deployment rejected the login')
    );
  }
  const token = authTokenFromSetCookies(response.setCookies);
  if (!token) return fail(502, 'That deployment logged in but returned no session token');
  const user = response.json?.user;
  if (!isUsableRemoteIdentity(user?.id) || !isUsableRemoteIdentity(user?.username)) {
    return fail(502, 'That deployment returned no account identity');
  }
  return { ok: true, token, user };
};

// GET /api/v1/auth/me — identity probe; also THE token-liveness check.
export const remoteMe = async (baseUrl: string, token: string): Promise<RemotePublicUser | Fail> => {
  const response = await remoteFetch(baseUrl, '/api/v1/auth/me', { token });
  if (isFail(response)) return response;
  const user = response.json?.user;
  if (!isUsableRemoteIdentity(user?.id) || !isUsableRemoteIdentity(user?.username)) {
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
    return fail(
      response.status === 401 ? 401 : 502,
      remoteErrorText(response.json?.error, 'That deployment refused to list things')
    );
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
      remoteErrorText(response.json?.error, `That deployment rejected the write (${response.status})`)
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
    return fail(502, remoteErrorText(response.json?.error, 'That deployment rejected the profile update'));
  }
  return { ok: true };
};
