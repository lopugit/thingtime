import React from 'react';

import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';

// Recently-used reaction tokens for the picker. Server (users.meta) is the
// source of truth, but we seed synchronously from a per-account localStorage
// snapshot so "Recently Used" paints instantly (optimistic rendering) and then
// reconcile with the lazy fetch. Keyed per user so switching accounts never
// shows the previous account's recents.
//
// The list is per-account and identical for every consumer, so it lives in one
// module-level store per viewer rather than in each hook instance. Previously
// every mount fetched its own copy: PostCard alone uses this hook twice per
// card, so a 20-post feed issued ~40 identical requests for the same list (a
// single /schemas load measured 8). Each copy also held its own state, so
// reacting in one place left every other mounted picker stale until remount.
// The store fixes both — one request per viewer, one list every subscriber
// sees.

const keyFor = (userId: string | null) => `tt-recent-reactions:${userId || 'anon'}`;

type RecentStore = {
  list: string[];
  fetched: boolean;
  inflight: Promise<void> | null;
  subscribers: Set<() => void>;
};

const stores = new Map<string, RecentStore>();

const storeFor = (userId: string | null): RecentStore => {
  const key = keyFor(userId);
  let store = stores.get(key);
  if (!store) {
    store = { list: readLocalCache<string[]>(key) || [], fetched: false, inflight: null, subscribers: new Set() };
    stores.set(key, store);
  }
  return store;
};

// Replace the list and tell every mounted consumer. The array identity only
// changes when the contents do, which keeps useSyncExternalStore stable.
const publish = (userId: string | null, store: RecentStore, list: string[]) => {
  store.list = list;
  writeLocalCache(keyFor(userId), list);
  store.subscribers.forEach((notify) => notify());
};

export const useRecentReactions = () => {
  const api = useApi();
  const user = useCurrentUser();
  const userId = user?.id ?? null;
  const store = storeFor(userId);

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
          publish(userId, store, resp.recentReactions);
        }
      } catch {
        // keep the optimistic snapshot
      } finally {
        store.inflight = null;
      }
    })();
  }, [userId, store]);

  // Prepend a just-used token (optimistic); if the server returned the fresh
  // MRU, trust it exactly.
  const pushRecent = React.useCallback(
    (token: string, serverList?: string[] | null) => {
      const next = serverList && serverList.length ? serverList : [token, ...store.list.filter((entry) => entry !== token)];
      publish(userId, store, next);
    },
    [userId, store]
  );

  return { recent, pushRecent };
};
