import React from 'react';

import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';

// Recently-used reaction tokens for the picker. Server (users.meta) is the
// source of truth, but we seed synchronously from a per-account localStorage
// snapshot so "Recently Used" paints instantly (optimistic rendering) and then
// reconcile with the lazy fetch. Keyed per user so switching accounts never
// shows the previous account's recents.

const keyFor = (userId: string | null) => `tt-recent-reactions:${userId || 'anon'}`;

export const useRecentReactions = () => {
  const api = useApi();
  const user = useCurrentUser();
  const userId = user?.id ?? null;

  const [recent, setRecent] = React.useState<string[]>(() => readLocalCache<string[]>(keyFor(userId)) || []);

  const apiRef = React.useRef(api);
  apiRef.current = api;

  // Reseed from this account's snapshot and refetch whenever the viewer changes.
  React.useEffect(() => {
    setRecent(readLocalCache<string[]>(keyFor(userId)) || []);
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await apiRef.current.v1.things.reactionsRecent();
        if (!cancelled && resp?.ok && Array.isArray(resp.recentReactions)) {
          setRecent(resp.recentReactions);
          writeLocalCache(keyFor(userId), resp.recentReactions);
        }
      } catch {
        // keep the optimistic snapshot
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Prepend a just-used token (optimistic); if the server returned the fresh
  // MRU, trust it exactly.
  const pushRecent = React.useCallback(
    (token: string, serverList?: string[] | null) => {
      setRecent((prev) => {
        const next =
          serverList && serverList.length ? serverList : [token, ...prev.filter((entry) => entry !== token)];
        writeLocalCache(keyFor(userId), next);
        return next;
      });
    },
    [userId]
  );

  return { recent, pushRecent };
};
