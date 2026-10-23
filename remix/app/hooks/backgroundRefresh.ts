/** One poller per mounted resource, with no overlapping requests or focus storms. */
export type RefreshEnvironment = {
  window: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  online: () => boolean;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (id: ReturnType<typeof setTimeout>) => void;
};
type Listener = () => void | Promise<unknown>;
type Job = { listeners: Set<Listener>; interval: number; hiddenInterval: number; running: boolean; again: boolean; last: number; failures: number; timer?: ReturnType<typeof setTimeout> };

export const createBackgroundRefresh = (env: RefreshEnvironment) => {
  const jobs = new Map<string, Job>();
  const visible = () => env.document.visibilityState === 'visible';
  const schedule = (job: Job) => {
    if (job.timer !== undefined) env.clearTimer(job.timer);
    if (!job.listeners.size) return;
    const delay = (visible() ? job.interval : job.hiddenInterval) * Math.min(8, 2 ** job.failures);
    job.timer = env.setTimer(() => { void run(job); }, delay);
  };
  const run = async (job: Job, resume = false) => {
    if (!job.listeners.size) return;
    if (job.running) { if (resume) job.again = true; return; }
    if (!env.online() || (resume && !visible()) || env.now() - job.last < 1000) { schedule(job); return; }
    if (job.timer !== undefined) env.clearTimer(job.timer);
    job.running = true;
    job.last = env.now();
    try {
      // Subscribers sharing a key represent the same store, so invoke only one.
      await job.listeners.values().next().value?.();
      job.failures = 0;
    } catch { job.failures = Math.min(3, job.failures + 1); }
    finally {
      job.running = false;
      const again = job.again;
      job.again = false;
      if (again && env.now() - job.last >= 1000) void run(job, true);
      else schedule(job);
    }
  };
  const resume = () => { if (visible()) for (const job of jobs.values()) void run(job, true); };
  const events = ['focus', 'online', 'pageshow'] as const;
  return {
    subscribe(key: string, listener: Listener, interval = 15_000, immediate = true) {
      if (!jobs.size) {
        for (const event of events) env.window.addEventListener(event, resume);
        env.document.addEventListener('visibilitychange', resume);
      }
      let job = jobs.get(key);
      if (!job) {
        job = { listeners: new Set(), interval, hiddenInterval: Math.max(60_000, interval), running: false, again: false, last: -Infinity, failures: 0 };
        jobs.set(key, job);
      }
      job.listeners.add(listener);
      if (job.listeners.size === 1) { if (immediate) void run(job); else schedule(job); }
      const owned = job;
      return () => {
        owned.listeners.delete(listener);
        if (owned.listeners.size) return;
        if (owned.timer !== undefined) env.clearTimer(owned.timer);
        jobs.delete(key);
        if (!jobs.size) {
          for (const event of events) env.window.removeEventListener(event, resume);
          env.document.removeEventListener('visibilitychange', resume);
        }
      };
    }
  };
};
let browserRefresh: ReturnType<typeof createBackgroundRefresh> | undefined;
export const subscribeBackgroundRefresh = (key: string, listener: Listener, interval = 15_000, immediate = true) => {
  if (typeof window === 'undefined') return () => {};
  browserRefresh ??= createBackgroundRefresh({ window, document, online: () => navigator.onLine !== false, now: Date.now, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: id => clearTimeout(id) });
  return browserRefresh.subscribe(key, listener, interval, immediate);
};
