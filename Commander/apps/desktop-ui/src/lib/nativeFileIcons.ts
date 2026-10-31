import { nativeRequest } from './nativeBridge.js';

const maximumCachedIcons = 512;
const maximumCachedIconBytes = 24 * 1024 * 1024;
const maximumBridgeRequests = 2;
const backgroundDebounceMilliseconds = 40;
const failedIconRetryMilliseconds = 15_000;

interface NativeFileIconResult {
  dataUrl?: unknown;
}

interface CachedIcon {
  dataUrl: string | null;
  bytes: number;
  expiresAt: number | null;
}

interface IconJob {
  path: string;
  priority: number;
  sequence: number;
  consumers: number;
  started: boolean;
  promise: Promise<string | null>;
  resolve: (dataUrl: string | null) => void;
}

export interface NativeFileIconRequest {
  promise: Promise<string | null>;
  cancel(): void;
}

const iconCache = new Map<string, CachedIcon>();
const pendingIcons = new Map<string, IconJob>();
const nativeIconQueue: IconJob[] = [];
let cachedIconBytes = 0;
let activeBridgeRequests = 0;
let nextSequence = 0;
let scheduledDrain: number | undefined;
let scheduledDrainDelay: number | undefined;

function removeCachedIcon(path: string): void {
  const previous = iconCache.get(path);
  if (!previous) return;
  iconCache.delete(path);
  cachedIconBytes -= previous.bytes;
}

/**
 * Reads a session-local LRU cache. `undefined` means the asset has not been
 * resolved yet; `null` is a short-lived negative cache for unavailable paths.
 */
export function cachedNativeFileIcon(path: string): string | null | undefined {
  const cached = iconCache.get(path);
  if (!cached) return undefined;
  if (cached.expiresAt !== null && cached.expiresAt <= Date.now()) {
    removeCachedIcon(path);
    return undefined;
  }
  // Move hot entries to the end of the insertion-ordered Map.
  iconCache.delete(path);
  iconCache.set(path, cached);
  return cached.dataUrl;
}

function rememberNativeFileIcon(path: string, dataUrl: string | null): string | null {
  removeCachedIcon(path);
  const bytes = dataUrl ? dataUrl.length * 2 : 0;
  iconCache.set(path, {
    dataUrl,
    bytes,
    expiresAt: dataUrl ? null : Date.now() + failedIconRetryMilliseconds,
  });
  cachedIconBytes += bytes;

  while (iconCache.size > maximumCachedIcons || cachedIconBytes > maximumCachedIconBytes) {
    const oldest = iconCache.keys().next().value;
    if (typeof oldest !== 'string') break;
    removeCachedIcon(oldest);
  }
  return dataUrl;
}

function iconDataUrl(result: NativeFileIconResult | undefined): string | null {
  return typeof result?.dataUrl === 'string' && result.dataUrl.startsWith('data:image/png;base64,')
    ? result.dataUrl
    : null;
}

function dequeueNextIcon(): IconJob | undefined {
  let nextIndex = -1;
  for (let index = 0; index < nativeIconQueue.length; index += 1) {
    const candidate = nativeIconQueue[index]!;
    if (candidate.consumers === 0) {
      nativeIconQueue.splice(index, 1);
      pendingIcons.delete(candidate.path);
      index -= 1;
      continue;
    }
    const current = nextIndex >= 0 ? nativeIconQueue[nextIndex]! : undefined;
    if (
      !current ||
      candidate.priority < current.priority ||
      (candidate.priority === current.priority && candidate.sequence < current.sequence)
    ) {
      nextIndex = index;
    }
  }
  return nextIndex >= 0 ? nativeIconQueue.splice(nextIndex, 1)[0] : undefined;
}

function drainNativeIconQueue(): void {
  while (activeBridgeRequests < maximumBridgeRequests) {
    const job = dequeueNextIcon();
    if (!job) return;

    job.started = true;
    activeBridgeRequests += 1;
    void nativeRequest<NativeFileIconResult>('filesystem.icon', { path: job.path })
      .then(iconDataUrl)
      .catch(() => null)
      .then((dataUrl) => {
        if (pendingIcons.get(job.path) === job) pendingIcons.delete(job.path);
        job.resolve(rememberNativeFileIcon(job.path, dataUrl));
      })
      .finally(() => {
        activeBridgeRequests -= 1;
        // Keep at most two bridge messages outstanding. The native side yields
        // between AppKit renders, so this refills the pipeline without flooding it.
        drainNativeIconQueue();
      });
  }
}

function scheduleNativeIconDrain(): void {
  const delay = nativeIconQueue.some((job) => job.priority === 0) ? 0 : backgroundDebounceMilliseconds;
  if (scheduledDrain !== undefined) {
    if ((scheduledDrainDelay ?? delay) <= delay) return;
    window.clearTimeout(scheduledDrain);
  }
  scheduledDrainDelay = delay;
  scheduledDrain = window.setTimeout(() => {
    scheduledDrain = undefined;
    scheduledDrainDelay = undefined;
    drainNativeIconQueue();
  }, delay);
}

/**
 * Shares one cache and one bounded bridge queue across every result row.
 * The selected row uses priority 0; background rows wait briefly so a fast
 * changing query does not enqueue stale work before its current result set.
 */
export function requestNativeFileIcon(path: string, priority: number): NativeFileIconRequest {
  const cached = cachedNativeFileIcon(path);
  if (cached !== undefined) return { promise: Promise.resolve(cached), cancel: () => undefined };

  let job = pendingIcons.get(path);
  if (!job) {
    let resolve!: (dataUrl: string | null) => void;
    const promise = new Promise<string | null>((nextResolve) => {
      resolve = nextResolve;
    });
    job = {
      path,
      priority: Math.max(0, Math.floor(priority)),
      sequence: nextSequence,
      consumers: 0,
      started: false,
      promise,
      resolve,
    };
    nextSequence += 1;
    pendingIcons.set(path, job);
    nativeIconQueue.push(job);
  } else if (!job.started) {
    job.priority = Math.min(job.priority, Math.max(0, Math.floor(priority)));
  }

  job.consumers += 1;
  scheduleNativeIconDrain();
  let cancelled = false;
  return {
    promise: job.promise,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      job!.consumers = Math.max(0, job!.consumers - 1);
      if (job!.consumers === 0 && !job!.started && pendingIcons.get(path) === job) {
        pendingIcons.delete(path);
        const index = nativeIconQueue.indexOf(job!);
        if (index >= 0) nativeIconQueue.splice(index, 1);
      }
    },
  };
}

/** Test-only reset to keep module-level cache and queue state isolated. */
export function resetNativeFileIconSchedulerForTests(): void {
  if (scheduledDrain !== undefined) window.clearTimeout(scheduledDrain);
  scheduledDrain = undefined;
  scheduledDrainDelay = undefined;
  iconCache.clear();
  pendingIcons.clear();
  nativeIconQueue.splice(0);
  cachedIconBytes = 0;
  activeBridgeRequests = 0;
  nextSequence = 0;
}
