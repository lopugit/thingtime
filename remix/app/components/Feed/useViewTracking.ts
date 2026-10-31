import React from 'react';

// Public view-count telemetry (separate from useFeedEngagement, which trains
// feed algorithms): watches post cards and reports which posts were REALLY
// seen — ≥50% visible for ≥1s — plus how long (dwell), how fully (max
// intersection ratio) and where on screen (viewport position 0..1 at
// qualify time). Batches flush to POST /api/v1/things/views every 10s and on
// page hide via sendBeacon. One event per post per pageview; the server
// re-clamps and dedups everything anyway (the client is untrusted).
//
// Honesty layers on this side: the 1s qualify timer (glide-by scrolling
// doesn't count), navigator.webdriver skip (headless browsers don't count),
// and per-pageview dedup (re-scrolling doesn't spam impressions).

const FLUSH_INTERVAL_MS = 10_000;
const QUALIFY_MS = 1000;
const DWELL_CAP_MS = 120_000;
const BATCH_LIMIT = 50;

type PendingView = { id: string; dwellMs: number; ratio: number; pos: number | null };

export type UseViewTrackingResult = {
  observeView: (element: Element | null, thingId: string) => void;
};

export const useViewTracking = (): UseViewTrackingResult => {
  // posts already reported this pageview
  const sentRef = React.useRef<Set<string>>(new Set());
  // thingId -> qualify timer (visible, waiting out QUALIFY_MS)
  const qualifyTimersRef = React.useRef<Map<string, number>>(new Map());
  // thingId -> { startedAt, ratio, pos } for a qualified, still-visible card
  const activeRef = React.useRef<Map<string, { startedAt: number; ratio: number; pos: number | null }>>(new Map());
  // queued, finished views awaiting a flush
  const queueRef = React.useRef<PendingView[]>([]);
  const elementIdsRef = React.useRef<Map<Element, string>>(new Map());
  const observerRef = React.useRef<IntersectionObserver | null>(null);

  const finishView = React.useCallback((thingId: string) => {
    const active = activeRef.current.get(thingId);
    if (!active) return;
    activeRef.current.delete(thingId);
    queueRef.current.push({
      id: thingId,
      dwellMs: Math.min(Math.max(0, Date.now() - active.startedAt), DWELL_CAP_MS),
      ratio: active.ratio,
      pos: active.pos
    });
  }, []);

  const finishAll = React.useCallback(() => {
    Array.from(activeRef.current.keys()).forEach((thingId) => finishView(thingId));
  }, [finishView]);

  const flush = React.useCallback((options?: { beacon?: boolean }) => {
    if (!queueRef.current.length) return;
    const batch = queueRef.current.slice(0, BATCH_LIMIT);
    queueRef.current = queueRef.current.slice(BATCH_LIMIT);
    const payload = JSON.stringify({ events: batch });

    if (options?.beacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        if (navigator.sendBeacon('/api/v1/things/views', new Blob([payload], { type: 'application/json' }))) {
          return;
        }
      } catch {
        // fall through to fetch
      }
    }
    fetch('/api/v1/things/views', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: payload,
      keepalive: true
    }).catch(() => {});
  }, []);

  const observeView = React.useCallback((element: Element | null, thingId: string) => {
    if (!element || !thingId) return;
    // headless/automated browsers never count views
    if (typeof navigator !== 'undefined' && (navigator as any).webdriver) return;
    // sweep nodes that left the DOM so the observer doesn't pin them all session
    elementIdsRef.current.forEach((_id, tracked) => {
      if (!tracked.isConnected) {
        observerRef.current?.unobserve(tracked);
        elementIdsRef.current.delete(tracked);
      }
    });
    if (elementIdsRef.current.get(element) === thingId) return;
    elementIdsRef.current.set(element, thingId);
    observerRef.current?.observe(element);
  }, []);

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const thingId = elementIdsRef.current.get(entry.target);
          if (!thingId || sentRef.current.has(thingId)) return;

          if (entry.isIntersecting) {
            if (qualifyTimersRef.current.has(thingId) || activeRef.current.has(thingId)) return;
            // where the card sits in the viewport when it qualifies (0 = top)
            const viewportHeight = window.innerHeight || 1;
            const pos = Math.min(Math.max(entry.boundingClientRect.top / viewportHeight, 0), 1);
            const ratio = entry.intersectionRatio || 0.5;
            const timer = window.setTimeout(() => {
              qualifyTimersRef.current.delete(thingId);
              sentRef.current.add(thingId);
              activeRef.current.set(thingId, { startedAt: Date.now() - QUALIFY_MS, ratio, pos });
            }, QUALIFY_MS);
            qualifyTimersRef.current.set(thingId, timer);
          } else {
            const timer = qualifyTimersRef.current.get(thingId);
            if (timer !== undefined) {
              window.clearTimeout(timer);
              qualifyTimersRef.current.delete(thingId);
            }
            finishView(thingId);
          }
        });
      },
      { threshold: 0.5 }
    );

    observerRef.current = observer;
    elementIdsRef.current.forEach((_thingId, element) => observer.observe(element));

    return () => {
      observer.disconnect();
      observerRef.current = null;
      qualifyTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      qualifyTimersRef.current.clear();
    };
  }, [finishView]);

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      // long-dwell cards flush mid-view so a wall-staring session still counts
      // (their dwell keeps accumulating server-side via later batches — no:
      // one event per pageview — so just close out anything past the cap)
      activeRef.current.forEach((active, thingId) => {
        if (Date.now() - active.startedAt >= DWELL_CAP_MS) finishView(thingId);
      });
      flush();
    }, FLUSH_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      finishAll();
      flush({ beacon: true });
    };
    const onPageHide = () => {
      finishAll();
      flush({ beacon: true });
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      finishAll();
      flush();
    };
  }, [finishAll, finishView, flush]);

  return { observeView };
};
