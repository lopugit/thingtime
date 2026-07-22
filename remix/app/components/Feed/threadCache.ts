import type { PostComment } from './feedTypes';

// Loaded reply threads, cached OUTSIDE component state so collapsing a parent
// (which unmounts its child rows) never forgets what was already fetched —
// re-expanding paints instantly from here, no skeleton. Entries persist in
// localStorage (the synchronous tt-<domain> tier — it can seed first paint,
// which the async localforage blob can't) for TTL_MS, and every reveal still
// background-refreshes so live comments reconcile in.

const STORAGE_KEY = 'tt-thread-cache';
// keep loaded threads for 5 days (the asked-for 3-7 day window)
const TTL_MS = 5 * 24 * 60 * 60 * 1000;
// newest-N cap keeps the blob well inside localStorage quotas
const MAX_ENTRIES = 400;

type Entry = { replies: PostComment[]; at: number };

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

export const getCachedThread = (id: string): PostComment[] | null => load().get(id)?.replies ?? null;

export const setCachedThread = (id: string, replies: PostComment[]) => {
  const map = load();
  map.delete(id); // re-insert at the end (newest) for the MAX_ENTRIES slice
  map.set(id, { replies, at: Date.now() });
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

// One shared fetch per comment id — rows, post-level prefetchers, and reveal
// refreshes all funnel through here (in-flight dedupe included). The fetched
// list lands in the cache and avatars get warmed before anyone renders them.
const inflight = new Map<string, Promise<PostComment[] | null>>();

export const fetchThreadInto = (api: any, id: string): Promise<PostComment[] | null> => {
  const existing = inflight.get(id);
  if (existing) return existing;
  const request = api.v1.things
    .get({ id })
    .then((resp: any) => {
      const fetched: PostComment[] = resp?.post?.comments || [];
      setCachedThread(id, fetched);
      warmAvatars(fetched);
      return fetched;
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(id);
    });
  inflight.set(id, request);
  return request;
};

// Prefetch the NEXT depth below a list of comments: any entry with replies
// that aren't already cached gets its thread pulled in the background.
export const prefetchNextDepth = (api: any, comments: PostComment[] | null | undefined) => {
  if (!comments) return;
  for (const comment of comments) {
    if (comment.commentCount > 0 && !getCachedThread(comment.id)) {
      void fetchThreadInto(api, comment.id);
    }
  }
};
