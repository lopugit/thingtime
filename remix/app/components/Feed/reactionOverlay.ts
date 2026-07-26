// The viewer's local reaction truth, per thing id — the merge layer between
// optimistic taps and background refetches.
//
// The bug class this kills: a background fetch (thread revalidation, feed
// stale-while-revalidate, permalink load) snapshots the db BEFORE the
// viewer's tap but lands AFTER its optimistic paint. Ingesting that copy
// wholesale wipes the reaction — it flickers back when the POST acks, or
// stays wrong if the fetch lands after the ack ("disappearing / uncounted
// reactions", worst on real network latency).
//
// Contract:
// - Every local reaction mutation (optimistic paint, server ack, failure
//   revert) notes its resulting counts here, timestamped.
// - Every ingestion of server copies merges through mergeReactionOverlay(s)
//   with the time the fetch STARTED:
//   fetch started BEFORE the last note → its reaction fields are stale for
//   this id → the overlay's fields win (entry kept for the next fetch);
//   fetch started AFTER the last note → the server copy already includes
//   that mutation (or something newer) → server wins, entry cleared.
// - Cache seeds pass fetchStartedAt from the cache entry's write time, so a
//   session's taps outrank yesterday's cached copies but a post-ack fetch
//   still retires the overlay.
//
// The registry is module-memory only (resets on reload — by then the server
// has the truth) and holds one small entry per thing the viewer touched.

type OverlayTarget = {
  id: string;
  reactionCounts?: Record<string, number>;
  viewerReactions?: string[];
  comments?: OverlayTarget[];
};

type OverlayEntry = {
  reactionCounts: Record<string, number>;
  viewerReactions: string[];
  notedAt: number;
};

const overlays = new Map<string, OverlayEntry>();

export const noteLocalReactions = (
  id: string,
  reactionCounts: Record<string, number> | undefined,
  viewerReactions: string[] | undefined
) => {
  overlays.set(id, {
    reactionCounts: reactionCounts || {},
    viewerReactions: viewerReactions || [],
    notedAt: Date.now()
  });
};

// Recursive (covers shipped reply trees) and referentially stable: subtrees
// with no overlay hits come back as the same object, so ingestion that
// changes nothing re-renders nothing.
export const mergeReactionOverlay = <T extends OverlayTarget>(fetchStartedAt: number, entry: T): T => {
  let next = entry;
  const overlay = overlays.get(entry.id);
  if (overlay) {
    if (fetchStartedAt >= overlay.notedAt) {
      overlays.delete(entry.id);
    } else {
      next = { ...next, reactionCounts: overlay.reactionCounts, viewerReactions: overlay.viewerReactions };
    }
  }
  const children = entry.comments as T[] | undefined;
  if (children?.length) {
    const merged = children.map((child) => mergeReactionOverlay(fetchStartedAt, child));
    if (merged.some((child, index) => child !== children[index])) {
      next = next === entry ? { ...entry, comments: merged } : { ...next, comments: merged };
    }
  }
  return next;
};

export const mergeReactionOverlays = <T extends OverlayTarget>(fetchStartedAt: number, entries: T[]): T[] =>
  entries.map((entry) => mergeReactionOverlay(fetchStartedAt, entry));
