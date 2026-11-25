import { userPresence } from '../activity/userPresence';

/** One poller per mounted resource, with no overlapping requests or focus storms.
 * Polling runs only while the window is visible and someone is using it; hidden
 * or idle windows schedule nothing and refresh immediately when the user
 * returns (visibility, focus, page restore, reconnect or any interaction). */
export type RefreshEnvironment = {
  window: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  online: () => boolean;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (id: ReturnType<typeof setTimeout>) => void;
  /** True while nobody has interacted with the window for a while. */
  idle?: () => boolean;
  /** Notifies when the user goes idle or returns; returns an unsubscribe. */
  onPresence?: (listener: () => void) => () => void;
};
type Listener = () => void | Promise<unknown>;
type Job = { listeners: Set<Listener>; interval: number; running: boolean; again: boolean; last: number; failures: number; timer?: ReturnType<typeof setTimeout> };

export const createBackgroundRefresh = (env: RefreshEnvironment) => {
  const jobs = new Map<string, Job>();
  const visible = () => env.document.visibilityState === 'visible';
  const schedule = (job: Job) => {
    if (job.timer !== undefined) env.clearTimer(job.timer);
    job.timer = undefined;
    // Nothing is scheduled while hidden or idle: the next return refreshes.
    if (!job.listeners.size || !visible() || env.idle?.()) return;
    const delay = job.interval * Math.min(8, 2 ** job.failures);
    job.timer = env.setTimer(() => { void run(job); }, delay);
  };
  const run = async (job: Job, resume = false) => {
    if (!job.listeners.size) return;
    if (job.running) { if (resume) job.again = true; return; }
    // Connectivity hints can report offline while a local origin is reachable.
    // Probe on first load and foreground return; keep offline background polls
    // paused and retain the existing throttle and in-flight request coalescing.
    const canProbe = resume || job.last === -Infinity;
    if ((!env.online() && !canProbe) || (resume && !visible()) || env.now() - job.last < 1000) { schedule(job); return; }
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
  // Going hidden or idle cancels pending polls at once; returning refreshes.
  const pause = () => { for (const job of jobs.values()) schedule(job); };
  const presenceChanged = () => { if (env.idle?.()) pause(); else resume(); };
  const visibilityChanged = () => { if (visible()) resume(); else pause(); };
  let stopPresence: (() => void) | undefined;
  const events = ['focus', 'online', 'pageshow'] as const;
  return {
    subscribe(key: string, listener: Listener, interval = 15_000, immediate = true) {
      if (!jobs.size) {
        for (const event of events) env.window.addEventListener(event, resume);
        env.document.addEventListener('visibilitychange', visibilityChanged);
        stopPresence = env.onPresence?.(presenceChanged);
      }
      let job = jobs.get(key);
      if (!job) {
        job = { listeners: new Set(), interval, running: false, again: false, last: -Infinity, failures: 0 };
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
          env.document.removeEventListener('visibilitychange', visibilityChanged);
          stopPresence?.();
          stopPresence = undefined;
        }
      };
    }
  };
};
let browserRefresh: ReturnType<typeof createBackgroundRefresh> | undefined;
export const subscribeBackgroundRefresh = (key: string, listener: Listener, interval = 15_000, immediate = true) => {
  if (typeof window === 'undefined') return () => {};
  browserRefresh ??= createBackgroundRefresh({
    window, document, online: () => navigator.onLine !== false, now: Date.now,
    setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: id => clearTimeout(id),
    idle: () => userPresence()?.isIdle() ?? false,
    onPresence: listener => userPresence()?.subscribe(listener) ?? (() => {})
  });
  return browserRefresh.subscribe(key, listener, interval, immediate);
};
