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
