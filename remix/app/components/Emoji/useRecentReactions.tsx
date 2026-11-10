import React from 'react';

import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { beginRecentReaction, createRecentReactionState, reactionPickerScope, receiveRecentReactions, recordRecentReaction, type RecentReactionState } from './reactionPickerState';

// Recently-used reaction tokens for the picker. Server (users.meta) is the
// source of truth, but we seed synchronously from a per-account localStorage
// snapshot so "Recently Used" paints instantly and then reconciles with a
// shared fetch. The origin, database and actor scope prevent cross-account or
// endpoint reuse. Older user-only snapshots are intentionally not migrated.
//
// The list is per-account and identical for every consumer, so it lives in one
// module-level store per viewer rather than in each hook instance. Previously
// every mount fetched its own copy: PostCard alone uses this hook twice per
// card, so a 20-post feed issued ~40 identical requests for the same list (a
// single /schemas load measured 8). Each copy also held its own state, so
// reacting in one place left every other mounted picker stale until remount.
// The store fixes both — one request per viewer, one list every subscriber
// sees.

const keyFor = (scopeKey: string) => `tt-recent-reactions:v2:${scopeKey}`;

type RecentStore = RecentReactionState & {
  fetched: boolean;
  inflight: Promise<void> | null;
  subscribers: Set<() => void>;
};

const stores = new Map<string, RecentStore>();

const storeFor = (scopeKey: string): RecentStore => {
  const key = keyFor(scopeKey);
  let store = stores.get(key);
  if (!store) {
    store = { ...createRecentReactionState(readLocalCache(key)), fetched: false, inflight: null, subscribers: new Set() };
    stores.set(key, store);
  }
  return store;
};

// Persist the changed snapshot and tell every mounted consumer. The snapshot
// keeps its identity between updates, as useSyncExternalStore requires.
const publish = (scopeKey: string, store: RecentStore) => {
  writeLocalCache(keyFor(scopeKey), store.list);
  store.subscribers.forEach((notify) => notify());
};

export const useRecentReactions = () => {
  const api = useApi();
  const user = useCurrentUser();
  const userId = user?.id ?? null;
  const dataPlane = useDataPlane();
  const scopeKey = reactionPickerScope(typeof window === 'undefined' ? '' : window.location.origin, dataPlane, userId);
  const store = storeFor(scopeKey);

  const apiRef = React.useRef(api);
  apiRef.current = api;

  const recent = React.useSyncExternalStore(
    React.useCallback(
      (onStoreChange: () => void) => {
        store.subscribers.add(onStoreChange);
        return () => {
          store.subscribers.delete(onStoreChange);
        };
      },
      [store]
    ),
    () => store.list,
    () => store.list
  );

  // One fetch per viewer per session. Concurrent mounts share the in-flight
  // promise; later mounts reuse the resolved list. pushRecent keeps the store
  // current locally, so there is nothing to re-poll for.
  React.useEffect(() => {
    if (!userId || store.fetched || store.inflight) return;
    store.inflight = (async () => {
      try {
        const resp = await apiRef.current.v1.things.reactionsRecent();
        if (resp?.ok && Array.isArray(resp.recentReactions)) {
          store.fetched = true;
          receiveRecentReactions(store, resp.recentReactions);
          publish(scopeKey, store);
        }
      } catch {
        // keep the optimistic snapshot
      } finally {
        store.inflight = null;
      }
    })();
  }, [userId, scopeKey, store]);

  // Order is captured before the toggle starts, so a slow response cannot
  // promote an older selection over a more recent successful one.
  const beginRecent = React.useCallback(() => beginRecentReaction(store), [store]);
  const pushRecent = React.useCallback(
    (token: string, serverList?: string[] | null, order = beginRecentReaction(store)) => {
      recordRecentReaction(store, token, serverList, order);
      publish(scopeKey, store);
    },
    [scopeKey, store]
  );

  return { recent, pushRecent, beginRecent, scopeKey };
};
