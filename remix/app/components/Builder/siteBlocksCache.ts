export type SiteBlockState<T> = { data: T | null; error: boolean };
const empty = Object.freeze({ data: null, error: false });
/** One cache belongs to one mounted workspace identity. Invalidation retains
 * useful paint, but fences delayed reads; failed refreshes never evict content. */
export function createSiteBlocksCache<T>(limit = 32) {
 const values = new Map<string, { state: SiteBlockState<T>; generation: number }>();
 const requests = new Map<string, Promise<void>>(), listeners = new Set<() => void>();
 let alive = true, generation = 0;
 const notify = () => listeners.forEach(listener => listener());
 const read = (key: string): SiteBlockState<T> => values.get(key)?.state || empty;
 const invalidate = () => { generation++; requests.clear(); };
 const put = (key: string, state: SiteBlockState<T>) => {
  values.delete(key); values.set(key, { state, generation });
  // Global decorations remain mounted across routes; only route entries expire.
  while (values.size > limit) { const oldest = [...values.keys()].find(candidate => candidate !== 'global' && candidate !== key); if (!oldest) break; values.delete(oldest); }
  notify();
 };
 return {
  read,
  fresh: (key: string) => values.get(key)?.generation === generation && !read(key).error,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  invalidate,
  dispose: () => { alive = false; invalidate(); listeners.clear(); values.clear(); },
  load(key: string, loader: () => Promise<T | null>, current: () => void): Promise<void> {
   if (!alive) return Promise.resolve();
   const pending = requests.get(key); if (pending) return pending;
   const captured = generation;
   const task = Promise.resolve().then(loader).then(data => {
    current(); if (!alive || generation !== captured) return;
    put(key, data === null ? { ...read(key), error: true } : { data, error: false });
   }).catch(() => {
    if (!alive || generation !== captured) return;
    try { current(); } catch { return; }
    put(key, { ...read(key), error: true });
   }).finally(() => { if (requests.get(key) === task) requests.delete(key); });
   requests.set(key, task); return task;
  }
 };
}
