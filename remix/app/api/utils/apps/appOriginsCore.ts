// Pure origin-allowlist logic for embed apps ("Login with Thingtime"), split
// out *Core-style so `node --test` can exercise it without touching Mongo.
//
// An allowlist entry is either an EXACT origin ('https://example.com') or a
// WILDCARD entry with a single `*` in the leftmost host label
// ('https://myapp-*-myteam.vercel.app'). Wildcards exist for preview deploys
// (Vercel, Netlify, …) whose hostnames change per branch.
//
// Wildcard guardrails — this is the auth plane, so entries are structurally
// constrained rather than free-form globs:
//   - https only (never http/localhost — exact entries cover dev).
//   - exactly one `*`, and only in the LEFTMOST host label.
//   - at least two literal labels after the wildcard label.
//   - `*` matches within a single label only (it never crosses a dot).
//   - the Public Suffix List (via tldts, private domains included) decides
//     what the star may touch:
//       · literal suffix = a PUBLIC eTLD (co.uk, com, …) → refused outright;
//         the star would range over registrable domains anyone can buy.
//       · literal suffix = a PRIVATE multi-tenant suffix (vercel.app,
//         netlify.app, github.io, …) → the star label must END with a
//         literal anchor ('*-myteam', 'myapp-*-myteam'): platforms like
//         Vercel append your team/site slug to the tenant label, so a
//         suffix anchor pins the pattern to deployments you own, while a
//         prefix-only 'myapp-*' would match any stranger's 'myapp-evil…'.
//         Caveat (documented): on hosts where the WHOLE tenant label is
//         freely chosen by users (github.io usernames), no anchor is
//         airtight — prefer exact origins there.
//       · anything else → the suffix already contains a registrable domain
//         the developer controls, so any shape including a bare '*.' label
//         is fine (classic subdomain wildcard).

import { getPublicSuffix, parse } from 'tldts';

export const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// Normalize a web origin: http(s), no path/query/hash/credentials, lowercased.
// Plain http is allowed only for localhost so dev sites can test the embed —
// production embeds must be https or tokens would travel in cleartext.
export const normalizeAppOrigin = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(trimmed.toLowerCase());
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.protocol === 'http:' && !LOCAL_HOSTNAMES.has(url.hostname)) return null;
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
  // A literal request origin can never contain `*`; refuse rather than store
  // something the matcher would treat as a pattern.
  if (url.hostname.includes('*')) return null;

  return url.origin;
};

// Normalize ONE allowlist entry: an exact origin, or a wildcard entry obeying
// the guardrails above. Returns the canonical string to store, or null.
export const normalizeAppOriginEntry = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  if (!value.includes('*')) return normalizeAppOrigin(value);

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  if ((trimmed.match(/\*/g) ?? []).length !== 1) return null;

  let url: URL;
  try {
    url = new URL(trimmed.toLowerCase());
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;

  const labels = url.hostname.split('.');
  if (labels.length < 3) return null; // ≥2 literal labels must follow the star
  if (!labels[0].includes('*')) return null; // the star must be in the leftmost label
  if (labels.some((label, i) => i > 0 && (!label || label.includes('*')))) return null;

  // Public Suffix List check on the literal part after the star's label.
  const literalSuffix = labels.slice(1).join('.');
  const suffixInfo = parse(`wildcard-probe.${literalSuffix}`, { allowPrivateDomains: true });
  const publicSuffix = getPublicSuffix(literalSuffix, { allowPrivateDomains: true });
  if (!publicSuffix) return null; // IPs / unparseable hosts never take wildcards

  if (publicSuffix === literalSuffix) {
    // The star label IS the tenant / registrable label on this suffix.
    if (!suffixInfo.isPrivate) return null; // public eTLD: nothing can anchor this safely
    const anchorAfterStar = labels[0].slice(labels[0].indexOf('*') + 1);
    if (!anchorAfterStar) return null; // multi-tenant host: require a trailing anchor
  }

  return url.origin;
};

const REGEX_SPECIALS = /[.+?^${}()|[\]\\]/g;

// One entry ('exact' or wildcard) → does it cover this normalized origin?
// Every segment around the star is regex-escaped and every `*` expands to
// [^.]* so it can never cross a label boundary; validation stores exactly one
// star, and anything else (legacy or tampered data) is refused outright.
const entryCovers = (entry: string, normalizedOrigin: string): boolean => {
  const segments = entry.split('*');
  if (segments.length === 1) return entry === normalizedOrigin;
  if (segments.length !== 2) return false;
  const pattern = segments.map((segment) => segment.replace(REGEX_SPECIALS, (ch) => `\\${ch}`)).join('[^.]*');
  return new RegExp(`^${pattern}$`).test(normalizedOrigin);
};

// The allowlist check used everywhere an app origin is verified (authorize
// popup, token resolution, public app lookup).
export const originAllowedBy = (allowlist: unknown, origin: string): boolean => {
  if (!Array.isArray(allowlist)) return false;
  const normalized = normalizeAppOrigin(origin);
  if (!normalized) return false;
  return allowlist.some((entry) => typeof entry === 'string' && entryCovers(entry, normalized));
};
