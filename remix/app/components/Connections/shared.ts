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
