import { useEffect, useRef } from 'react';
import { subscribeBackgroundRefresh } from './backgroundRefresh';

/** Keep the latest callback without restarting polling on every render. */
export const useBackgroundRefresh = (key: string | null, refresh: () => void | Promise<unknown>, interval = 15_000, immediate = true) => {
  const callback = useRef(refresh);
  callback.current = refresh;
  useEffect(() => {
    if (!key) return;
    return subscribeBackgroundRefresh(key, () => callback.current(), interval, immediate);
  }, [key, interval, immediate]);
};
