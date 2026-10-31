import type { CommentSort, PostComment } from './feedTypes';
import { mergeReactionOverlays } from './reactionOverlay';

// Loaded reply threads, cached OUTSIDE component state so collapsing a parent
// (which unmounts its child rows) never forgets what was already fetched —
// re-expanding paints instantly from here, no skeleton. Entries persist in
// localStorage (the synchronous tt-<domain> tier — it can seed first paint,
// which the async localforage blob can't) for TTL_MS, and every reveal still
// background-refreshes so live comments reconcile in.
//
// Entries are keyed by the comment id for the default (chronological) read
// and by `<id>:<sort>` for a Top / New / Old read (round 2 S7): a card under
// a sort drills into a thread in the SAME order — the thread's own
// `GET ?id=<comment>&commentSort=` — and a sorted page never poisons the
// default cache (or the other way round). Old persisted entries keep their
// bare-id key, so nothing already cached is thrown away.

const STORAGE_KEY = 'tt-thread-cache';
// keep loaded threads for 5 days (the asked-for 3-7 day window)
const TTL_MS = 5 * 24 * 60 * 60 * 1000;
// newest-N cap keeps the blob well inside localStorage quotas
const MAX_ENTRIES = 400;

type Entry = { replies: PostComment[]; at: number };
// the order a thread was read in: null / undefined = the default page
export type ThreadSort = CommentSort | null | undefined;
const keyOf = (id: string, sort?: ThreadSort) => (sort ? `${id}:${sort}` : id);

let mem: Map<string, Entry> | null = null;

const load = (): Map<string, Entry> => {
  if (mem) return mem;
  mem = new Map();
  if (typeof window === 'undefined') return mem;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const now = Date.now();
      for (const [id, entry] of Object.entries(JSON.parse(raw) as Record<string, Entry>)) {
        if (entry && Array.isArray(entry.replies) && now - entry.at < TTL_MS) mem.set(id, entry);
      }
    }
  } catch {
    // corrupted/unavailable storage — run memory-only
  }
  return mem;
};

let persistQueued = false;
const persist = () => {
  if (persistQueued || typeof window === 'undefined') return;
  persistQueued = true;
  setTimeout(() => {
    persistQueued = false;
    try {
      const entries = [...load().entries()].slice(-MAX_ENTRIES);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      // quota/unavailable — memory cache still works for this session
    }
  }, 250);
};

// Reads merge through the viewer's reaction overlay stamped with the entry's
// write time — a cached copy older than the viewer's last tap can't hand a
// stale reaction state to whoever seeds from it.
export const getCachedThread = (id: string, sort?: ThreadSort): PostComment[] | null => {
  const entry = load().get(keyOf(id, sort));
  if (!entry) return null;
  return mergeReactionOverlays(entry.at, entry.replies);
};

export const setCachedThread = (id: string, replies: PostComment[], options: { at?: number; sort?: ThreadSort } = {}) => {
  const map = load();
  const key = keyOf(id, options.sort);
  map.delete(key); // re-insert at the end (newest) for the MAX_ENTRIES slice
  map.set(key, { replies, at: options.at ?? Date.now() });
  persist();
};

// Warm avatar URLs into the browser image cache so revealing a depth never
// pops in placeholder avatars.
export const warmAvatars = (comments: PostComment[] | null | undefined) => {
  if (typeof window === 'undefined' || !comments) return;
  for (const comment of comments) {
    const url = comment.author?.avatarUrl;
    if (url) {
      const img = new window.Image();
      img.src = url;
    }
    if (comment.comments?.length) warmAvatars(comment.comments);
  }
};

// One shared fetch per (comment id, sort) — rows, post-level prefetchers, and
// reveal refreshes all funnel through here (in-flight dedupe included). The
// fetched list lands in the cache and avatars get warmed before anyone
// renders them. A sort reads the thread's own sorted page
// (GET ?id=<comment>&commentSort=), the order the card is showing.
const inflight = new Map<string, Promise<PostComment[] | null>>();

export const fetchThreadInto = (api: any, id: string, sort?: ThreadSort): Promise<PostComment[] | null> => {
  const key = keyOf(id, sort);
  const existing = inflight.get(key);
  if (existing) return existing;
  // stamp the START: a response snapshotted before a tap that lands after it
  // must not clobber the tap — the overlay merge decides per comment
  const startedAt = Date.now();
  const request = api.v1.things
    .get(sort ? { id, commentSort: sort } : { id })
    .then((resp: any) => {
      const fetched: PostComment[] = mergeReactionOverlays(startedAt, resp?.post?.comments || []);
      setCachedThread(id, fetched, { at: startedAt, sort });
      warmAvatars(fetched);
      return fetched;
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, request);
  return request;
};

// Prefetch the NEXT depth below a list of comments: any entry with replies
// that aren't already cached (in this order) gets its thread pulled in the
// background.
export const prefetchNextDepth = (api: any, comments: PostComment[] | null | undefined, sort?: ThreadSort) => {
  if (!comments) return;
  for (const comment of comments) {
    if (comment.commentCount > 0 && !getCachedThread(comment.id, sort)) {
      void fetchThreadInto(api, comment.id, sort);
    }
  }
};
