import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { fail, type Fail } from './shared';

// Third-party feed providers — the adapter registry behind
// /api/v1/connections/*. Each provider resolves a connect form into a stable
// external account identity and pulls a normalized feed page for it. All
// providers here are keyless (public content APIs / RSS), so every one is
// live-testable with zero configuration; OAuth2 providers (Facebook,
// Instagram, X, …) join this registry config-gated by env credentials and
// report configured:false until those are present.

// One shared depth contract for feed deepening: connections.ts stores
// per-account syncDepth against this same cap, and every provider clamps its
// paging with these helpers — a raised cap propagates everywhere at once.
export const MAX_FEED_PAGES = 5;
export const pageCount = (opts: { pages?: number }): number => Math.max(1, Math.min(opts.pages || 1, MAX_FEED_PAGES));
export const targetCount = (opts: { limit: number; pages?: number }): number => opts.limit * pageCount(opts);

export type ExternalFeedItem = {
  // stable per provider — the dedupe/idempotency key for external-post things
  externalId: string;
  url: string | null;
  title: string | null;
  text: string;
  images: string[];
  author: { name: string | null; handle: string | null; avatarUrl: string | null; url: string | null };
  publishedAt: Date | null;
  stats: { likes?: number; comments?: number; shares?: number; score?: number } | null;
};

// OAuth token bundle stored in the external-account's secure BinData blob —
// never in crystal, never projected, never sent to a client.
export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string | null;
  // ISO timestamp; adapters refresh (when the provider supports it) once this
  // is near/past, otherwise the sync surfaces a "reconnect" error
  expiresAt?: string | null;
  scopes?: string[];
  providerUserId?: string | null;
};

export type ResolvedExternalAccount = {
  // stable identity WITHIN the provider (two Thingtime users connecting the
  // same identity converge on one external-account thing; per-user virtual
  // accounts embed the userId here so they never converge)
  providerAccountId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  profileUrl: string | null;
  // non-secret provider parameters (subreddits, instance host, a virtual
  // channel list, …) — secrets (OAuth tokens) never go here; they belong in
  // the account's secure blob
  config: Record<string, any>;
  // credential-connect providers (Bluesky app passwords) exchange the typed
  // secret for session tokens at resolve time — sealed into the secure blob
  // by upsertAccountAndLink exactly like an OAuth token response
  tokens?: OAuthTokens | null;
};

export type ConnectField = {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  required?: boolean;
  // secret fields (app passwords) render masked, transit memory only, and
  // must never be stored — adapters exchange them for session tokens that go
  // in the secure blob
  secret?: boolean;
};

export type ConnectionProvider = {
  id: string;
  name: string;
  icon: string;
  // 'none' = public content, no account; 'oauth2' = provider SSO; 'credential'
  // = fields-based connect where a secret field is exchanged for session
  // tokens server-side (never stored itself)
  auth: 'none' | 'oauth2' | 'credential';
  // shareId namespace for synced posts — providers that surface the SAME
  // underlying content (the two YouTube providers) share one namespace so a
  // video reached through both stays ONE external-post with unified comments.
  // Defaults to `id`.
  postNamespace?: string;
  // 'public': the feed is public content — external posts get a tt:all acl.
  // 'personal': the feed is the account's private algorithm — posts are
  // acl-granted per linked Thingtime user only.
  contentVisibility: 'public' | 'personal';
  about: string;
  configured: () => boolean;
  fields: ConnectField[];
  // fields-based connect (absent on SSO providers — they resolve identity
  // from tokens in the OAuth callback instead)
  resolveAccount?: (
    fields: Record<string, string>,
    ctx: { userId: string }
  ) => Promise<{ ok: true; account: ResolvedExternalAccount } | Fail>;
  // reconnect semantics for server-side-mutable config (the virtual YouTube
  // channel list): merge the stored config with the freshly resolved one so a
  // re-connect can never wipe managed state. Default: replace.
  mergeConfig?: (existing: Record<string, any>, next: Record<string, any>) => Record<string, any>;
  // session refresh for CREDENTIAL providers (Bluesky rotates its session
  // pair with the refresh JWT — no client credentials involved); OAuth
  // providers put their refresh grant on oauth.refreshTokens instead
  refreshTokens?: (tokens: OAuthTokens, creds: { clientId: string; clientSecret: string }) => Promise<OAuthTokens | null>;
  fetchFeed: (
    account: { providerAccountId: string; config: Record<string, any> },
    opts: { limit: number; tokens?: OAuthTokens | null; pages?: number }
  ) => Promise<{ ok: true; items: ExternalFeedItem[] } | Fail>;
  // SSO providers: click Connect → the provider's own login page → the token
  // response is saved to the Thingtime account (secure blob) and the
  // personalized feed syncs with those credentials.
  oauth?: {
    clientIdEnv: string;
    clientSecretEnv: string;
    // X requires PKCE on its authorization-code flow; the begin/callback core
    // mints an S256 verifier and threads it through the signed state JWT
    pkce?: boolean;
    buildAuthorizeUrl: (input: { clientId: string; redirectUri: string; state: string; codeChallenge?: string }) => string;
    exchangeCode: (input: {
      code: string;
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      codeVerifier?: string;
    }) => Promise<{ ok: true; tokens: OAuthTokens } | Fail>;
    resolveAccountFromTokens: (tokens: OAuthTokens) => Promise<{ ok: true; account: ResolvedExternalAccount } | Fail>;
    refreshTokens?: (tokens: OAuthTokens, creds: { clientId: string; clientSecret: string }) => Promise<OAuthTokens | null>;
  };
};

export const FEED_FETCH_LIMIT = 30;
const FETCH_TIMEOUT_MS = 8000;
const MAX_TEXT_CHARS = 4000;
const MAX_TITLE_CHARS = 300;
const MAX_IMAGES = 5;
const USER_AGENT = 'thingtime-connections/1.0 (+https://thingtime.com)';

const sha1of = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24);

// --- text/html hygiene ------------------------------------------------------

const decodeEntities = (value: string): string =>
  value
    .replace(/&#(\d+);/g, (_, num) => {
      const code = Number(num);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    })
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

// Linear-time script/style block removal (an unclosed block drops the rest of
// the input). The lazy pair-matching regex this replaces was quadratic on
// hostile non-matching input — a ReDoS vector, since feed bodies are
// attacker-fetched content.
const stripBlocks = (value: string, tags: string[]): string => {
  let out = value;
  for (const tag of tags) {
    const open = `<${tag}`;
    const close = `</${tag}>`;
    let result = '';
    let cursor = 0;
    const lower = out.toLowerCase();
    while (cursor < out.length) {
      const start = lower.indexOf(open, cursor);
      if (start === -1) {
        result += out.slice(cursor);
        break;
      }
      result += out.slice(cursor, start);
      const end = lower.indexOf(close, start);
      if (end === -1) break; // unclosed block swallows the tail — safe drop
      cursor = end + close.length;
    }
    out = result;
  }
  return out;
};

// Linear tag removal, for the same reason stripBlocks above is linear:
// `<[^>]+>` backtracks from every `<` in the input when no `>` follows it, so
// 100KB of bare `<` — the cap below, reached by one feed item — cost ~8s of
// blocked event loop on its own.
const stripTags = (value: string): string => {
  let out = '';
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf('<', cursor);
    if (start === -1) break;
    const close = value.indexOf('>', start + 1);
    // an unterminated `<` is literal text, and `<>` has nothing inside to
    // strip — both true of the `<[^>]+>` pattern this replaces
    if (close === -1) break;
    if (close === start + 1) {
      out += value.slice(cursor, close + 1);
      cursor = close + 1;
      continue;
    }
    out += `${value.slice(cursor, start)} `;
    cursor = close + 1;
  }
  return out + value.slice(cursor);
};

// Bound regex work: nothing downstream keeps more than MAX_TEXT_CHARS, so
// hostile multi-megabyte bodies never reach the pattern passes.
const STRIP_INPUT_CAP = 100_000;

export const stripHtml = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  // decode → strip → decode: feeds that double-escape their HTML (Reddit's
  // Atom bodies carry &lt;div&gt;…&amp;#32;…) unescape to markup on the first
  // pass, lose the markup on the strip, and surface clean text on the second
  return decodeEntities(
    stripTags(
      stripBlocks(decodeEntities(value.slice(0, STRIP_INPUT_CAP)), ['script', 'style'])
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
    )
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const boundedText = (value: unknown, max: number): string => stripHtml(value).slice(0, max);

const httpsImage = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const url = decodeEntities(value.trim());
  return /^https:\/\/[^\s"'<>]+$/.test(url) && url.length <= 1500 ? url : null;
};

// A remote-supplied link that is safe to render as a real <a href>. Feed items
// and third-party authors carry permalinks straight from provider data, and
// PostCard renders them as anchors — but "provider data" includes any RSS feed
// or Mastodon/Lemmy instance the USER named, so an unchecked value lets a
// hostile source store `javascript:` (or `data:`) and turn a synced post into
// stored XSS. Only real web schemes survive; anything else becomes null, the
// same shape every provider already uses for "no link".
export const webLink = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const raw = decodeEntities(value.trim());
  if (!raw || raw.length > 1500) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? raw : null;
  } catch {
    return null; // relative or unparseable — not a usable link target either
  }
};

const boundedImages = (values: unknown[]): string[] => {
  const images: string[] = [];
  for (const value of values) {
    const url = httpsImage(value);
    if (url && !images.includes(url)) images.push(url);
    if (images.length >= MAX_IMAGES) break;
  }
  return images;
};

const dateOrNull = (value: unknown): Date | null => {
  const parsed = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
};

// --- bounded fetch helpers --------------------------------------------------

// Error messages name the provider host — but the URL itself may be the thing
// that's malformed (a bad paging.next), so the naming must never throw.
const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return 'the provider';
  }
};

// --- outbound target guard (SSRF) -------------------------------------------
//
// Feed sources are USER-SUPPLIED: the RSS provider takes any feedUrl, and
// Mastodon/Lemmy take an instance hostname. Unguarded, that lets any signed-in
// account aim Thingtime's server at the deployment's own private network —
// cloud metadata (169.254.169.254), internal admin ports, databases — and read
// the answer back as feed content, or infer it from the distinct error strings
// ("answered 401" vs "could not be reached" vs "does not look like a feed") is
// already a working port scanner. So every outbound provider call resolves its
// host first and refuses private/reserved space.
//
// Redirects are followed MANUALLY for the same reason: `redirect: 'follow'`
// would let an attacker-owned public host 302 straight into private space,
// bypassing any check made only on the URL the user typed. Each hop is
// re-validated, and non-GET requests never follow a redirect at all so
// credentials are never replayed to a new origin.
//
// Honest limitation: this validates the addresses the resolver returns and
// then fetch() resolves again, so a DNS record that changes between the two
// (rebinding) is not covered — closing that needs connection-level address
// pinning via a custom undici dispatcher, which is a larger change than this
// feature warrants. Every direct and redirect-based attempt is stopped.

const MAX_REDIRECT_HOPS = 4;

// Distinguishable so callers can surface the refusal instead of the generic
// "could not be reached" — a blocked target is a user input problem (400),
// not a provider outage (502).
class BlockedTargetError extends Error {
  readonly blocked = true;
}

const blockedFail = (err: unknown): Fail | null =>
  err instanceof BlockedTargetError ? fail(400, `Thingtime will not fetch ${err.message}`) : null;

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

// Expand any textual IPv6 form to its 8 numeric groups, so the range checks
// never depend on how the address happened to be spelled. This matters:
// WHATWG URL renders `[::ffff:127.0.0.1]` as `::ffff:7f00:1`, so a check
// written against the dotted spelling silently misses the very address it was
// written to catch.
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
  // address in the low 32 bits, and `::`/`::1` fall out of the same branch as
  // 0.0.0.0/0.0.0.1 — both already blocked by the v4 rules.
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

const addressBlocked = (address: string, family: number): boolean =>
  family === 6 ? ipv6Blocked(address) : ipv4Blocked(address);

const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa'];

// null = allowed; a string = the refusal reason (deliberately generic to the
// caller, so a probe learns nothing it did not already supply)
const blockedTargetReason = async (raw: string): Promise<string | null> => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'that URL could not be parsed';
  }
  if (url.protocol !== 'https:') return 'only https:// feed sources are supported';
  // WHATWG `hostname` keeps the brackets around an IPv6 literal ("[::1]"),
  // which isIP() does not recognise — strip them or every v6 address would
  // fall through to the DNS branch, fail to resolve, and be allowed.
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) return 'that URL has no host';
  if (hostname === 'localhost' || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return 'that host is not a public internet address';
  }
  const literal = isIP(hostname);
  if (literal) {
    return addressBlocked(hostname, literal) ? 'that host is not a public internet address' : null;
  }
  let resolved: { address: string; family: number }[];
  try {
    resolved = await lookup(hostname, { all: true });
  } catch {
    // Unresolvable here means unresolvable for fetch() too — let the real
    // request fail with its own message rather than inventing a refusal.
    return null;
  }
  if (resolved.some((entry) => addressBlocked(entry.address, entry.family))) {
    return 'that host is not a public internet address';
  }
  return null;
};

// Credentials must not survive a hop to a different origin. `fetch` strips
// these itself on `redirect: 'follow'`; following redirects by hand means
// doing it here too, or the "never replayed to a new origin" rule below holds
// only for the non-GET half. An authenticated GET is the other half: every
// token-bearing call in this file is a GET, so a single 302 out of a provider
// (an open redirect on its own domain, a hijacked API subdomain) would hand
// that user's OAuth access token to whatever public host the Location names —
// and a public host is exactly what blockedTargetReason lets through.
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

// One guarded fetch for every outbound provider call: validates the target,
// then walks redirects by hand re-validating each hop.
const guardedFetch = async (url: string, init: RequestInit & { method?: string }): Promise<Response> => {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const method = init.method || 'GET';
  let target = url;
  let headers = new Headers(init.headers);
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const blocked = await blockedTargetReason(target);
    if (blocked) throw new BlockedTargetError(blocked);
    const resp = await fetch(target, { ...init, headers, signal, redirect: 'manual' });
    if (resp.status < 300 || resp.status > 399) return resp;
    const location = resp.headers.get('location');
    // Only idempotent GETs follow a redirect — a POST carrying client
    // credentials or a Bearer token must never be replayed to a new origin.
    if (!location || method !== 'GET') return resp;
    // Release the hop we are abandoning. Only `location` is used from a 3xx,
    // so its body is dead weight — and an undrained body holds its connection
    // open for the whole fetch window. Same threat model readBoundedBody was
    // added for: the host on the other end is user-supplied and may be
    // hostile, and it gets one of these per hop.
    await resp.body?.cancel().catch(() => {});
    const next = new URL(location, target);
    // Compare against the origin we just talked to, not the original one, so
    // credentials dropped on an earlier hop are never reinstated by a later
    // redirect back to the starting origin.
    if (next.origin !== new URL(target).origin) {
      headers = new Headers(headers);
      for (const name of CREDENTIAL_HEADERS) headers.delete(name);
    }
    target = next.toString();
  }
  throw new BlockedTargetError('that URL redirected too many times');
};

// Response-size caps. FEED covers feed/data bodies, TOKEN the much smaller
// OAuth token responses.
const MAX_FEED_RESPONSE_BYTES = 3_000_000;
const MAX_TOKEN_RESPONSE_BYTES = 1_000_000;

// Read at most `max` bytes of a body; null means "over the cap, give up".
//
// The cap has to be enforced WHILE reading. `resp.text()` buffers the entire
// body first, so checking its length afterwards is a check the attacker has
// already won: feed sources are user-supplied (the RSS provider takes any
// typed URL, Mastodon/Lemmy any instance host), so a hostile host can answer
// a signed-in user's connect with an endless body and spend the whole fetch
// timeout streaming it into the server's heap — gigabytes on a fast link, on
// a serverless runtime sized in hundreds of megabytes. Content-Length is
// honoured as the cheap early out, but never trusted as the only bound: it is
// absent on chunked responses and the sender picks it.
const readBoundedBody = async (resp: Response, max: number): Promise<string | null> => {
  const body = resp.body;
  if (!body) return '';
  const declared = Number(resp.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    await body.cancel().catch(() => {});
    return null;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > max) {
      // stop the transfer as well as the buffering — an abandoned reader
      // would leave the hostile host streaming into a socket we still hold
      await reader.cancel().catch(() => {});
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
};

const fetchText = async (url: string, accept: string): Promise<{ ok: true; text: string } | Fail> => {
  try {
    const resp = await guardedFetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept }
    });
    if (!resp.ok) return fail(502, `The provider answered ${resp.status} for ${hostOf(url)}`);
    const text = await readBoundedBody(resp, MAX_FEED_RESPONSE_BYTES);
    if (text === null) return fail(502, 'The provider response was too large to process');
    return { ok: true, text };
  } catch (err: any) {
    const blocked = blockedFail(err);
    if (blocked) return blocked;
    const reason = err?.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
    return fail(502, `The provider ${reason} (${hostOf(url)})`);
  }
};

const fetchJson = async (url: string): Promise<{ ok: true; data: any } | Fail> => {
  const result = await fetchText(url, 'application/json');
  if (result.ok === false) return result;
  try {
    return { ok: true, data: JSON.parse(result.text) };
  } catch {
    return fail(502, 'The provider returned malformed JSON');
  }
};

// Form-encoded POST (OAuth token endpoints) with bounded JSON response.
// basicAuth covers providers (Reddit) whose token endpoint authenticates the
// CLIENT via HTTP Basic instead of body credentials.
const postForm = async (
  url: string,
  form: Record<string, string>,
  opts: { basicAuth?: { user: string; pass: string } } = {}
): Promise<{ ok: true; data: any } | Fail> => {
  try {
    const resp = await guardedFetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        ...(opts.basicAuth ? { Authorization: `Basic ${Buffer.from(`${opts.basicAuth.user}:${opts.basicAuth.pass}`).toString('base64')}` } : {})
      },
      body: new URLSearchParams(form).toString()
    });
    const text = await readBoundedBody(resp, MAX_TOKEN_RESPONSE_BYTES);
    if (text === null) return fail(502, 'The provider response was too large to process');
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      return fail(502, `The provider returned a malformed token response (${hostOf(url)})`);
    }
    if (!resp.ok) {
      const message = data?.error?.message || data?.error_description || data?.error_message || data?.error || `status ${resp.status}`;
      return fail(502, `Token exchange failed: ${String(message).slice(0, 200)}`);
    }
    return { ok: true, data };
  } catch (err: any) {
    const blocked = blockedFail(err);
    if (blocked) return blocked;
    const reason = err?.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
    return fail(502, `The provider ${reason} (${hostOf(url)})`);
  }
};

// Authenticated JSON GET/POST for provider data APIs. Provider error bodies
// surface as bounded messages so a revoked token reads as "reconnect", never
// as a silent empty feed.
const authedJson = async (
  url: string,
  opts: { token?: string; method?: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ ok: true; data: any } | Fail> => {
  try {
    const resp = await guardedFetch(url, {
      method: opts.method || 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        // provider-specific extras (Twitch helix requires a Client-Id header)
        ...(opts.headers || {})
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {})
    });
    const text = await readBoundedBody(resp, MAX_FEED_RESPONSE_BYTES);
    if (text === null) return fail(502, 'The provider response was too large to process');
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!resp.ok) {
      const message = data?.error?.message || data?.error?.error_user_msg || data?.error_description || data?.error?.code || `status ${resp.status}`;
      const status = resp.status === 401 || resp.status === 403 ? 401 : 502;
      return fail(status, `${hostOf(url)}: ${String(message).slice(0, 200)}`);
    }
    return { ok: true, data };
  } catch (err: any) {
    const blocked = blockedFail(err);
    if (blocked) return blocked;
    const reason = err?.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
    return fail(502, `The provider ${reason} (${hostOf(url)})`);
  }
};

const expiresAtFrom = (expiresInSeconds: unknown): string | null => {
  const seconds = Number(expiresInSeconds);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : null;
};

const envValue = (name: string): string => (process.env[name] || '').trim();

// One place resolves an SSO provider's client credentials from env — begin,
// callback, AND token refresh must always agree on the env names.
export const oauthCredsFor = (provider: ConnectionProvider): { clientId: string; clientSecret: string } | null => {
  if (!provider.oauth) return null;
  const clientId = envValue(provider.oauth.clientIdEnv);
  const clientSecret = envValue(provider.oauth.clientSecretEnv);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
};

// Form-style OAuth grant factory: one implementation of the
// authorization-code exchange + refresh for every provider whose token
// endpoint takes form-encoded grants (Google, TikTok, Twitch, Tumblr, X,
// Pinterest, Reddit, Spotify). Client auth is either in the body or HTTP
// Basic; refresh is ROTATION-AWARE by construction — a returned refresh_token
// always replaces the stored one, otherwise the old one is kept — so a
// rotating provider (TikTok, X) can never strand its refresh token because a
// copy-paste kept the wrong template.
const formOAuthGrant = (config: {
  tokenUrl: string;
  authStyle: 'body' | 'basic';
  // TikTok calls its client id 'client_key'
  clientIdParam?: string;
  scopes: string[];
  // extra exchange params (e.g. PKCE code_verifier)
  extraExchangeParams?: (input: { codeVerifier?: string }) => Record<string, string>;
  // post-exchange transform (e.g. capture provider ids from the response)
  mapExtra?: (data: any, tokens: OAuthTokens) => OAuthTokens;
}): {
  exchangeCode: NonNullable<ConnectionProvider['oauth']>['exchangeCode'];
  refreshTokens: NonNullable<ConnectionProvider['oauth']>['refreshTokens'];
} => {
  const idParam = config.clientIdParam || 'client_id';
  const clientParams = (clientId: string, clientSecret: string): Record<string, string> =>
    config.authStyle === 'body' ? { [idParam]: clientId, client_secret: clientSecret } : {};
  const authOpts = (clientId: string, clientSecret: string) =>
    config.authStyle === 'basic' ? { basicAuth: { user: clientId, pass: clientSecret } } : {};
  const toTokens = (data: any, previous?: OAuthTokens): OAuthTokens | null => {
    if (!data?.access_token) return null;
    const tokens: OAuthTokens = {
      accessToken: String(data.access_token),
      refreshToken: data.refresh_token ? String(data.refresh_token) : previous?.refreshToken || null,
      expiresAt: expiresAtFrom(data.expires_in),
      scopes: config.scopes
    };
    return config.mapExtra ? config.mapExtra(data, tokens) : tokens;
  };
  return {
    exchangeCode: async ({ code, clientId, clientSecret, redirectUri, codeVerifier }) => {
      const exchanged = await postForm(
        config.tokenUrl,
        {
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          ...clientParams(clientId, clientSecret),
          ...(config.extraExchangeParams ? config.extraExchangeParams({ codeVerifier }) : {})
        },
        authOpts(clientId, clientSecret)
      );
      if (exchanged.ok === false) return exchanged;
      const tokens = toTokens(exchanged.data);
      if (!tokens) return fail(502, `${hostOf(config.tokenUrl)} did not return an access token`);
      return { ok: true, tokens };
    },
    refreshTokens: async (tokens, creds) => {
      if (!tokens.refreshToken) return null;
      const refreshed = await postForm(
        config.tokenUrl,
        { grant_type: 'refresh_token', refresh_token: tokens.refreshToken, ...clientParams(creds.clientId, creds.clientSecret) },
        authOpts(creds.clientId, creds.clientSecret)
      );
      if (refreshed.ok === false) return null;
      return toTokens(refreshed.data, tokens);
    }
  };
};

// Meta Graph-style paged feed (Facebook + Instagram share the exact loop):
// follow paging.next (absolute https only — it embeds the access token) until
// the page target is met, tolerating a mid-pagination error by returning the
// partial result.
const pagedGraphFeed = async (
  firstUrl: string,
  mapItem: (item: any) => ExternalFeedItem | null,
  opts: { limit: number; pages?: number }
): Promise<{ ok: true; items: ExternalFeedItem[] } | Fail> => {
  const items: ExternalFeedItem[] = [];
  let url: string | null = firstUrl;
  for (let page = 0; page < pageCount(opts) && url; page += 1) {
    const fetched = await authedJson(url);
    if (fetched.ok === false) return items.length ? { ok: true, items } : fetched;
    for (const entry of fetched.data?.data || []) {
      const item = mapItem(entry);
      if (item) items.push(item);
      if (items.length >= targetCount(opts)) break;
    }
    const next = fetched.data?.paging?.next;
    url = typeof next === 'string' && next.startsWith('https://') ? next : null;
  }
  return { ok: true, items };
};

// A hostname input like "mastodon.social" — no scheme, no path, no userinfo.
const sanitizeHost = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  return /^[a-z0-9][a-z0-9.-]{1,200}\.[a-z]{2,}$/.test(host) ? host : null;
};

// --- minimal RSS/Atom parsing (well-formed feeds; no new dependencies) ------

// Every helper below walks the document with indexOf rather than letting a
// regex backtrack — the same rule stripBlocks/stripTags follow, and for the
// same reason: this XML is attacker-fetched. The lazy `<tag…>([\s\S]*?)</tag>`
// and `<tag[^>]*…>` patterns these replace retried from EVERY occurrence of the
// opening tag when the closing one never arrived, so a body of `<title>`
// repeated with no `</title>` was quadratic — 256KB cost ~3s, and the response
// cap is 3MB. Any signed-in account can point the RSS provider at a host it
// controls, so that was a remote stall of the whole event loop.

// Index just past the `>` that ends the tag whose name ends at `from`, or -1.
// Quoted attribute values are skipped: XML only requires `<` and `&` to be
// escaped, so `href="…?a=1>2"` is legal and its `>` does not end the tag. The
// old `[^>]*` … `"([^"]*)"` pair happened to tolerate that (the VALUE class
// could cross `>`), and a differential fuzz against it surfaced exactly this
// case — so the scan is quote-aware rather than truncating such a tag and
// silently dropping the attribute.
const tagEndsAt = (xml: string, from: number): number => {
  let quote = '';
  for (let at = from; at < xml.length; at += 1) {
    const char = xml[at];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return at + 1;
    }
  }
  return -1;
};

// The next `<tag …>` at or after `from`: its `<` index, the index just past the
// opening `>`, and the raw tag text. null once no further opening tag exists.
const nextOpenTag = (
  xml: string,
  lower: string,
  tag: string,
  from: number
): { start: number; bodyAt: number; text: string } | null => {
  // `lower` is the whole document lowercased, so the NAME has to be lowered
  // too or a mixed-case tag (`pubDate`, `media:thumbnail`) never matches —
  // the patterns this replaces carried the `i` flag, which covered both sides.
  const open = `<${tag.toLowerCase()}`;
  let cursor = from;
  while (cursor < lower.length) {
    const start = lower.indexOf(open, cursor);
    if (start === -1) return null;
    // the name has to END here: `<link>` and `<link …>` are the `link` tag,
    // `<linkinfo>` is not (the `\s`/`\b` the old patterns spelled out)
    const boundary = lower[start + open.length];
    if (boundary === '>' || (boundary !== undefined && /\s/.test(boundary))) {
      const bodyAt = tagEndsAt(xml, start + open.length);
      if (bodyAt === -1) return null; // never terminated — no usable tag follows
      return { start, bodyAt, text: xml.slice(start, bodyAt) };
    }
    cursor = start + open.length;
  }
  return null;
};

const tagContent = (xml: string, tag: string): string | null => {
  const lower = xml.toLowerCase();
  const opened = nextOpenTag(xml, lower, tag, 0);
  if (!opened) return null;
  const end = lower.indexOf(`</${tag.toLowerCase()}>`, opened.bodyAt);
  if (end === -1) return null;
  const inner = xml.slice(opened.bodyAt, end).trim();
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return (cdata ? cdata[1] : inner).trim();
};

// `attr="…"` inside ONE already-bounded tag's text.
const attrValueIn = (tagText: string, attr: string): string | null => {
  const lower = tagText.toLowerCase();
  const needle = `${attr.toLowerCase()}="`;
  let cursor = 0;
  while (cursor < lower.length) {
    const at = lower.indexOf(needle, cursor);
    if (at === -1) return null;
    // whitespace before the name, as the old patterns required — so
    // `data-href="…"` never answers a request for `href`
    if (at > 0 && /\s/.test(tagText[at - 1])) {
      const close = tagText.indexOf('"', at + needle.length);
      if (close === -1) return null;
      return decodeEntities(tagText.slice(at + needle.length, close));
    }
    cursor = at + needle.length;
  }
  return null;
};

// Attribute order in real feeds is arbitrary (<enclosure url=… type=…/> is the
// common shape) — find the first tag whose full attribute text satisfies
// `where`, then pull the attribute out separately. Without `where` this is the
// plain "first <tag> carrying that attribute" lookup.
const tagAttrWhere = (xml: string, tag: string, attr: string, where?: RegExp): string | null => {
  const lower = xml.toLowerCase();
  let cursor = 0;
  for (;;) {
    const opened = nextOpenTag(xml, lower, tag, cursor);
    if (!opened) return null;
    cursor = opened.bodyAt;
    if (where && !where.test(opened.text)) continue;
    const value = attrValueIn(opened.text, attr);
    if (value !== null) return value;
  }
};

const tagAttr = (xml: string, tag: string, attr: string): string | null => tagAttrWhere(xml, tag, attr);

const blocksOf = (xml: string, tag: string): string[] => {
  const lower = xml.toLowerCase();
  const close = `</${tag.toLowerCase()}>`;
  const blocks: string[] = [];
  let cursor = 0;
  while (blocks.length < FEED_FETCH_LIMIT * 2) {
    const opened = nextOpenTag(xml, lower, tag, cursor);
    if (!opened) break;
    const end = lower.indexOf(close, opened.bodyAt);
    if (end === -1) break;
    blocks.push(xml.slice(opened.bodyAt, end));
    cursor = end + close.length;
  }
  return blocks;
};

type ParsedFeed = { title: string; link: string | null; items: ExternalFeedItem[] };

export const parseRssOrAtom = (xml: string): ParsedFeed | null => {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const items: ExternalFeedItem[] = [];
  if (isAtom) {
    const headEnd = xml.search(/<entry[\s>]/i);
    const head = headEnd === -1 ? xml : xml.slice(0, headEnd);
    const feedTitle = boundedText(tagContent(head, 'title') || '', MAX_TITLE_CHARS);
    // `where` rather than a regex fragment smuggled through the tag name, now
    // that tag names are matched literally — and it no longer requires href to
    // come after rel, which real feeds do not guarantee
    const feedLink = tagAttrWhere(head, 'link', 'href', /rel="alternate"/i) || tagAttr(head, 'link', 'href');
    for (const entry of blocksOf(xml, 'entry')) {
      const id = tagContent(entry, 'id') || tagAttr(entry, 'link', 'href') || '';
      if (!id) continue;
      const title = boundedText(tagContent(entry, 'title') || '', MAX_TITLE_CHARS);
      const body = tagContent(entry, 'media:description') || tagContent(entry, 'content') || tagContent(entry, 'summary') || '';
      const thumb = tagAttr(entry, 'media:thumbnail', 'url');
      items.push({
        externalId: id.slice(0, 500),
        url: tagAttr(entry, 'link', 'href'),
        title: title || null,
        text: boundedText(body, MAX_TEXT_CHARS),
        images: boundedImages([thumb]),
        author: { name: boundedText(tagContent(entry, 'name') || '', 120) || null, handle: null, avatarUrl: null, url: null },
        publishedAt: dateOrNull(tagContent(entry, 'published') || tagContent(entry, 'updated')),
        stats: null
      });
    }
    return { title: feedTitle, link: feedLink, items };
  }
  if (!/<rss[\s>]|<channel[\s>]/i.test(xml)) return null;
  const headEnd = xml.search(/<item[\s>]/i);
  const head = headEnd === -1 ? xml : xml.slice(0, headEnd);
  const feedTitle = boundedText(tagContent(head, 'title') || '', MAX_TITLE_CHARS);
  const feedLink = tagContent(head, 'link');
  for (const item of blocksOf(xml, 'item')) {
    const link = tagContent(item, 'link');
    const guid = tagContent(item, 'guid') || link || '';
    if (!guid) continue;
    const enclosure = tagAttrWhere(item, 'enclosure', 'url', /type="image\//i) || tagAttr(item, 'media:content', 'url');
    items.push({
      externalId: guid.slice(0, 500),
      url: link ? decodeEntities(link).slice(0, 1500) : null,
      title: boundedText(tagContent(item, 'title') || '', MAX_TITLE_CHARS) || null,
      text: boundedText(tagContent(item, 'content:encoded') || tagContent(item, 'description') || '', MAX_TEXT_CHARS),
      images: boundedImages([enclosure, tagAttr(item, 'media:thumbnail', 'url')]),
      author: { name: boundedText(tagContent(item, 'dc:creator') || tagContent(item, 'author') || '', 120) || null, handle: null, avatarUrl: null, url: null },
      publishedAt: dateOrNull(tagContent(item, 'pubDate') || tagContent(item, 'dc:date')),
      stats: null
    });
  }
  return { title: feedTitle, link: feedLink ? decodeEntities(feedLink) : null, items };
};

// --- demo provider ----------------------------------------------------------
// A deterministic synthetic "personal algorithm" — the full personalized-feed
// path (connect → sync → acl-gated posts → comments/reactions → AI filters)
// is E2E-testable with zero network and zero secrets. New posts "arrive" as
// hours pass; content rotates through moods so filter rules have matches.

const DEMO_TOPICS = [
  { mood: 'happy', title: 'Community garden doubles its harvest', text: 'Volunteers celebrated a record season — twice the vegetables of last year, all donated to the local food bank. 🥕' },
  { mood: 'sad', title: 'Beloved local bookstore closes after 40 years', text: 'Readers mourned as the little shop on Main St announced its final day. The owner said rising rents left no other choice.' },
  { mood: 'happy', title: 'Rescue dog learns to surf, wins hearts', text: 'A three-legged rescue pup caught its first wave this weekend and the whole beach cheered.' },
  { mood: 'sad', title: 'Storm damages historic pier, repairs uncertain', text: 'Overnight winds tore through the century-old boardwalk. Engineers called the damage heartbreaking and severe.' },
  { mood: 'neutral', title: 'City tests new bike lane layout downtown', text: 'The trial reshuffles two blocks of parking; feedback is open until the end of the month.' },
  { mood: 'happy', title: 'Local teen wins international science fair', text: 'Her low-cost water filter design took first prize and a university scholarship.' },
  { mood: 'sad', title: 'Wildfire smoke returns to the valley', text: 'Air quality warnings are back as distant fires send another tragic plume across the region.' },
  { mood: 'neutral', title: 'Farmers market moves to the riverside lot', text: 'Same vendors, new views — the Saturday market relocates starting next week.' },
  { mood: 'happy', title: 'Stray cat elected honorary station master', text: 'Commuters delighted as the fluffy regular got a tiny hat and an official plaque.' },
  { mood: 'neutral', title: 'Library extends late hours for exam season', text: 'Study rooms stay open till midnight through the end of the month.' }
];

const demoProvider: ConnectionProvider = {
  id: 'demo',
  name: 'Demo Feed',
  icon: '🧪',
  auth: 'none',
  contentVisibility: 'personal',
  about: 'A synthetic personalized feed for trying connections end to end — no external account needed.',
  configured: () => true,
  fields: [
    { key: 'handle', label: 'Demo handle', placeholder: 'my-demo', help: 'Any name — it seeds your personal demo algorithm.', required: true }
  ],
  resolveAccount: async (fields) => {
    const handle = (fields.handle || 'demo').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'demo';
    return {
      ok: true,
      account: {
        providerAccountId: handle,
        displayName: `Demo · ${handle}`,
        handle,
        avatarUrl: null,
        profileUrl: null,
        config: { handle }
      }
    };
  },
  fetchFeed: async (account, opts) => {
    const handle = account.config.handle || account.providerAccountId;
    // one new post per hour per handle, deterministic content — reruns of the
    // same hour upsert the same externalIds (idempotent sync by construction)
    const hourIndex = Math.floor(Date.now() / 3_600_000);
    const items: ExternalFeedItem[] = [];
    for (let i = 0; i < Math.min(opts.limit, 20); i++) {
      const slot = hourIndex - i;
      const seed = Number.parseInt(sha1of(`${handle}:${slot}`).slice(0, 8), 16);
      const topic = DEMO_TOPICS[seed % DEMO_TOPICS.length];
      items.push({
        externalId: `demo-${handle}-${slot}`,
        url: null,
        title: topic.title,
        text: `${topic.text}\n\n(Demo algorithm pick #${slot % 1000} for @${handle}.)`,
        images: [],
        author: { name: 'Demo Algorithm', handle: `algo-${handle}`, avatarUrl: null, url: null },
        publishedAt: new Date(slot * 3_600_000),
        stats: { likes: seed % 250, comments: seed % 40, shares: seed % 15 }
      });
    }
    return { ok: true, items };
  }
};

// --- rss --------------------------------------------------------------------

const rssProvider: ConnectionProvider = {
  id: 'rss',
  name: 'RSS / Atom',
  icon: '📰',
  auth: 'none',
  contentVisibility: 'public',
  about: 'Follow any site that publishes an RSS or Atom feed.',
  configured: () => true,
  fields: [{ key: 'feedUrl', label: 'Feed URL', placeholder: 'https://example.com/feed.xml', required: true }],
  resolveAccount: async (fields) => {
    const raw = (fields.feedUrl || '').trim();
    if (!/^https:\/\/[^\s]+$/i.test(raw) || raw.length > 1500) return fail(400, 'feedUrl must be an https:// URL');
    const fetched = await fetchText(raw, 'application/rss+xml, application/atom+xml, application/xml, text/xml');
    if (fetched.ok === false) return fetched;
    const feed = parseRssOrAtom(fetched.text);
    if (!feed) return fail(400, 'That URL does not look like an RSS or Atom feed');
    const host = new URL(raw).host;
    return {
      ok: true,
      account: {
        providerAccountId: raw.toLowerCase(),
        displayName: feed.title || host,
        handle: host,
        avatarUrl: null,
        // The feed's own <link href> — fully attacker-controlled, since the
        // feed is whatever URL the user typed. Every other remote-supplied
        // link in this file rides webLink for exactly this reason; without it
        // a `javascript:` href is stored verbatim on the account crystal.
        profileUrl: webLink(feed.link),
        config: { feedUrl: raw }
      }
    };
  },
  fetchFeed: async (account, opts) => {
    const fetched = await fetchText(account.config.feedUrl, 'application/rss+xml, application/atom+xml, application/xml, text/xml');
    if (fetched.ok === false) return fetched;
    const feed = parseRssOrAtom(fetched.text);
    if (!feed) return fail(502, 'The feed could not be parsed');
    return { ok: true, items: feed.items.slice(0, opts.limit) };
  }
};

// --- reddit -----------------------------------------------------------------

const redditProvider: ConnectionProvider = {
  id: 'reddit',
  name: 'Reddit',
  icon: '👽',
  auth: 'none',
  contentVisibility: 'public',
  about: 'Follow one or more subreddits (public feeds — no Reddit login needed).',
  configured: () => true,
  fields: [
    { key: 'subreddits', label: 'Subreddits', placeholder: 'worldnews+technology', help: 'One or more subreddit names joined with + or commas.', required: true },
    { key: 'sort', label: 'Sort', placeholder: 'hot', help: 'hot, new, top, or rising (default hot).' }
  ],
  resolveAccount: async (fields) => {
    const subs = (fields.subreddits || '')
      .split(/[+,\s]+/)
      .map((sub) => sub.trim().replace(/^r\//i, '').toLowerCase())
      .filter((sub) => /^[a-z0-9_]{2,50}$/.test(sub))
      .slice(0, 10);
    if (!subs.length) return fail(400, 'subreddits must name at least one subreddit');
    const sort = ['hot', 'new', 'top', 'rising'].includes((fields.sort || '').trim().toLowerCase()) ? (fields.sort || '').trim().toLowerCase() : 'hot';
    const joined = subs.join('+');
    return {
      ok: true,
      account: {
        providerAccountId: `${joined}:${sort}`,
        displayName: `r/${joined}`,
        handle: `r/${joined}`,
        avatarUrl: null,
        profileUrl: `https://www.reddit.com/r/${joined}/`,
        config: { subreddits: joined, sort }
      }
    };
  },
  fetchFeed: async (account, opts) => {
    // Reddit's public .json endpoints 403 non-browser clients, but the Atom
    // .rss twins of the same listings stay open — parse those instead.
    const { subreddits, sort } = account.config;
    const url = `https://www.reddit.com/r/${subreddits}/${sort || 'hot'}.rss?limit=${Math.min(opts.limit, 50)}`;
    const fetched = await fetchText(url, 'application/atom+xml, application/xml');
    if (fetched.ok === false) return fetched;
    const feed = parseRssOrAtom(fetched.text);
    if (!feed) return fail(502, 'The subreddit feed could not be parsed');
    return { ok: true, items: feed.items.slice(0, opts.limit) };
  }
};

// --- hacker news ------------------------------------------------------------

const hackerNewsProvider: ConnectionProvider = {
  id: 'hackernews',
  name: 'Hacker News',
  icon: '🟠',
  auth: 'none',
  contentVisibility: 'public',
  about: 'Top, new, or best stories from Hacker News.',
  configured: () => true,
  fields: [{ key: 'feed', label: 'Story list', placeholder: 'top', help: 'top, new, or best (default top).' }],
  resolveAccount: async (fields) => {
    const feed = ['top', 'new', 'best'].includes((fields.feed || '').trim().toLowerCase()) ? (fields.feed || '').trim().toLowerCase() : 'top';
    return {
      ok: true,
      account: {
        providerAccountId: feed,
        displayName: `Hacker News · ${feed}`,
        handle: `hn/${feed}`,
        avatarUrl: null,
        profileUrl: 'https://news.ycombinator.com/',
        config: { feed }
      }
    };
  },
  fetchFeed: async (account, opts) => {
    const list = await fetchJson(`https://hacker-news.firebaseio.com/v0/${account.config.feed || 'top'}stories.json`);
    if (list.ok === false) return list;
    const ids = (Array.isArray(list.data) ? list.data : []).slice(0, Math.min(opts.limit, 25));
    const stories = await Promise.all(ids.map((id: number) => fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)));
    const items: ExternalFeedItem[] = [];
    for (const story of stories) {
      if (story.ok === false || !story.data?.id) continue;
      const data = story.data;
      items.push({
        externalId: `hn-${data.id}`,
        url: typeof data.url === 'string' ? data.url.slice(0, 1500) : `https://news.ycombinator.com/item?id=${data.id}`,
        title: boundedText(data.title, MAX_TITLE_CHARS) || null,
        text: boundedText(data.text || '', MAX_TEXT_CHARS),
        images: [],
        author: {
          name: typeof data.by === 'string' ? data.by : null,
          handle: typeof data.by === 'string' ? data.by : null,
          avatarUrl: null,
          url: typeof data.by === 'string' ? `https://news.ycombinator.com/user?id=${data.by}` : null
        },
        publishedAt: typeof data.time === 'number' ? new Date(data.time * 1000) : null,
        stats: { score: data.score, comments: data.descendants }
      });
    }
    return { ok: true, items };
  }
};

// --- youtube: Thingtime-managed virtual subscriptions (ytsubber-style) ------
// One connection = YOUR channel list, managed inside Thingtime: add/remove
// channels any time (name search rides the YouTube Data API when a key is
// configured; channel IDs, /channel/ URLs, and @handles resolve keylessly via
// the public uploads feed). The feed merges every channel's uploads newest-
// first. The account is deliberately PER USER (providerAccountId embeds the
// userId) — your list is yours; post-level dedupe still unifies a video that
// several users follow into ONE external-post via its stable video id.

export type YoutubeChannelRef = { id: string; title: string; thumbnail: string | null };

const YT_CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{10,60}$/;
export const MAX_VIRTUAL_CHANNELS = 100;
const YT_API = 'https://www.googleapis.com/youtube/v3';

export const youtubeApiKey = (): string => envValue('YOUTUBE_API_KEY') || envValue('GOOGLE_API_KEY');

const boundedChannelRef = (id: string, title: unknown, thumbnail: unknown): YoutubeChannelRef => ({
  id,
  title: boundedText(title, 120) || id,
  thumbnail: httpsImage(thumbnail)
});

export const sanitizeChannelList = (value: unknown): YoutubeChannelRef[] => {
  if (!Array.isArray(value)) return [];
  const channels: YoutubeChannelRef[] = [];
  for (const entry of value) {
    const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
    if (!YT_CHANNEL_ID_RE.test(id) || channels.some((channel) => channel.id === id)) continue;
    channels.push(boundedChannelRef(id, entry?.title, entry?.thumbnail));
    if (channels.length >= MAX_VIRTUAL_CHANNELS) break;
  }
  return channels;
};

// Resolve free-form input (UC… id, /channel/ URL, @handle, or a name to
// search) into channel candidates. Data API when a key is set; UC ids and
// @handles keep a keyless fallback so the system works with zero config.
export const resolveYoutubeChannelQuery = async (
  query: string
): Promise<{ ok: true; channels: YoutubeChannelRef[]; via: 'api' | 'rss' } | Fail> => {
  const raw = (query || '').trim();
  if (!raw) return fail(400, 'Give a channel id, URL, @handle, or a name to search');
  const key = youtubeApiKey();

  const urlMatch = raw.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{10,60})/i);
  const channelId = urlMatch ? urlMatch[1] : YT_CHANNEL_ID_RE.test(raw) ? raw : null;
  const handleMatch = raw.match(/(?:youtube\.com\/)?(@[A-Za-z0-9._-]{3,60})/);

  if (key) {
    let url: string | null = null;
    if (channelId) url = `${YT_API}/channels?part=snippet&id=${channelId}&key=${key}`;
    else if (handleMatch) url = `${YT_API}/channels?part=snippet&forHandle=${encodeURIComponent(handleMatch[1])}&key=${key}`;
    if (url) {
      const fetched = await fetchJson(url);
      if (fetched.ok === false) return fetched;
      const items = Array.isArray(fetched.data?.items) ? fetched.data.items : [];
      return {
        ok: true,
        via: 'api',
        channels: items.map((item: any) => boundedChannelRef(String(item.id), item.snippet?.title, item.snippet?.thumbnails?.default?.url))
      };
    }
    const search = await fetchJson(`${YT_API}/search?part=snippet&type=channel&maxResults=8&q=${encodeURIComponent(raw)}&key=${key}`);
    if (search.ok === false) return search;
    const items = Array.isArray(search.data?.items) ? search.data.items : [];
    return {
      ok: true,
      via: 'api',
      channels: items
        .filter((item: any) => typeof item?.snippet?.channelId === 'string')
        .map((item: any) => boundedChannelRef(String(item.snippet.channelId), item.snippet?.channelTitle || item.snippet?.title, item.snippet?.thumbnails?.default?.url))
    };
  }

  // keyless: UC ids probe the public uploads feed for the title; @handles and
  // name search need the Data API key
  if (channelId) {
    const fetched = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, 'application/atom+xml, application/xml');
    if (fetched.ok === false) return fetched;
    const feed = parseRssOrAtom(fetched.text);
    if (!feed) return fail(404, 'YouTube did not return a channel feed for that id');
    return { ok: true, via: 'rss', channels: [boundedChannelRef(channelId, feed.title, null)] };
  }
  return fail(400, 'Name and @handle search need a YouTube Data API key (YOUTUBE_API_KEY) — paste a channel ID or /channel/ URL instead');
};

// null = this channel's feed failed (distinct from an empty feed), so the
// caller can tell total failure from a quiet day and surface a sync error.
const fetchChannelUploads = async (channel: YoutubeChannelRef, perChannel: number): Promise<ExternalFeedItem[] | null> => {
  const fetched = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`, 'application/atom+xml, application/xml');
  if (fetched.ok === false) return null;
  const feed = parseRssOrAtom(fetched.text);
  if (!feed) return null;
  return feed.items.slice(0, perChannel).map((item) => ({
    ...item,
    author: { name: feed.title || channel.title, handle: channel.title, avatarUrl: channel.thumbnail, url: `https://www.youtube.com/channel/${channel.id}` }
  }));
};

const youtubeProvider: ConnectionProvider = {
  id: 'youtube',
  name: 'YouTube channels',
  icon: '📺',
  auth: 'none',
  contentVisibility: 'public',
  about: 'Your Thingtime-managed channel list — follow any set of YouTube channels as one merged uploads feed, and grow it any time.',
  configured: () => true,
  fields: [
    {
      key: 'channel',
      label: 'First channel (optional)',
      placeholder: youtubeApiKey() ? 'Channel name, @handle, UC… id, or URL' : 'UC… id or youtube.com/channel/… URL',
      help: youtubeApiKey()
        ? 'Also searchable by name — you can add more channels after connecting.'
        : 'Add more channels after connecting. Name and @handle search light up once a YouTube Data API key is configured.'
    }
  ],
  // reconnect must never wipe the managed list — union stored + resolved
  mergeConfig: (existing, next) => ({
    ...existing,
    ...next,
    channels: sanitizeChannelList([...(Array.isArray(existing?.channels) ? existing.channels : []), ...(Array.isArray(next?.channels) ? next.channels : [])])
  }),
  resolveAccount: async (fields, ctx) => {
    const channels: YoutubeChannelRef[] = [];
    const first = (fields.channel || '').trim();
    if (first) {
      const resolved = await resolveYoutubeChannelQuery(first);
      if (resolved.ok === false) return resolved;
      if (!resolved.channels.length) return fail(404, 'No channel matched that input');
      channels.push(resolved.channels[0]);
    }
    return {
      ok: true,
      account: {
        // per-user virtual account — never shared, unlike real identities
        providerAccountId: `subs:${ctx.userId}`,
        displayName: 'My YouTube channels',
        handle: `${channels.length} channel${channels.length === 1 ? '' : 's'}`,
        avatarUrl: channels[0]?.thumbnail || null,
        profileUrl: null,
        config: { channels }
      }
    };
  },
  fetchFeed: async (account, opts) => {
    let channels = sanitizeChannelList(account.config.channels);
    // fold-in: pre-virtual single-channel connections carried config.channelId
    if (!channels.length && typeof account.config.channelId === 'string' && YT_CHANNEL_ID_RE.test(account.config.channelId)) {
      channels = [boundedChannelRef(account.config.channelId, account.config.channelId, null)];
    }
    if (!channels.length) return { ok: true, items: [] };
    // uploads feed per channel (keyless, always fresh), bounded fan-out; a
    // deeper page pulls more videos per channel from the same feeds
    const perChannel = Math.min(15, Math.max(5, Math.ceil(targetCount(opts) / Math.min(channels.length, 25))));
    const active = channels.slice(0, 25);
    const batches: (ExternalFeedItem[] | null)[] = [];
    const CONCURRENCY = 8;
    for (let start = 0; start < active.length; start += CONCURRENCY) {
      batches.push(...(await Promise.all(active.slice(start, start + CONCURRENCY).map((channel) => fetchChannelUploads(channel, perChannel)))));
    }
    // every channel failing is a sync FAILURE, not an empty feed — surface it
    // so lastSyncError shows instead of silently entering the cooldown
    const failures = batches.filter((batch) => batch === null).length;
    if (failures === active.length) {
      return fail(502, `None of the ${active.length} channel feeds could be fetched`);
    }
    const merged = batches
      .filter((batch): batch is ExternalFeedItem[] => batch !== null)
      .flat()
      .sort((a, b) => (b.publishedAt?.getTime() || 0) - (a.publishedAt?.getTime() || 0))
      .slice(0, targetCount(opts));
    return { ok: true, items: merged };
  }
};

// --- mastodon ---------------------------------------------------------------

const mastodonProvider: ConnectionProvider = {
  id: 'mastodon',
  name: 'Mastodon',
  icon: '🐘',
  auth: 'none',
  contentVisibility: 'public',
  about: "An instance's local timeline, or one account's posts, from any Mastodon server.",
  configured: () => true,
  fields: [
    { key: 'instance', label: 'Instance', placeholder: 'mastodon.social', required: true },
    { key: 'account', label: 'Account (optional)', placeholder: 'Gargron', help: 'Leave empty to follow the instance-wide local timeline.' }
  ],
  resolveAccount: async (fields) => {
    const instance = sanitizeHost(fields.instance);
    if (!instance) return fail(400, 'instance must be a hostname like mastodon.social');
    const acct = (fields.account || '').trim().replace(/^@/, '');
    if (!acct) {
      return {
        ok: true,
        account: {
          providerAccountId: `${instance}:local`,
          displayName: `${instance} · local timeline`,
          handle: instance,
          avatarUrl: null,
          profileUrl: `https://${instance}/public/local`,
          config: { instance, accountId: '', account: '' }
        }
      };
    }
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(acct)) return fail(400, 'account must be a Mastodon username on that instance');
    const looked = await fetchJson(`https://${instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(acct)}`);
    if (looked.ok === false) return looked;
    if (!looked.data?.id) return fail(404, `@${acct} was not found on ${instance}`);
    return {
      ok: true,
      account: {
        providerAccountId: `${instance}:@${String(looked.data.acct || acct).toLowerCase()}`,
        displayName: boundedText(looked.data.display_name, 120) || `@${acct}`,
        handle: `@${looked.data.acct || acct}@${instance}`,
        avatarUrl: httpsImage(looked.data.avatar),
        // The instance is whatever host the user named, so `url` is remote
        // input like every other link here: scheme-check it rather than just
        // truncating. webLink already caps at 1500, and rejecting an
        // over-long URL beats storing a silently truncated (broken) one.
        profileUrl: webLink(looked.data.url) || `https://${instance}/@${acct}`,
        config: { instance, accountId: String(looked.data.id), account: acct }
      }
    };
  },
  fetchFeed: async (account, opts) => {
    const { instance, accountId } = account.config;
    const limit = Math.min(opts.limit, 40);
    const url = accountId
      ? `https://${instance}/api/v1/accounts/${accountId}/statuses?limit=${limit}&exclude_replies=true`
      : `https://${instance}/api/v1/timelines/public?local=true&limit=${limit}`;
    const fetched = await fetchJson(url);
    if (fetched.ok === false) return fetched;
    const statuses = Array.isArray(fetched.data) ? fetched.data : [];
    const items: ExternalFeedItem[] = [];
    for (const status of statuses) {
      const item = mapMastodonStatus(status, instance);
      if (item) items.push(item);
      if (items.length >= opts.limit) break;
    }
    return { ok: true, items };
  }
};

// One status mapper serves the public provider above and the OAuth
// home-timeline provider below — the item shape can never drift between them.
const mapMastodonStatus = (status: any, instance: string): ExternalFeedItem | null => {
  if (!status?.id) return null;
  const src = status.reblog || status;
  return {
    externalId: `${instance}-${status.id}`,
    url: typeof src.url === 'string' ? src.url.slice(0, 1500) : null,
    title: null,
    text: boundedText(src.content || '', MAX_TEXT_CHARS),
    images: boundedImages((src.media_attachments || []).map((media: any) => media?.preview_url || media?.url)),
    author: {
      name: boundedText(src.account?.display_name, 120) || null,
      handle: src.account?.acct ? `@${src.account.acct}` : null,
      avatarUrl: httpsImage(src.account?.avatar),
      url: typeof src.account?.url === 'string' ? src.account.url.slice(0, 1500) : null
    },
    publishedAt: dateOrNull(src.created_at),
    stats: { likes: src.favourites_count, comments: src.replies_count, shares: src.reblogs_count }
  };
};

// --- bluesky ----------------------------------------------------------------

const blueskyProvider: ConnectionProvider = {
  id: 'bluesky',
  name: 'Bluesky',
  icon: '🦋',
  auth: 'none',
  contentVisibility: 'public',
  about: "An account's posts via the public Bluesky AppView API.",
  configured: () => true,
  fields: [{ key: 'handle', label: 'Handle', placeholder: 'jay.bsky.team', required: true }],
  resolveAccount: async (fields) => {
    const handle = (fields.handle || '').trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9.-]{2,200}$/.test(handle)) return fail(400, 'handle must be a Bluesky handle like name.bsky.social');
    const profile = await fetchJson(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`);
    if (profile.ok === false) return profile;
    if (!profile.data?.did) return fail(404, `@${handle} was not found on Bluesky`);
    return {
      ok: true,
      account: {
        providerAccountId: String(profile.data.did),
        displayName: boundedText(profile.data.displayName, 120) || `@${handle}`,
        handle: `@${handle}`,
        avatarUrl: httpsImage(profile.data.avatar),
        profileUrl: `https://bsky.app/profile/${handle}`,
        config: { handle, did: String(profile.data.did) }
      }
    };
  },
  fetchFeed: async (account, opts) => {
    const actor = account.config.did || account.config.handle;
    const fetched = await fetchJson(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=${Math.min(opts.limit, 50)}&filter=posts_no_replies`
    );
    if (fetched.ok === false) return fetched;
    const entries = Array.isArray(fetched.data?.feed) ? fetched.data.feed : [];
    const items: ExternalFeedItem[] = [];
    for (const entry of entries) {
      const item = mapBlueskyFeedEntry(entry);
      if (item) items.push(item);
      if (items.length >= opts.limit) break;
    }
    return { ok: true, items };
  }
};

// Shared by the public author-feed provider above and the app-password
// following-timeline provider below.
const mapBlueskyFeedEntry = (entry: any): ExternalFeedItem | null => {
  const post = entry?.post;
  if (!post?.uri) return null;
  const embedImages = (post.embed?.images || post.record?.embed?.images || []).map((image: any) => image?.fullsize || image?.thumb);
  const rkey = String(post.uri).split('/').pop();
  return {
    externalId: String(post.uri).slice(0, 500),
    url: post.author?.handle && rkey ? `https://bsky.app/profile/${post.author.handle}/post/${rkey}` : null,
    title: null,
    text: boundedText(post.record?.text || '', MAX_TEXT_CHARS),
    images: boundedImages(embedImages),
    author: {
      name: boundedText(post.author?.displayName, 120) || null,
      handle: post.author?.handle ? `@${post.author.handle}` : null,
      avatarUrl: httpsImage(post.author?.avatar),
      url: post.author?.handle ? `https://bsky.app/profile/${post.author.handle}` : null
    },
    publishedAt: dateOrNull(post.record?.createdAt || post.indexedAt),
    stats: { likes: post.likeCount, comments: post.replyCount, shares: post.repostCount }
  };
};

// --- lemmy ------------------------------------------------------------------

const lemmyProvider: ConnectionProvider = {
  id: 'lemmy',
  name: 'Lemmy',
  icon: '🐭',
  auth: 'none',
  contentVisibility: 'public',
  about: "An instance's front page, or one community, from any Lemmy server.",
  configured: () => true,
  fields: [
    { key: 'instance', label: 'Instance', placeholder: 'lemmy.world', required: true },
    { key: 'community', label: 'Community (optional)', placeholder: 'technology', help: 'Leave empty for the instance front page.' }
  ],
  resolveAccount: async (fields) => {
    const instance = sanitizeHost(fields.instance);
    if (!instance) return fail(400, 'instance must be a hostname like lemmy.world');
    const community = (fields.community || '').trim().toLowerCase().replace(/^!/, '');
    if (community && !/^[a-z0-9_]{2,80}$/.test(community)) return fail(400, 'community must be a Lemmy community name');
    const probe = await fetchJson(
      community
        ? `https://${instance}/api/v3/community?name=${encodeURIComponent(community)}`
        : `https://${instance}/api/v3/site`
    );
    if (probe.ok === false) return probe;
    const title = community
      ? boundedText(probe.data?.community_view?.community?.title, 120) || `!${community}`
      : boundedText(probe.data?.site_view?.site?.name, 120) || instance;
    return {
      ok: true,
      account: {
        providerAccountId: community ? `${instance}:!${community}` : `${instance}:front`,
        displayName: `${title} · ${instance}`,
        handle: community ? `!${community}@${instance}` : instance,
        avatarUrl: httpsImage(community ? probe.data?.community_view?.community?.icon : probe.data?.site_view?.site?.icon),
        profileUrl: community ? `https://${instance}/c/${community}` : `https://${instance}/`,
        config: { instance, community }
      }
    };
  },
  fetchFeed: async (account, opts) => {
    const { instance, community } = account.config;
    const url = `https://${instance}/api/v3/post/list?limit=${Math.min(opts.limit, 40)}&sort=Hot${community ? `&community_name=${encodeURIComponent(community)}` : ''}`;
    const fetched = await fetchJson(url);
    if (fetched.ok === false) return fetched;
    const posts = Array.isArray(fetched.data?.posts) ? fetched.data.posts : [];
    const items: ExternalFeedItem[] = [];
    for (const view of posts) {
      const post = view?.post;
      if (!post?.id) continue;
      items.push({
        externalId: `${instance}-${post.id}`,
        url: typeof post.ap_id === 'string' ? post.ap_id.slice(0, 1500) : null,
        title: boundedText(post.name, MAX_TITLE_CHARS) || null,
        text: boundedText(post.body || '', MAX_TEXT_CHARS),
        images: boundedImages([post.thumbnail_url, post.url]),
        author: {
          name: boundedText(view.creator?.name, 120) || null,
          handle: view.creator?.name ? `@${view.creator.name}@${instance}` : null,
          avatarUrl: httpsImage(view.creator?.avatar),
          url: typeof view.creator?.actor_id === 'string' ? view.creator.actor_id.slice(0, 1500) : null
        },
        publishedAt: dateOrNull(post.published),
        stats: { score: view.counts?.score, comments: view.counts?.comments }
      });
      if (items.length >= opts.limit) break;
    }
    return { ok: true, items };
  }
};

// --- github -----------------------------------------------------------------

const githubEventSummary = (event: any): string => {
  const repo = event?.repo?.name || 'a repository';
  const payload = event?.payload || {};
  switch (event?.type) {
    case 'PushEvent': {
      const count = Array.isArray(payload.commits) ? payload.commits.length : 0;
      const first = payload.commits?.[0]?.message ? `: “${stripHtml(payload.commits[0].message).slice(0, 140)}”` : '';
      return `pushed ${count || 'new'} commit${count === 1 ? '' : 's'} to ${repo}${first}`;
    }
    case 'PullRequestEvent':
      return `${payload.action || 'updated'} a pull request in ${repo}: ${stripHtml(payload.pull_request?.title || '').slice(0, 140)}`;
    case 'IssuesEvent':
      return `${payload.action || 'updated'} an issue in ${repo}: ${stripHtml(payload.issue?.title || '').slice(0, 140)}`;
    case 'IssueCommentEvent':
      return `commented on ${repo}: ${stripHtml(payload.comment?.body || '').slice(0, 140)}`;
    case 'WatchEvent':
      return `starred ${repo}`;
    case 'ForkEvent':
      return `forked ${repo}`;
    case 'CreateEvent':
      return `created ${payload.ref_type || 'something'} ${payload.ref || ''} in ${repo}`.trim();
    case 'ReleaseEvent':
      return `released ${stripHtml(payload.release?.name || payload.release?.tag_name || '').slice(0, 80)} in ${repo}`;
    default:
      return `${String(event?.type || 'activity').replace(/Event$/, '')} in ${repo}`;
  }
};

const githubProvider: ConnectionProvider = {
  id: 'github',
  name: 'GitHub',
  icon: '🐙',
  auth: 'none',
  contentVisibility: 'public',
  about: "A user's public activity feed (pushes, PRs, issues, stars).",
  configured: () => true,
  fields: [{ key: 'username', label: 'Username', placeholder: 'torvalds', required: true }],
  resolveAccount: async (fields) => {
    const username = (fields.username || '').trim();
    if (!/^[A-Za-z0-9-]{1,60}$/.test(username)) return fail(400, 'username must be a GitHub username');
    const profile = await fetchJson(`https://api.github.com/users/${encodeURIComponent(username)}`);
    if (profile.ok === false) return profile;
    if (!profile.data?.login) return fail(404, `GitHub user ${username} was not found`);
    return {
      ok: true,
      account: {
        providerAccountId: String(profile.data.login).toLowerCase(),
        displayName: boundedText(profile.data.name, 120) || String(profile.data.login),
        handle: `@${profile.data.login}`,
        avatarUrl: httpsImage(profile.data.avatar_url),
        profileUrl: `https://github.com/${profile.data.login}`,
        config: { username: String(profile.data.login) }
      }
    };
  },
  fetchFeed: async (account, opts) => {
    const username = account.config.username;
    const fetched = await fetchJson(`https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=${Math.min(opts.limit, 30)}`);
    if (fetched.ok === false) return fetched;
    const events = Array.isArray(fetched.data) ? fetched.data : [];
    const items: ExternalFeedItem[] = [];
    for (const event of events) {
      if (!event?.id) continue;
      items.push({
        externalId: `gh-${event.id}`,
        url: event.repo?.name ? `https://github.com/${event.repo.name}` : null,
        title: null,
        text: `@${username} ${githubEventSummary(event)}`,
        images: [],
        author: {
          name: username,
          handle: `@${username}`,
          avatarUrl: httpsImage(event.actor?.avatar_url),
          url: `https://github.com/${username}`
        },
        publishedAt: dateOrNull(event.created_at),
        stats: null
      });
      if (items.length >= opts.limit) break;
    }
    return { ok: true, items };
  }
};

// --- SSO providers -----------------------------------------------------------
// Click Connect → the provider's own sign-in → the token response is saved to
// the Thingtime account (external-account secure blob) → the personalized
// feed syncs with those credentials. Each is config-gated: without its env
// credentials the catalog reports configured:false and the UI shows "Needs
// setup". Honesty notes live in each provider's `about`: official APIs bound
// what is fetchable (Meta removed the friends News Feed API in 2015; TikTok
// and Instagram expose your own content, not the For You/home feed).

const GRAPH = 'https://graph.facebook.com/v23.0';

const facebookProvider: ConnectionProvider = {
  id: 'facebook',
  name: 'Facebook',
  icon: '📘',
  auth: 'oauth2',
  contentVisibility: 'personal',
  about: 'Sign in with Facebook to link your account and sync your own timeline posts. (Meta’s API no longer exposes the friends News Feed — this pulls your posts and tagged posts.)',
  configured: () => !!envValue('FACEBOOK_APP_ID') && !!envValue('FACEBOOK_APP_SECRET'),
  fields: [],
  oauth: {
    clientIdEnv: 'FACEBOOK_APP_ID',
    clientSecretEnv: 'FACEBOOK_APP_SECRET',
    buildAuthorizeUrl: ({ clientId, redirectUri, state }) =>
      `https://www.facebook.com/v23.0/dialog/oauth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&response_type=code&scope=${encodeURIComponent('public_profile,user_posts')}`,
    exchangeCode: async ({ code, clientId, clientSecret, redirectUri }) => {
      const short = await fetchJson(
        `${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${encodeURIComponent(clientSecret)}&code=${encodeURIComponent(code)}`
      );
      if (short.ok === false) return short;
      if (!short.data?.access_token) return fail(502, 'Facebook did not return an access token');
      // upgrade to a ~60-day long-lived token (best-effort — the short token works either way)
      const long = await fetchJson(
        `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&fb_exchange_token=${encodeURIComponent(short.data.access_token)}`
      );
      const winner = long.ok !== false && long.data?.access_token ? long.data : short.data;
      return {
        ok: true,
        tokens: { accessToken: String(winner.access_token), expiresAt: expiresAtFrom(winner.expires_in), scopes: ['public_profile', 'user_posts'] }
      };
    },
    resolveAccountFromTokens: async (tokens) => {
      const me = await authedJson(`${GRAPH}/me?fields=id,name,picture.width(200)&access_token=${encodeURIComponent(tokens.accessToken)}`);
      if (me.ok === false) return me;
      if (!me.data?.id) return fail(502, 'Facebook did not return a profile');
      return {
        ok: true,
        account: {
          providerAccountId: String(me.data.id),
          displayName: boundedText(me.data.name, 120) || 'Facebook account',
          handle: boundedText(me.data.name, 120) || String(me.data.id),
          avatarUrl: httpsImage(me.data.picture?.data?.url),
          profileUrl: `https://www.facebook.com/${me.data.id}`,
          config: {}
        }
      };
    }
  },
  fetchFeed: async (_account, opts) => {
    if (!opts.tokens?.accessToken) return fail(401, 'Facebook needs a reconnect — its saved sign-in is missing or expired');
    return pagedGraphFeed(
      `${GRAPH}/me/posts?fields=id,message,story,created_time,permalink_url,full_picture,shares,likes.summary(true),comments.summary(true)&limit=25&access_token=${encodeURIComponent(opts.tokens.accessToken)}`,
      (post) =>
        post?.id
          ? {
              externalId: `fb-${post.id}`,
              url: typeof post.permalink_url === 'string' ? post.permalink_url.slice(0, 1500) : null,
              title: null,
              text: boundedText(post.message || post.story || '', MAX_TEXT_CHARS),
              images: boundedImages([post.full_picture]),
              author: { name: null, handle: null, avatarUrl: null, url: null },
              publishedAt: dateOrNull(post.created_time),
              stats: {
                likes: post.likes?.summary?.total_count,
                comments: post.comments?.summary?.total_count,
                shares: post.shares?.count
              }
            }
          : null,
      opts
    );
  }
};

const instagramProvider: ConnectionProvider = {
  id: 'instagram',
  name: 'Instagram',
  icon: '📷',
  auth: 'oauth2',
  contentVisibility: 'personal',
  about: 'Sign in with Instagram (professional account) to link and sync your own media. (Instagram’s API exposes your posts — not the home feed of accounts you follow.)',
  configured: () => !!envValue('INSTAGRAM_APP_ID') && !!envValue('INSTAGRAM_APP_SECRET'),
  fields: [],
  oauth: {
    clientIdEnv: 'INSTAGRAM_APP_ID',
    clientSecretEnv: 'INSTAGRAM_APP_SECRET',
    buildAuthorizeUrl: ({ clientId, redirectUri, state }) =>
      `https://www.instagram.com/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('instagram_business_basic')}&response_type=code&state=${encodeURIComponent(state)}`,
    exchangeCode: async ({ code, clientId, clientSecret, redirectUri }) => {
      const short = await postForm('https://api.instagram.com/oauth/access_token', {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code
      });
      if (short.ok === false) return short;
      if (!short.data?.access_token) return fail(502, 'Instagram did not return an access token');
      // upgrade to a 60-day token; refreshable while in use
      const long = await fetchJson(
        `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(clientSecret)}&access_token=${encodeURIComponent(short.data.access_token)}`
      );
      const upgraded = long.ok !== false && long.data?.access_token;
      const winner = upgraded ? long.data : short.data;
      return {
        ok: true,
        tokens: {
          accessToken: String(winner.access_token),
          // short-lived fallback tokens carry no expires_in — stamp their
          // ~1h lifetime so the refresh path (which can retry the long-lived
          // upgrade) actually engages instead of never firing
          expiresAt: expiresAtFrom(winner.expires_in) ?? new Date(Date.now() + 55 * 60 * 1000).toISOString(),
          scopes: ['instagram_business_basic'],
          providerUserId: short.data?.user_id ? String(short.data.user_id) : null
        }
      };
    },
    resolveAccountFromTokens: async (tokens) => {
      const me = await authedJson(
        `https://graph.instagram.com/v23.0/me?fields=user_id,username,name,profile_picture_url&access_token=${encodeURIComponent(tokens.accessToken)}`
      );
      if (me.ok === false) return me;
      const id = me.data?.user_id || me.data?.id || tokens.providerUserId;
      if (!id) return fail(502, 'Instagram did not return a profile');
      return {
        ok: true,
        account: {
          providerAccountId: String(id),
          displayName: boundedText(me.data?.name || me.data?.username, 120) || 'Instagram account',
          handle: me.data?.username ? `@${me.data.username}` : String(id),
          avatarUrl: httpsImage(me.data?.profile_picture_url),
          profileUrl: me.data?.username ? `https://www.instagram.com/${me.data.username}/` : null,
          config: {}
        }
      };
    },
    refreshTokens: async (tokens, creds) => {
      const refreshed = await fetchJson(
        `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(tokens.accessToken)}`
      );
      if (refreshed.ok !== false && refreshed.data?.access_token) {
        return { ...tokens, accessToken: String(refreshed.data.access_token), expiresAt: expiresAtFrom(refreshed.data.expires_in) };
      }
      // ig_refresh only works on long-lived tokens — a short-lived fallback
      // token (long exchange failed at callback time) upgrades here instead
      const upgraded = await fetchJson(
        `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(creds.clientSecret)}&access_token=${encodeURIComponent(tokens.accessToken)}`
      );
      if (upgraded.ok === false || !upgraded.data?.access_token) return null;
      return { ...tokens, accessToken: String(upgraded.data.access_token), expiresAt: expiresAtFrom(upgraded.data.expires_in) };
    }
  },
  fetchFeed: async (_account, opts) => {
    if (!opts.tokens?.accessToken) return fail(401, 'Instagram needs a reconnect — its saved sign-in is missing or expired');
    return pagedGraphFeed(
      `https://graph.instagram.com/v23.0/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=25&access_token=${encodeURIComponent(opts.tokens.accessToken)}`,
      (media) =>
        media?.id
          ? {
              externalId: `ig-${media.id}`,
              url: typeof media.permalink === 'string' ? media.permalink.slice(0, 1500) : null,
              title: null,
              text: boundedText(media.caption || '', MAX_TEXT_CHARS),
              images: boundedImages([media.media_type === 'VIDEO' ? media.thumbnail_url : media.media_url]),
              author: { name: null, handle: null, avatarUrl: null, url: null },
              publishedAt: dateOrNull(media.timestamp),
              stats: { likes: media.like_count, comments: media.comments_count }
            }
          : null,
      opts
    );
  }
};

const tiktokProvider: ConnectionProvider = {
  id: 'tiktok',
  name: 'TikTok',
  icon: '🎵',
  auth: 'oauth2',
  contentVisibility: 'personal',
  about: 'Sign in with TikTok to link your account and sync your own videos. (TikTok’s API exposes your videos — the For You feed is not available to apps.)',
  configured: () => !!envValue('TIKTOK_CLIENT_KEY') && !!envValue('TIKTOK_CLIENT_SECRET'),
  fields: [],
  oauth: {
    clientIdEnv: 'TIKTOK_CLIENT_KEY',
    clientSecretEnv: 'TIKTOK_CLIENT_SECRET',
    buildAuthorizeUrl: ({ clientId, redirectUri, state }) =>
      `https://www.tiktok.com/v2/auth/authorize/?client_key=${encodeURIComponent(clientId)}&scope=${encodeURIComponent('user.info.basic,video.list')}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`,
    ...formOAuthGrant({
      tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
      authStyle: 'body',
      clientIdParam: 'client_key',
      scopes: ['user.info.basic', 'video.list'],
      mapExtra: (data, tokens) => ({ ...tokens, providerUserId: data.open_id ? String(data.open_id) : null })
    }),
    resolveAccountFromTokens: async (tokens) => {
      const me = await authedJson('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username', {
        token: tokens.accessToken
      });
      if (me.ok === false) return me;
      // TikTok wraps failures in an HTTP-200 error envelope — an errored
      // profile must fail the link, never fall back to a placeholder account
      if (me.data?.error?.code && me.data.error.code !== 'ok') {
        return fail(502, `TikTok: ${boundedText(me.data.error.message || me.data.error.code, 150)}`);
      }
      const user = me.data?.data?.user;
      const id = user?.union_id || user?.open_id;
      if (!id) return fail(502, 'TikTok did not return a profile');
      return {
        ok: true,
        account: {
          providerAccountId: String(id),
          displayName: boundedText(user?.display_name, 120) || 'TikTok account',
          handle: user?.username ? `@${user.username}` : String(id).slice(0, 20),
          avatarUrl: httpsImage(user?.avatar_url),
          profileUrl: user?.username ? `https://www.tiktok.com/@${user.username}` : null,
          config: {}
        }
      };
    }
  },
  fetchFeed: async (_account, opts) => {
    if (!opts.tokens?.accessToken) return fail(401, 'TikTok needs a reconnect — its saved sign-in is missing or expired');
    const items: ExternalFeedItem[] = [];
    let cursor: number | undefined;
    for (let page = 0; page < pageCount(opts); page += 1) {
      const fetched = await authedJson(
        'https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,create_time,cover_image_url,share_url,like_count,comment_count,share_count,view_count',
        { token: opts.tokens.accessToken, method: 'POST', body: { max_count: 20, ...(cursor ? { cursor } : {}) } }
      );
      if (fetched.ok === false) return items.length ? { ok: true, items } : fetched;
      if (fetched.data?.error?.code && fetched.data.error.code !== 'ok') {
        return items.length ? { ok: true, items } : fail(502, `TikTok: ${boundedText(fetched.data.error.message || fetched.data.error.code, 150)}`);
      }
      for (const video of fetched.data?.data?.videos || []) {
        if (!video?.id) continue;
        items.push({
          externalId: `tt-${video.id}`,
          url: typeof video.share_url === 'string' ? video.share_url.slice(0, 1500) : null,
          title: boundedText(video.title, MAX_TITLE_CHARS) || null,
          text: boundedText(video.video_description || '', MAX_TEXT_CHARS),
          images: boundedImages([video.cover_image_url]),
          author: { name: null, handle: null, avatarUrl: null, url: null },
          publishedAt: typeof video.create_time === 'number' ? new Date(video.create_time * 1000) : null,
          stats: { likes: video.like_count, comments: video.comment_count, shares: video.share_count }
        });
      }
      if (!fetched.data?.data?.has_more || items.length >= targetCount(opts)) break;
      cursor = Number(fetched.data?.data?.cursor) || undefined;
      if (!cursor) break;
    }
    return { ok: true, items };
  }
};

const youtubeAccountProvider: ConnectionProvider = {
  id: 'youtube-account',
  name: 'YouTube account',
  icon: '▶️',
  auth: 'oauth2',
  contentVisibility: 'personal',
  // both YouTube providers share one post namespace + the Atom externalId
  // grammar (yt:video:<id>) so the same upload reached through a virtual
  // channel list AND a real subscription stays ONE post with unified comments
  postNamespace: 'youtube',
  about: 'Sign in with Google to link your real YouTube account and sync the latest uploads from your actual subscriptions.',
  configured: () => !!envValue('GOOGLE_CLIENT_ID') && !!envValue('GOOGLE_CLIENT_SECRET'),
  fields: [],
  oauth: {
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    buildAuthorizeUrl: ({ clientId, redirectUri, state }) =>
      `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('openid profile https://www.googleapis.com/auth/youtube.readonly')}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`,
    ...formOAuthGrant({
      tokenUrl: 'https://oauth2.googleapis.com/token',
      authStyle: 'body',
      scopes: ['openid', 'profile', 'https://www.googleapis.com/auth/youtube.readonly']
    }),
    resolveAccountFromTokens: async (tokens) => {
      const me = await authedJson('https://openidconnect.googleapis.com/v1/userinfo', { token: tokens.accessToken });
      if (me.ok === false) return me;
      if (!me.data?.sub) return fail(502, 'Google did not return a profile');
      return {
        ok: true,
        account: {
          providerAccountId: String(me.data.sub),
          displayName: boundedText(me.data.name, 120) || 'YouTube account',
          handle: boundedText(me.data.name, 120) || 'YouTube account',
          avatarUrl: httpsImage(me.data.picture),
          profileUrl: null,
          config: {}
        }
      };
    },
  },
  fetchFeed: async (_account, opts) => {
    if (!opts.tokens?.accessToken) return fail(401, 'YouTube needs a reconnect — its saved sign-in is missing or expired');
    const token = opts.tokens.accessToken;
    // 1) real subscriptions, YouTube's own relevance order (1 quota unit)
    const subs = await authedJson(`${YT_API}/subscriptions?part=snippet&mine=true&maxResults=50`, { token });
    if (subs.ok === false) return subs;
    const channelIds: string[] = (subs.data?.items || [])
      .map((item: any) => item?.snippet?.resourceId?.channelId)
      .filter((id: unknown): id is string => typeof id === 'string')
      .slice(0, 12 * Math.min(pageCount(opts), 3));
    if (!channelIds.length) return { ok: true, items: [] };
    // 2) uploads playlists for ALL channels in one call (1 unit)
    const details = await authedJson(`${YT_API}/channels?part=snippet,contentDetails&id=${channelIds.join(',')}&maxResults=50`, { token });
    if (details.ok === false) return details;
    const channels = (details.data?.items || [])
      .map((item: any) => ({
        id: String(item?.id || ''),
        title: boundedText(item?.snippet?.title, 120),
        thumbnail: httpsImage(item?.snippet?.thumbnails?.default?.url),
        uploads: item?.contentDetails?.relatedPlaylists?.uploads
      }))
      .filter((channel: any) => typeof channel.uploads === 'string');
    // 3) latest uploads per channel (1 unit each), merged newest-first
    const perChannel = Math.max(3, Math.min(10, 5 * pageCount(opts)));
    const lists = await Promise.all(
      channels.map((channel: any) =>
        authedJson(`${YT_API}/playlistItems?part=snippet,contentDetails&playlistId=${channel.uploads}&maxResults=${perChannel}`, { token }).then(
          (result) => ({ channel, result })
        )
      )
    );
    const items: ExternalFeedItem[] = [];
    for (const { channel, result } of lists) {
      if (result.ok === false) continue;
      for (const entry of result.data?.items || []) {
        const videoId = entry?.contentDetails?.videoId;
        if (typeof videoId !== 'string') continue;
        items.push({
          // Atom-id grammar, matching the virtual provider's RSS externalIds
          externalId: `yt:video:${videoId}`,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          title: boundedText(entry?.snippet?.title, MAX_TITLE_CHARS) || null,
          text: boundedText(entry?.snippet?.description || '', 500),
          images: boundedImages([entry?.snippet?.thumbnails?.high?.url || entry?.snippet?.thumbnails?.default?.url]),
          author: { name: channel.title || null, handle: channel.title || null, avatarUrl: channel.thumbnail, url: `https://www.youtube.com/channel/${channel.id}` },
          publishedAt: dateOrNull(entry?.contentDetails?.videoPublishedAt || entry?.snippet?.publishedAt),
          stats: null
        });
      }
    }
    items.sort((a, b) => (b.publishedAt?.getTime() || 0) - (a.publishedAt?.getTime() || 0));
    return { ok: true, items: items.slice(0, targetCount(opts)) };
  }
};

// --- real home timelines -----------------------------------------------------
// The platforms whose official APIs DO expose the user's actual algorithmic
// home feed: Reddit's front page, Mastodon's home timeline, Bluesky's
// following timeline. These deliver the full "your algorithm inside
// Thingtime" experience end to end.

const redditAccountProvider: ConnectionProvider = {
  id: 'reddit-account',
  name: 'Reddit account',
  icon: '🎯',
  auth: 'oauth2',
  contentVisibility: 'personal',
  postNamespace: 'reddit',
  about: 'Sign in with Reddit to sync your REAL personalized front page (the best-of feed your subscriptions and activity shape).',
  configured: () => !!envValue('REDDIT_CLIENT_ID') && !!envValue('REDDIT_CLIENT_SECRET'),
  fields: [],
  oauth: {
    clientIdEnv: 'REDDIT_CLIENT_ID',
    clientSecretEnv: 'REDDIT_CLIENT_SECRET',
    buildAuthorizeUrl: ({ clientId, redirectUri, state }) =>
      `https://www.reddit.com/api/v1/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}&duration=permanent&scope=${encodeURIComponent('identity read')}`,
    ...formOAuthGrant({ tokenUrl: 'https://www.reddit.com/api/v1/access_token', authStyle: 'basic', scopes: ['identity', 'read'] }),
    resolveAccountFromTokens: async (tokens) => {
      const me = await authedJson('https://oauth.reddit.com/api/v1/me', { token: tokens.accessToken });
      if (me.ok === false) return me;
      if (!me.data?.name) return fail(502, 'Reddit did not return a profile');
      const avatar = typeof me.data.icon_img === 'string' ? me.data.icon_img.split('?')[0] : null;
      return {
        ok: true,
        account: {
          providerAccountId: String(me.data.id || me.data.name),
          displayName: `u/${me.data.name}`,
          handle: `u/${me.data.name}`,
          avatarUrl: httpsImage(avatar),
          profileUrl: `https://www.reddit.com/user/${me.data.name}`,
          config: {}
        }
      };
    },
  },
  fetchFeed: async (_account, opts) => {
    if (!opts.tokens?.accessToken) return fail(401, 'Reddit needs a reconnect — its saved sign-in is missing or expired');
    const items: ExternalFeedItem[] = [];
    let after: string | null = null;
    for (let page = 0; page < pageCount(opts); page += 1) {
      const fetched = await authedJson(`https://oauth.reddit.com/best?limit=25&raw_json=1${after ? `&after=${encodeURIComponent(after)}` : ''}`, {
        token: opts.tokens.accessToken
      });
      if (fetched.ok === false) return items.length ? { ok: true, items } : fetched;
      for (const child of fetched.data?.data?.children || []) {
        const post = child?.data;
        if (!post?.name || post.stickied) continue;
        const preview = post.preview?.images?.[0]?.source?.url;
        items.push({
          externalId: String(post.name),
          url: post.permalink ? `https://www.reddit.com${post.permalink}` : null,
          title: boundedText(post.title, MAX_TITLE_CHARS) || null,
          text: boundedText(post.selftext || '', MAX_TEXT_CHARS),
          images: boundedImages([preview, post.thumbnail]),
          author: {
            name: typeof post.author === 'string' ? post.author : null,
            handle: post.subreddit ? `r/${post.subreddit}` : null,
            avatarUrl: null,
            url: typeof post.author === 'string' ? `https://www.reddit.com/user/${post.author}` : null
          },
          publishedAt: typeof post.created_utc === 'number' ? new Date(post.created_utc * 1000) : null,
          stats: { score: post.score, comments: post.num_comments }
        });
        if (items.length >= targetCount(opts)) break;
      }
      after = typeof fetched.data?.data?.after === 'string' ? fetched.data.data.after : null;
      if (!after || items.length >= targetCount(opts)) break;
    }
    return { ok: true, items };
  }
};

const mastodonInstance = (): string => envValue('MASTODON_INSTANCE').replace(/^https?:\/\//, '').replace(/\/.*$/, '');

const mastodonAccountProvider: ConnectionProvider = {
  id: 'mastodon-account',
  name: 'Mastodon account',
  icon: '🐘',
  auth: 'oauth2',
  contentVisibility: 'personal',
  postNamespace: 'mastodon',
  about: 'Sign in on your Mastodon instance to sync your REAL home timeline (the accounts you follow).',
  // the deployment registers one app on ONE instance (MASTODON_INSTANCE) —
  // users of that instance sign in there
  configured: () => !!mastodonInstance() && !!envValue('MASTODON_CLIENT_ID') && !!envValue('MASTODON_CLIENT_SECRET'),
  fields: [],
  oauth: {
    clientIdEnv: 'MASTODON_CLIENT_ID',
    clientSecretEnv: 'MASTODON_CLIENT_SECRET',
    buildAuthorizeUrl: ({ clientId, redirectUri, state }) =>
      `https://${mastodonInstance()}/oauth/authorize?client_id=${encodeURIComponent(clientId)}&scope=read&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${encodeURIComponent(state)}`,
    exchangeCode: async ({ code, clientId, clientSecret, redirectUri }) => {
      const exchanged = await postForm(`https://${mastodonInstance()}/oauth/token`, {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code,
        scope: 'read'
      });
      if (exchanged.ok === false) return exchanged;
      if (!exchanged.data?.access_token) return fail(502, 'The Mastodon instance did not return an access token');
      // Mastodon tokens do not expire; no refresh grant exists
      return { ok: true, tokens: { accessToken: String(exchanged.data.access_token), expiresAt: null, scopes: ['read'] } };
    },
    resolveAccountFromTokens: async (tokens) => {
      const instance = mastodonInstance();
      const me = await authedJson(`https://${instance}/api/v1/accounts/verify_credentials`, { token: tokens.accessToken });
      if (me.ok === false) return me;
      if (!me.data?.id) return fail(502, 'The Mastodon instance did not return a profile');
      return {
        ok: true,
        account: {
          providerAccountId: `${instance}:id:${me.data.id}`,
          displayName: boundedText(me.data.display_name, 120) || `@${me.data.acct}`,
          handle: `@${me.data.acct}@${instance}`,
          avatarUrl: httpsImage(me.data.avatar),
          // Same remote-input rule as the instance-lookup branch above.
          profileUrl: webLink(me.data.url) || `https://${instance}/@${me.data.acct}`,
          config: { instance }
        }
      };
    }
  },
  fetchFeed: async (account, opts) => {
    if (!opts.tokens?.accessToken) return fail(401, 'Mastodon needs a reconnect — its saved sign-in is missing or expired');
    const instance = account.config.instance || mastodonInstance();
    const items: ExternalFeedItem[] = [];
    let maxId: string | null = null;
    for (let page = 0; page < pageCount(opts); page += 1) {
      const fetched = await authedJson(`https://${instance}/api/v1/timelines/home?limit=40${maxId ? `&max_id=${encodeURIComponent(maxId)}` : ''}`, {
        token: opts.tokens.accessToken
      });
      if (fetched.ok === false) return items.length ? { ok: true, items } : fetched;
      const statuses = Array.isArray(fetched.data) ? fetched.data : [];
      if (!statuses.length) break;
      for (const status of statuses) {
        const item = mapMastodonStatus(status, instance);
        if (item) items.push(item);
        if (items.length >= targetCount(opts)) break;
      }
      maxId = statuses[statuses.length - 1]?.id ? String(statuses[statuses.length - 1].id) : null;
      if (!maxId || items.length >= targetCount(opts)) break;
    }
    return { ok: true, items };
  }
};

const BSKY_PDS = 'https://bsky.social';

const blueskyAccountProvider: ConnectionProvider = {
  id: 'bluesky-account',
  name: 'Bluesky account',
  icon: '💠',
  auth: 'credential',
  contentVisibility: 'personal',
  postNamespace: 'bluesky',
  about: 'Connect with a Bluesky app password to sync your REAL following timeline. The app password is exchanged for a session and never stored.',
  // app passwords need no developer registration — works on any deployment
  configured: () => true,
  fields: [
    { key: 'handle', label: 'Handle', placeholder: 'you.bsky.social', required: true },
    {
      key: 'appPassword',
      label: 'App password',
      placeholder: 'xxxx-xxxx-xxxx-xxxx',
      help: 'Create one at bsky.app → Settings → Privacy and security → App passwords. Exchanged for a session, never stored.',
      required: true,
      secret: true
    }
  ],
  resolveAccount: async (fields) => {
    const handle = (fields.handle || '').trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9.-]{2,200}$/.test(handle)) return fail(400, 'handle must be a Bluesky handle like name.bsky.social');
    const session = await authedJson(`${BSKY_PDS}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      body: { identifier: handle, password: fields.appPassword || '' }
    });
    if (session.ok === false) {
      return session.status === 401 ? fail(401, 'Bluesky rejected that handle/app password pair') : session;
    }
    if (!session.data?.did || !session.data?.accessJwt) return fail(502, 'Bluesky did not return a session');
    const profile = await authedJson(`${BSKY_PDS}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(session.data.did)}`, {
      token: String(session.data.accessJwt)
    });
    return {
      ok: true,
      account: {
        providerAccountId: String(session.data.did),
        displayName: (profile.ok !== false && boundedText(profile.data?.displayName, 120)) || `@${session.data.handle || handle}`,
        handle: `@${session.data.handle || handle}`,
        avatarUrl: profile.ok !== false ? httpsImage(profile.data?.avatar) : null,
        profileUrl: `https://bsky.app/profile/${session.data.handle || handle}`,
        config: { handle: String(session.data.handle || handle) },
        tokens: {
          accessToken: String(session.data.accessJwt),
          refreshToken: session.data.refreshJwt ? String(session.data.refreshJwt) : null,
          // access JWTs last ~2h; stamp conservatively so refresh engages
          expiresAt: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
          scopes: ['timeline']
        }
      }
    };
  },
  // AT proto refresh: the REFRESH JWT authenticates the call and rotates
  refreshTokens: async (tokens) => {
    if (!tokens.refreshToken) return null;
    const refreshed = await authedJson(`${BSKY_PDS}/xrpc/com.atproto.server.refreshSession`, {
      method: 'POST',
      token: tokens.refreshToken
    });
    if (refreshed.ok === false || !refreshed.data?.accessJwt) return null;
    return {
      ...tokens,
      accessToken: String(refreshed.data.accessJwt),
      refreshToken: refreshed.data.refreshJwt ? String(refreshed.data.refreshJwt) : tokens.refreshToken,
      expiresAt: new Date(Date.now() + 90 * 60 * 1000).toISOString()
    };
  },
  fetchFeed: async (_account, opts) => {
    if (!opts.tokens?.accessToken) return fail(401, 'Bluesky needs a reconnect — its saved session is missing or expired');
    const items: ExternalFeedItem[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < pageCount(opts); page += 1) {
      const fetched = await authedJson(`${BSKY_PDS}/xrpc/app.bsky.feed.getTimeline?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, {
        token: opts.tokens.accessToken
      });
      if (fetched.ok === false) return items.length ? { ok: true, items } : fetched;
      for (const entry of fetched.data?.feed || []) {
        const item = mapBlueskyFeedEntry(entry);
        if (item) items.push(item);
        if (items.length >= targetCount(opts)) break;
      }
      cursor = typeof fetched.data?.cursor === 'string' ? fetched.data.cursor : null;
      if (!cursor || items.length >= targetCount(opts)) break;
    }
    return { ok: true, items };
  }
};

// --- remaining SSO scaffolds --------------------------------------------------
// Config-gated like the rest; each `about` states honestly what the official
// API exposes (X home timeline needs a paid API tier; Pinterest exposes your
// pins, not the home feed; LinkedIn exposes identity only to standard apps).

const twitchProvider: ConnectionProvider = {
  id: 'twitch',
  name: 'Twitch',
  icon: '🎮',
  auth: 'oauth2',
  contentVisibility: 'personal',
  about: 'Sign in with Twitch to sync the channels you follow that are LIVE right now.',
  configured: () => !!envValue('TWITCH_CLIENT_ID') && !!envValue('TWITCH_CLIENT_SECRET'),
  fields: [],
  oauth: {
    clientIdEnv: 'TWITCH_CLIENT_ID',
    clientSecretEnv: 'TWITCH_CLIENT_SECRET',
    buildAuthorizeUrl: ({ clientId, redirectUri, state }) =>
      `https://id.twitch.tv/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('user:read:follows')}&state=${encodeURIComponent(state)}`,
    ...formOAuthGrant({ tokenUrl: 'https://id.twitch.tv/oauth2/token', authStyle: 'body', scopes: ['user:read:follows'] }),
    resolveAccountFromTokens: async (tokens) => {
      const me = await authedJson('https://api.twitch.tv/helix/users', {
        token: tokens.accessToken,
        headers: { 'Client-Id': envValue('TWITCH_CLIENT_ID') }
      });
      if (me.ok === false) return me;
      const user = me.data?.data?.[0];
      if (!user?.id) return fail(502, 'Twitch did not return a profile');
      return {
        ok: true,
        account: {
          providerAccountId: String(user.id),
          displayName: boundedText(user.display_name, 120) || user.login,
          handle: `@${user.login}`,
          avatarUrl: httpsImage(user.profile_image_url),
          profileUrl: `https://www.twitch.tv/${user.login}`,
          config: { userId: String(user.id) }
        }
      };
    },
  },
  fetchFeed: async (account, opts) => {
    if (!opts.tokens?.accessToken) return fail(401, 'Twitch needs a reconnect — its saved sign-in is missing or expired');
    const fetched = await authedJson(
      `https://api.twitch.tv/helix/streams/followed?user_id=${encodeURIComponent(account.config.userId || '')}&first=${Math.min(targetCount(opts), 100)}`,
      { token: opts.tokens.accessToken, headers: { 'Client-Id': envValue('TWITCH_CLIENT_ID') } }
    );
    if (fetched.ok === false) return fetched;
    const items: ExternalFeedItem[] = [];
    for (const stream of fetched.data?.data || []) {
      if (!stream?.id) continue;
      const thumb = typeof stream.thumbnail_url === 'string' ? stream.thumbnail_url.replace('{width}', '640').replace('{height}', '360') : null;
      items.push({
        externalId: `twitch-live-${stream.user_id}-${stream.id}`,
        url: stream.user_login ? `https://www.twitch.tv/${stream.user_login}` : null,
        title: boundedText(stream.title, MAX_TITLE_CHARS) || null,
        text: `🔴 LIVE${stream.game_name ? ` — ${boundedText(stream.game_name, 120)}` : ''} · ${Number(stream.viewer_count) || 0} viewers`,
        images: boundedImages([thumb]),
        author: {
          name: boundedText(stream.user_name, 120) || null,
          handle: stream.user_login ? `@${stream.user_login}` : null,
          avatarUrl: null,
          url: stream.user_login ? `https://www.twitch.tv/${stream.user_login}` : null
        },
        publishedAt: dateOrNull(stream.started_at),
        stats: { likes: stream.viewer_count }
      });
    }
    return { ok: true, items };
  }
};

const xProvider: ConnectionProvider = {
  id: 'x',
  name: 'X',
  icon: '𝕏',
  auth: 'oauth2',
  contentVisibility: 'personal',
  about: 'Sign in with X to sync your home timeline. (X gates timeline reads behind its paid API tiers — a Basic-tier app key or above is required for the pull to work.)',
  configured: () => !!envValue('X_CLIENT_ID') && !!envValue('X_CLIENT_SECRET'),
  fields: [],
  oauth: {
    clientIdEnv: 'X_CLIENT_ID',
    clientSecretEnv: 'X_CLIENT_SECRET',
    pkce: true,
    buildAuthorizeUrl: ({ clientId, redirectUri, state, codeChallenge }) =>
      `https://x.com/i/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('tweet.read users.read offline.access')}&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(codeChallenge || '')}&code_challenge_method=S256`,
    ...formOAuthGrant({
      tokenUrl: 'https://api.x.com/2/oauth2/token',
      authStyle: 'basic',
      scopes: ['tweet.read', 'users.read', 'offline.access'],
      extraExchangeParams: ({ codeVerifier }) => ({ code_verifier: codeVerifier || '' })
    }),
    resolveAccountFromTokens: async (tokens) => {
      const me = await authedJson('https://api.x.com/2/users/me?user.fields=profile_image_url,name,username', { token: tokens.accessToken });
      if (me.ok === false) return me;
      const user = me.data?.data;
      if (!user?.id) return fail(502, 'X did not return a profile');
      return {
        ok: true,
        account: {
          providerAccountId: String(user.id),
          displayName: boundedText(user.name, 120) || `@${user.username}`,
          handle: `@${user.username}`,
          avatarUrl: httpsImage(user.profile_image_url),
          profileUrl: `https://x.com/${user.username}`,
          config: { userId: String(user.id) }
        }
      };
    },
  },
  fetchFeed: async (account, opts) => {
    if (!opts.tokens?.accessToken) return fail(401, 'X needs a reconnect — its saved sign-in is missing or expired');
    const items: ExternalFeedItem[] = [];
    let paginationToken: string | null = null;
    for (let page = 0; page < pageCount(opts); page += 1) {
      const fetched = await authedJson(
        `https://api.x.com/2/users/${encodeURIComponent(account.config.userId || '')}/timelines/reverse_chronological?max_results=50&tweet.fields=created_at,public_metrics&expansions=author_id&user.fields=name,username,profile_image_url${paginationToken ? `&pagination_token=${encodeURIComponent(paginationToken)}` : ''}`,
        { token: opts.tokens.accessToken }
      );
      if (fetched.ok === false) return items.length ? { ok: true, items } : fetched;
      const users = new Map<string, any>((fetched.data?.includes?.users || []).map((user: any) => [String(user.id), user]));
      for (const tweet of fetched.data?.data || []) {
        if (!tweet?.id) continue;
        const author = users.get(String(tweet.author_id));
        items.push({
          externalId: `x-${tweet.id}`,
          url: author?.username ? `https://x.com/${author.username}/status/${tweet.id}` : null,
          title: null,
          text: boundedText(tweet.text || '', MAX_TEXT_CHARS),
          images: [],
          author: {
            name: boundedText(author?.name, 120) || null,
            handle: author?.username ? `@${author.username}` : null,
            avatarUrl: httpsImage(author?.profile_image_url),
            url: author?.username ? `https://x.com/${author.username}` : null
          },
          publishedAt: dateOrNull(tweet.created_at),
          stats: {
            likes: tweet.public_metrics?.like_count,
            comments: tweet.public_metrics?.reply_count,
            shares: tweet.public_metrics?.retweet_count
          }
        });
        if (items.length >= targetCount(opts)) break;
      }
      paginationToken = typeof fetched.data?.meta?.next_token === 'string' ? fetched.data.meta.next_token : null;
      if (!paginationToken || items.length >= targetCount(opts)) break;
    }
    return { ok: true, items };
  }
};

const tumblrProvider: ConnectionProvider = {
  id: 'tumblr',
  name: 'Tumblr',
  icon: '🌀',
  auth: 'oauth2',
  contentVisibility: 'personal',
  about: 'Sign in with Tumblr to sync your REAL dashboard (the blogs you follow).',
  configured: () => !!envValue('TUMBLR_CLIENT_ID') && !!envValue('TUMBLR_CLIENT_SECRET'),
  fields: [],
  oauth: {
    clientIdEnv: 'TUMBLR_CLIENT_ID',
    clientSecretEnv: 'TUMBLR_CLIENT_SECRET',
    buildAuthorizeUrl: ({ clientId, redirectUri, state }) =>
      `https://www.tumblr.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&scope=${encodeURIComponent('basic offline_access')}&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    ...formOAuthGrant({ tokenUrl: 'https://api.tumblr.com/v2/oauth2/token', authStyle: 'body', scopes: ['basic', 'offline_access'] }),
    resolveAccountFromTokens: async (tokens) => {
      const me = await authedJson('https://api.tumblr.com/v2/user/info', { token: tokens.accessToken });
      if (me.ok === false) return me;
      const user = me.data?.response?.user;
      if (!user?.name) return fail(502, 'Tumblr did not return a profile');
      return {
        ok: true,
        account: {
          providerAccountId: String(user.name),
          displayName: boundedText(user.name, 120),
          handle: `@${user.name}`,
          avatarUrl: null,
          profileUrl: `https://www.tumblr.com/${user.name}`,
          config: {}
        }
      };
    },
  },
  fetchFeed: async (_account, opts) => {
    if (!opts.tokens?.accessToken) return fail(401, 'Tumblr needs a reconnect — its saved sign-in is missing or expired');
    const items: ExternalFeedItem[] = [];
    let offset = 0;
    for (let page = 0; page < pageCount(opts); page += 1) {
      const fetched = await authedJson(`https://api.tumblr.com/v2/user/dashboard?limit=20${offset ? `&offset=${offset}` : ''}`, {
        token: opts.tokens.accessToken
      });
      if (fetched.ok === false) return items.length ? { ok: true, items } : fetched;
      const posts = fetched.data?.response?.posts || [];
      if (!posts.length) break;
      for (const post of posts) {
        if (!post?.id_string && !post?.id) continue;
        const photos = (post.photos || []).map((photo: any) => photo?.original_size?.url);
        items.push({
          externalId: `tumblr-${post.id_string || post.id}`,
          url: typeof post.post_url === 'string' ? post.post_url.slice(0, 1500) : null,
          title: boundedText(post.title, MAX_TITLE_CHARS) || null,
          text: boundedText(post.summary || post.body || post.caption || '', MAX_TEXT_CHARS),
          images: boundedImages(photos),
          author: {
            name: boundedText(post.blog_name, 120) || null,
            handle: post.blog_name ? `@${post.blog_name}` : null,
            avatarUrl: null,
            url: post.blog_name ? `https://www.tumblr.com/${post.blog_name}` : null
          },
          publishedAt: typeof post.timestamp === 'number' ? new Date(post.timestamp * 1000) : null,
          stats: { likes: post.note_count }
        });
        if (items.length >= targetCount(opts)) break;
      }
      offset += posts.length;
      if (items.length >= targetCount(opts)) break;
    }
    return { ok: true, items };
  }
};

const pinterestProvider: ConnectionProvider = {
  id: 'pinterest',
  name: 'Pinterest',
  icon: '📌',
  auth: 'oauth2',
  contentVisibility: 'personal',
  about: 'Sign in with Pinterest to sync your own pins. (Pinterest’s API exposes your pins and boards — not the home feed.)',
  configured: () => !!envValue('PINTEREST_CLIENT_ID') && !!envValue('PINTEREST_CLIENT_SECRET'),
  fields: [],
  oauth: {
    clientIdEnv: 'PINTEREST_CLIENT_ID',
    clientSecretEnv: 'PINTEREST_CLIENT_SECRET',
    buildAuthorizeUrl: ({ clientId, redirectUri, state }) =>
      `https://www.pinterest.com/oauth/?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('user_accounts:read,pins:read,boards:read')}&state=${encodeURIComponent(state)}`,
    ...formOAuthGrant({ tokenUrl: 'https://api.pinterest.com/v5/oauth/token', authStyle: 'basic', scopes: ['pins:read'] }),
    resolveAccountFromTokens: async (tokens) => {
      const me = await authedJson('https://api.pinterest.com/v5/user_account', { token: tokens.accessToken });
      if (me.ok === false) return me;
      if (!me.data?.username) return fail(502, 'Pinterest did not return a profile');
      return {
        ok: true,
        account: {
          providerAccountId: String(me.data.id || me.data.username),
          displayName: boundedText(me.data.username, 120),
          handle: `@${me.data.username}`,
          avatarUrl: httpsImage(me.data.profile_image),
          profileUrl: `https://www.pinterest.com/${me.data.username}/`,
          config: {}
        }
      };
    },
  },
  fetchFeed: async (_account, opts) => {
    if (!opts.tokens?.accessToken) return fail(401, 'Pinterest needs a reconnect — its saved sign-in is missing or expired');
    const items: ExternalFeedItem[] = [];
    let bookmark: string | null = null;
    for (let page = 0; page < pageCount(opts); page += 1) {
      const fetched = await authedJson(`https://api.pinterest.com/v5/pins?page_size=25${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ''}`, {
        token: opts.tokens.accessToken
      });
      if (fetched.ok === false) return items.length ? { ok: true, items } : fetched;
      for (const pin of fetched.data?.items || []) {
        if (!pin?.id) continue;
        const image = pin.media?.images?.['600x']?.url || pin.media?.images?.originals?.url;
        items.push({
          externalId: `pin-${pin.id}`,
          url: `https://www.pinterest.com/pin/${pin.id}/`,
          title: boundedText(pin.title, MAX_TITLE_CHARS) || null,
          text: boundedText(pin.description || '', MAX_TEXT_CHARS),
          images: boundedImages([image]),
          author: { name: null, handle: null, avatarUrl: null, url: null },
          publishedAt: dateOrNull(pin.created_at),
          stats: null
        });
        if (items.length >= targetCount(opts)) break;
      }
      bookmark = typeof fetched.data?.bookmark === 'string' ? fetched.data.bookmark : null;
      if (!bookmark || items.length >= targetCount(opts)) break;
    }
    return { ok: true, items };
  }
};

const linkedinProvider: ConnectionProvider = {
  id: 'linkedin',
  name: 'LinkedIn',
  icon: '💼',
  auth: 'oauth2',
  contentVisibility: 'personal',
  about: 'Sign in with LinkedIn to link your account. (LinkedIn does not expose feed content to standard API apps — account linking only for now.)',
  configured: () => !!envValue('LINKEDIN_CLIENT_ID') && !!envValue('LINKEDIN_CLIENT_SECRET'),
  fields: [],
  oauth: {
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
    clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
    buildAuthorizeUrl: ({ clientId, redirectUri, state }) =>
      `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&scope=${encodeURIComponent('openid profile')}`,
    exchangeCode: async ({ code, clientId, clientSecret, redirectUri }) => {
      const exchanged = await postForm('https://www.linkedin.com/oauth/v2/accessToken', {
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri
      });
      if (exchanged.ok === false) return exchanged;
      if (!exchanged.data?.access_token) return fail(502, 'LinkedIn did not return an access token');
      return {
        ok: true,
        tokens: { accessToken: String(exchanged.data.access_token), expiresAt: expiresAtFrom(exchanged.data.expires_in), scopes: ['openid', 'profile'] }
      };
    },
    resolveAccountFromTokens: async (tokens) => {
      const me = await authedJson('https://api.linkedin.com/v2/userinfo', { token: tokens.accessToken });
      if (me.ok === false) return me;
      if (!me.data?.sub) return fail(502, 'LinkedIn did not return a profile');
      return {
        ok: true,
        account: {
          providerAccountId: String(me.data.sub),
          displayName: boundedText(me.data.name, 120) || 'LinkedIn account',
          handle: boundedText(me.data.name, 120) || 'LinkedIn account',
          avatarUrl: httpsImage(me.data.picture),
          profileUrl: null,
          config: {}
        }
      };
    }
  },
  // LinkedIn's member-feed APIs are partner-gated; an empty sync is the honest
  // steady state (the about-copy says so) rather than a recurring error
  fetchFeed: async () => ({ ok: true, items: [] })
};

// --- spotify -----------------------------------------------------------------

const spotifyProvider: ConnectionProvider = {
  id: 'spotify',
  name: 'Spotify',
  icon: '🎧',
  auth: 'oauth2',
  contentVisibility: 'personal',
  about: 'Sign in with Spotify to sync your recently played tracks and new releases from artists you follow.',
  configured: () => !!envValue('SPOTIFY_CLIENT_ID') && !!envValue('SPOTIFY_CLIENT_SECRET'),
  fields: [],
  oauth: {
    clientIdEnv: 'SPOTIFY_CLIENT_ID',
    clientSecretEnv: 'SPOTIFY_CLIENT_SECRET',
    buildAuthorizeUrl: ({ clientId, redirectUri, state }) =>
      `https://accounts.spotify.com/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&scope=${encodeURIComponent('user-read-recently-played user-follow-read')}`,
    ...formOAuthGrant({
      tokenUrl: 'https://accounts.spotify.com/api/token',
      authStyle: 'basic',
      scopes: ['user-read-recently-played', 'user-follow-read']
    }),
    resolveAccountFromTokens: async (tokens) => {
      const me = await authedJson('https://api.spotify.com/v1/me', { token: tokens.accessToken });
      if (me.ok === false) return me;
      if (!me.data?.id) return fail(502, 'Spotify did not return a profile');
      return {
        ok: true,
        account: {
          providerAccountId: String(me.data.id),
          displayName: boundedText(me.data.display_name, 120) || String(me.data.id),
          handle: `@${me.data.id}`,
          avatarUrl: httpsImage(me.data.images?.[0]?.url),
          profileUrl: typeof me.data.external_urls?.spotify === 'string' ? me.data.external_urls.spotify.slice(0, 1500) : null,
          config: {}
        }
      };
    }
  },
  fetchFeed: async (_account, opts) => {
    if (!opts.tokens?.accessToken) return fail(401, 'Spotify needs a reconnect — its saved sign-in is missing or expired');
    const token = opts.tokens.accessToken;
    const items: ExternalFeedItem[] = [];
    // 1) recently played (the personal listening feed)
    const recent = await authedJson('https://api.spotify.com/v1/me/player/recently-played?limit=50', { token });
    if (recent.ok === false) return recent;
    for (const entry of recent.data?.items || []) {
      const track = entry?.track;
      if (!track?.id) continue;
      const artists = (track.artists || []).map((artist: any) => artist?.name).filter(Boolean).join(', ');
      items.push({
        externalId: `spotify-play-${track.id}-${entry.played_at || ''}`,
        url: typeof track.external_urls?.spotify === 'string' ? track.external_urls.spotify.slice(0, 1500) : null,
        title: boundedText(track.name, MAX_TITLE_CHARS) || null,
        text: `🎧 Played ${boundedText(track.name, 150)}${artists ? ` — ${boundedText(artists, 200)}` : ''}${track.album?.name ? ` (${boundedText(track.album.name, 120)})` : ''}`,
        images: boundedImages([track.album?.images?.[0]?.url]),
        author: { name: artists || null, handle: null, avatarUrl: null, url: null },
        publishedAt: dateOrNull(entry.played_at),
        stats: null
      });
    }
    // 2) fresh releases from followed artists (bounded fan-out)
    const followed = await authedJson('https://api.spotify.com/v1/me/following?type=artist&limit=8', { token });
    if (followed.ok !== false) {
      const artists = (followed.data?.artists?.items || []).slice(0, 8);
      const releases = await Promise.all(
        artists.map((artist: any) =>
          authedJson(`https://api.spotify.com/v1/artists/${artist.id}/albums?limit=3&include_groups=album,single`, { token }).then(
            (result) => ({ artist, result })
          )
        )
      );
      for (const { artist, result } of releases) {
        if (result.ok === false) continue;
        for (const album of result.data?.items || []) {
          if (!album?.id) continue;
          items.push({
            externalId: `spotify-release-${album.id}`,
            url: typeof album.external_urls?.spotify === 'string' ? album.external_urls.spotify.slice(0, 1500) : null,
            title: boundedText(album.name, MAX_TITLE_CHARS) || null,
            text: `💿 New ${album.album_type || 'release'} from ${boundedText(artist.name, 120)}: ${boundedText(album.name, 150)}`,
            images: boundedImages([album.images?.[0]?.url]),
            author: {
              name: boundedText(artist.name, 120) || null,
              handle: null,
              avatarUrl: httpsImage(artist.images?.[0]?.url),
              url: typeof artist.external_urls?.spotify === 'string' ? artist.external_urls.spotify.slice(0, 1500) : null
            },
            publishedAt: dateOrNull(album.release_date),
            stats: null
          });
        }
      }
    }
    items.sort((a, b) => (b.publishedAt?.getTime() || 0) - (a.publishedAt?.getTime() || 0));
    return { ok: true, items: items.slice(0, targetCount(opts)) };
  }
};

// --- registry ---------------------------------------------------------------

export const CONNECTION_PROVIDERS: ConnectionProvider[] = [
  redditAccountProvider,
  blueskyAccountProvider,
  mastodonAccountProvider,
  youtubeProvider,
  youtubeAccountProvider,
  facebookProvider,
  instagramProvider,
  tiktokProvider,
  spotifyProvider,
  xProvider,
  twitchProvider,
  tumblrProvider,
  pinterestProvider,
  linkedinProvider,
  redditProvider,
  mastodonProvider,
  blueskyProvider,
  hackerNewsProvider,
  lemmyProvider,
  githubProvider,
  rssProvider,
  demoProvider
];

export const connectionProviderById = (id: unknown): ConnectionProvider | null =>
  typeof id === 'string' ? CONNECTION_PROVIDERS.find((provider) => provider.id === id.trim().toLowerCase()) || null : null;

// The public projection the providers list endpoint returns.
export const publicProviders = () =>
  CONNECTION_PROVIDERS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    icon: provider.icon,
    auth: provider.auth,
    contentVisibility: provider.contentVisibility,
    about: provider.about,
    configured: provider.configured(),
    fields: provider.fields
  }));
