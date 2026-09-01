import React from 'react';

import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { crossedGrowthStage } from './algorithmGrowth';
import type { EngagementEvent } from './feedTypes';

// Doomscroll telemetry for feed algorithms. Watches post cards with an
// IntersectionObserver (threshold .5), emits at most one 'view' and one
// 'dwell' per post per session, and passes explicit signals
// (expand/react/comment/share) straight through. Events queue locally and
// flush to /api/v1/algorithms/track every 8s + when the page hides; every
// event also accumulates into sessionEvents so a whole scroll session can be
// saved as a brand-new algorithm.

const FLUSH_INTERVAL_MS = 8000;
const DWELL_CAP_MS = 60000;
const TRACK_BATCH_LIMIT = 100;

export type UseFeedEngagementArgs = {
  activeAlgorithmId: string | null;
};

export type UseFeedEngagementResult = {
  observeCard: (element: Element | null, thingId: string) => void;
  recordEvent: (event: EngagementEvent) => void;
  // cheap render signal — the full list lives in a ref so every scroll event
  // doesn't re-render the whole feed
  sessionEventCount: number;
  getSessionEvents: () => EngagementEvent[];
};

export const useFeedEngagement = ({ activeAlgorithmId }: UseFeedEngagementArgs): UseFeedEngagementResult => {
  const api = useApi();

  const sessionEventsRef = React.useRef<EngagementEvent[]>([]);
  const [sessionEventCount, setSessionEventCount] = React.useState(0);
  const getSessionEvents = React.useCallback(() => sessionEventsRef.current.slice(), []);

  // pending events awaiting a training flush
  const queueRef = React.useRef<EngagementEvent[]>([]);
  // once-per-post-per-session dedup for the passive signals
  const viewSentRef = React.useRef<Set<string>>(new Set());
  const dwellSentRef = React.useRef<Set<string>>(new Set());
  // thingId -> timestamp the card crossed the visibility threshold
  const dwellStartRef = React.useRef<Map<string, number>>(new Map());
  const elementIdsRef = React.useRef<Map<Element, string>>(new Map());
  const observerRef = React.useRef<IntersectionObserver | null>(null);

  // refs so the interval/observer callbacks always see the latest values
  const algorithmIdRef = React.useRef<string | null>(activeAlgorithmId);
  algorithmIdRef.current = activeAlgorithmId;
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const lopu = useLopu();
  const lopuRef = React.useRef(lopu);
  lopuRef.current = lopu;

  const recordEvent = React.useCallback((event: EngagementEvent) => {
    if (!event?.thingId || !event?.signal) return;

    let next = event;
    if (next.signal === 'view') {
      if (viewSentRef.current.has(next.thingId)) return;
      viewSentRef.current.add(next.thingId);
    }
    if (next.signal === 'dwell') {
      if (dwellSentRef.current.has(next.thingId)) return;
      dwellSentRef.current.add(next.thingId);
      next = {
        ...next,
        dwellMs: Math.min(Math.max(0, Math.round(next.dwellMs || 0)), DWELL_CAP_MS)
      };
    }

    queueRef.current.push(next);
    sessionEventsRef.current.push(next);
    setSessionEventCount((prev) => prev + 1);
  }, []);

  // end an in-progress dwell for a post (left the viewport / page hidden)
  const closeDwell = React.useCallback(
    (thingId: string) => {
      const startedAt = dwellStartRef.current.get(thingId);
      if (startedAt === undefined) return;
      dwellStartRef.current.delete(thingId);
      recordEvent({ thingId, signal: 'dwell', dwellMs: Date.now() - startedAt });
    },
    [recordEvent]
  );

  const closeAllDwells = React.useCallback(() => {
    Array.from(dwellStartRef.current.keys()).forEach((thingId) => closeDwell(thingId));
  }, [closeDwell]);

  const flush = React.useCallback((options?: { beacon?: boolean }) => {
    if (!queueRef.current.length) return;

    // no active algorithm — the session still remembers, nothing to train
    if (!algorithmIdRef.current) {
      queueRef.current = [];
      return;
    }

    const events = queueRef.current;
    const batch = events.slice(0, TRACK_BATCH_LIMIT);
    queueRef.current = events.slice(TRACK_BATCH_LIMIT);

    if (options?.beacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const sent = navigator.sendBeacon(
          '/api/v1/algorithms/track',
          new Blob([JSON.stringify({ algorithmId: algorithmIdRef.current, events: batch })], {
            type: 'application/json'
          })
        );
        if (sent) return;
      } catch {
        // fall through to the api method
      }
    }

    apiRef.current.v1.algorithms
      .track({ algorithmId: algorithmIdRef.current, events: batch })
      .then((resp: any) => {
        // growth milestones (🥚→🐣→🐥→🧠): the server returns the
        // authoritative post-flush eventCount, so a crossing is detected from
        // before/after totals — monotonic, so each toast fires exactly once.
        // (A crossing inside a page-hide beacon flush has no readable
        // response and goes uncelebrated — rare and harmless.)
        if (!resp?.trained || typeof resp.eventCount !== 'number' || !resp.applied) return;
        const reached = crossedGrowthStage(resp.eventCount - resp.applied, resp.eventCount);
        if (reached) {
          lopuRef.current({ title: reached.toast, description: reached.tip, status: 'success', duration: 8000 });
        }
      })
      .catch(() => {});
  }, []);

  const observeCard = React.useCallback((element: Element | null, thingId: string) => {
    if (!element || !thingId) return;
    // sweep card nodes that left the DOM (filter/algorithm resets) so the
    // observer + map don't pin detached elements for the whole session
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
          if (!thingId) return;
          if (entry.isIntersecting) {
            recordEvent({ thingId, signal: 'view' });
            if (!dwellStartRef.current.has(thingId) && !dwellSentRef.current.has(thingId)) {
              dwellStartRef.current.set(thingId, Date.now());
            }
          } else {
            closeDwell(thingId);
          }
        });
      },
      { threshold: 0.5 }
    );

    observerRef.current = observer;
    // re-observe anything registered before the observer existed
    elementIdsRef.current.forEach((_thingId, element) => observer.observe(element));

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [recordEvent, closeDwell]);

  React.useEffect(() => {
    const interval = window.setInterval(() => flush(), FLUSH_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      closeAllDwells();
      flush({ beacon: true });
    };

    const onPageHide = () => {
      closeAllDwells();
      flush({ beacon: true });
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      closeAllDwells();
      flush();
    };
  }, [flush, closeAllDwells]);

  return { observeCard, recordEvent, sessionEventCount, getSessionEvents };
};
