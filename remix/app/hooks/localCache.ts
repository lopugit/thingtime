// Synchronous, SSR-safe localStorage JSON cache — the flash-free tier for
// optimistic rendering (mirrors index.html's theme-vars snapshot). Read it in a
// useState lazy initializer to paint last-known state on the very first render,
// then refetch in the background and reconcile. Use this for anything that
// gates first paint; use the async localforage 'thingtime' blob
// (ThingtimeProvider) only for large state that does NOT gate first paint.
//
// Convention: keys are namespaced `tt-<domain>` (matching tt-theme-vars).

export const readLocalCache = <T,>(key: string): T | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

export const writeLocalCache = (key: string, value: unknown): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded / storage disabled — non-fatal, we just lose the seed
  }
};

export const clearLocalCache = (key: string): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
};

// A per-entity cache namespace (one key per thing / component family /
// schema) is unbounded by construction: every entity the viewer opens adds a
// key that nothing ever removes. Left alone it eventually fills the origin's
// localStorage, and because writeLocalCache swallows the quota error BY
// DESIGN the failure is silent — every other tt-* optimistic cache just stops
// seeding, and the whole flash-free tier degrades with no error anywhere.
//
// So every such namespace is bounded and stamped: entries are written through
// writeStampedCache (which records `at`), and the writer prunes to the `max`
// most recently written keys, dropping the oldest first. `keep` is the key
// being written now — it is never a prune candidate, so the entry the viewer
// is looking at survives even when it is the oldest by stamp.
export type StampedCache<T> = { at: number; data: T };

export const writeStampedCache = (key: string, data: unknown): void => writeLocalCache(key, { at: Date.now(), data });

// Reads a stamped entry, tolerating an unstamped legacy value written before
// a namespace adopted the envelope (returns it as the data).
export const readStampedCache = <T,>(key: string): T | null => {
  const raw = readLocalCache<StampedCache<T> | T>(key);
  if (!raw) return null;
  const stamped = raw as Partial<StampedCache<T>>;
  return typeof stamped.at === 'number' && 'data' in stamped ? (stamped.data as T) : (raw as T);
};

export const pruneCacheNamespace = (prefix: string, keep: string, max: number): void => {
  if (typeof window === 'undefined') return;
  try {
    const entries: { key: string; at: number }[] = [];
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith(prefix) || key === keep) continue;
      // an unstamped legacy entry sorts oldest, so it is evicted first
      const at = Number(readLocalCache<{ at?: unknown }>(key)?.at);
      entries.push({ key, at: Number.isFinite(at) ? at : 0 });
    }
    entries.sort((a, b) => a.at - b.at);
    // `keep` occupies one of the `max` slots, so the survivors are max - 1
    for (const entry of entries.slice(0, Math.max(0, entries.length - (max - 1)))) clearLocalCache(entry.key);
  } catch {
    // storage disabled — nothing to prune
  }
};

// Remove every cached entry under a key prefix — for caches that hold
// session-tier data (e.g. tt-activity-* owner-tier day counts) and must not
// outlive the session that authorized them. Collect first, then remove:
// deleting while iterating localStorage.key(i) skips entries.
export const clearLocalCachePrefix = (prefix: string): void => {
  if (typeof window === 'undefined') return;
  try {
    const doomed: string[] = [];
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith(prefix)) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
};
