// Shared client shapes + styling for the two Connections surfaces
// (/connections and /connections/feed) — one mirror of the server's
// PublicConnection projection, one card style, so the sibling pages can never
// drift apart.

export type ChannelRef = { id: string; title: string; thumbnail: string | null };

export type Connection = {
  id: string;
  provider: string;
  providerName: string;
  providerIcon: string;
  contentVisibility: 'public' | 'personal';
  // mirrors PublicConnection.auth in api/utils/connections/connections.ts —
  // 'credential' is the Bluesky-style app-password exchange, and omitting it
  // here would make an honest `auth === 'credential'` branch a TypeScript
  // no-overlap error against a value the server really does send
  auth?: 'none' | 'oauth2' | 'credential';
  account: { id: string; handle: string; displayName: string; avatarUrl: string | null; profileUrl: string | null };
  channels?: ChannelRef[];
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  createdAt?: string | null;
};

export const cardStyle = {
  background: 'var(--tt-card, #ffffff)',
  border: '1px solid var(--tt-border, #ececef)',
  borderRadius: 'var(--tt-radius-lg, 16px)'
} as const;

// --- the /connections OAuth landing ---
//
// Both of these exist because ?connected= and ?oauthError= are READ OFF THE
// URL and rendered in a Lopu toast. Nothing authenticates them: the callback
// route is a GET a stranger can aim a signed-in victim at, and the landing
// params can be typed directly. So whatever the page echoes verbatim is copy
// the attacker wrote, shown in Thingtime's own chrome at a genuine
// thingtime.com address — the exact ingredients of a credible lure ("Session
// expired — reverify at …", "Connection failed, call +1-555-…"). It is not
// XSS; Chakra renders these as text. It is the phishing surface underneath it.
//
// The rule both follow: the page owns the words. The URL may only SELECT them.

const OAUTH_ERROR_GENERIC = 'Could not finish that sign-in 😞';

// Mirrors OAUTH_ERROR_CODES in api/utils/connections/shared.ts, which is the
// contract's source of truth; oauthErrorCopy.test.ts pins the key sets equal so
// a code added there without copy here fails the suite instead of quietly
// degrading every one of its failures to the generic line.
//
// A Map, not a plain object, because the lookup key is a URL parameter: on an
// object literal `?oauthError=__proto__` resolves to Object.prototype, which is
// truthy, so the `||` fallback never fires and a non-string reaches the toast's
// title (React throws on an object child). A Map has no inherited keys, so the
// whole class is unrepresentable rather than guarded against.
export const OAUTH_ERROR_COPY = new Map<string, string>([
  ['declined', 'That sign-in was declined 🙅'],
  ['state', 'That sign-in link has expired — start the connect again 🌸'],
  ['session', 'That sign-in was started from a different Thingtime session 🔐'],
  ['provider', 'That app is not set up on this deployment yet 🔧'],
  ['exchange', 'Could not finish the sign-in with that app 😞'],
  ['rateLimited', 'Finishing sign-ins very enthusiastically — take a breather and try connecting again 🌸'],
  ['failed', OAUTH_ERROR_GENERIC]
]);

// An unrecognised code is the interesting case, not the edge case: it is what a
// hand-typed `?oauthError=<whatever>` looks like from here. It degrades to the
// generic line rather than being shown, which is what makes the echo dead.
export const oauthErrorMessage = (code: string | null | undefined): string | null =>
  code ? OAUTH_ERROR_COPY.get(code) || OAUTH_ERROR_GENERIC : null;

// Provider ids are catalogue slugs (`youtube`, `bluesky-account`). Resolving the
// real display name is preferred, but the landing effect runs on mount, before
// the first providers read settles, so a first-ever link has nothing to resolve
// against — hence the slug fallback rather than dropping the name. The shape
// check is what makes that fallback safe: no spaces and no punctuation beyond a
// hyphen means an unknown value cannot be a sentence, only a word-shaped token.
const PROVIDER_SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const connectedProviderLabel = (raw: string | null | undefined, providers: { id: string; name: string }[]): string | null => {
  if (!raw) return null;
  const known = providers.find((provider) => provider.id === raw);
  if (known) return known.name;
  return PROVIDER_SLUG.test(raw) ? raw : null;
};

// Append one connections-feed page to what is already rendered, dropping posts
// the reader is already holding. Appended pages can legitimately OVERLAP, so
// this is a correctness requirement, not defensive padding — the list keys on
// post id, and a repeat both renders the post twice and trips React's
// duplicate-key warning. Two overlaps are reachable:
//
//   • the deepen cursor (ConnectionsFeed.deepenAndContinue) is minted from a
//     POST shareId, while the server's own cursors ride external-post-source
//     ROW shareIds. The chrono tiebreak is `shareId > cursorId` at an equal
//     createdAt, and `ext-source-…` sorts after `ext-post-…` for every pair, so
//     the boundary post's own membership row always matches again. The client
//     cannot mint an exact row cursor (it never sees row ids), so the cursor
//     stays deliberately conservative — re-reading the boundary timestamp can
//     never SKIP a post — and the overlap is resolved here;
//   • an ordinary page boundary: one post sourced by several of the viewer's
//     accounts carries one membership row per account, and pageFromSourceRows
//     de-dupes only WITHIN the rows it fetched. A post whose rows straddle that
//     window is emitted again by the next page.
//
// Order is preserved and the incoming page never displaces an existing post:
// the rendered list only ever grows forward.
export const appendFeedPage = <T extends { id: string }>(current: T[], incoming: T[]): T[] => {
  const seen = new Set(current.map((post) => post.id));
  const fresh: T[] = [];
  for (const post of incoming) {
    if (seen.has(post.id)) continue;
    seen.add(post.id); // the incoming page can also repeat within itself
    fresh.push(post);
  }
  return fresh.length ? [...current, ...fresh] : current;
};
