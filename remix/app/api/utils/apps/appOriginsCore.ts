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
//   - at least two literal labels after the wildcard label, so a `*` can
//     never stand in for a registrable domain or TLD.
//   - `*` matches within a single label only (it never crosses a dot).
//   - a bare `*` label is refused on well-known shared-hosting suffixes
//     (https://*.vercel.app would allowlist every Vercel site on earth).
//     This denylist is defense-in-depth, not a complete public-suffix list:
//     on shared hosts, anchor BOTH sides of the star with something only you
//     control — for Vercel that's your project prefix and team-slug suffix,
//     e.g. https://myapp-*-myteam.vercel.app.

export const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// Suffixes where a bare `*.suffix` wildcard would allowlist arbitrary
// strangers' deployments. Anchored wildcards (literal chars in the star's
// label) are still allowed on these — document the both-sides anchor pattern.
export const SHARED_WILDCARD_SUFFIXES = new Set([
  'vercel.app',
  'netlify.app',
  'pages.dev',
  'workers.dev',
  'github.io',
  'gitlab.io',
  'web.app',
  'firebaseapp.com',
  'herokuapp.com',
  'onrender.com',
  'fly.dev',
  'azurewebsites.net',
  'cloudfront.net',
  'amplifyapp.com',
  'glitch.me',
  'repl.co',
  'surge.sh'
]);

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
  if (labels[0] === '*' && SHARED_WILDCARD_SUFFIXES.has(labels.slice(1).join('.'))) return null;

  return url.origin;
};

const REGEX_SPECIALS = /[.+?^${}()|[\]\\]/g;

// One entry ('exact' or wildcard) → does it cover this normalized origin?
// `*` expands to [^.]* so it can never cross a label boundary; scheme and
// any explicit port must match exactly (both sides are URL-normalized).
const entryCovers = (entry: string, normalizedOrigin: string): boolean => {
  if (!entry.includes('*')) return entry === normalizedOrigin;
  const pattern = entry.replace(REGEX_SPECIALS, (ch) => `\\${ch}`).replace('*', '[^.]*');
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
