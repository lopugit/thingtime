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
