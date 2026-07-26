import React from 'react';
import localforage from 'localforage';

// Per-user, per-target draft persistence for comment/reply inputs — type,
// leave, come back later and continue where you left off. Backed by
// localforage (same store engine as the thingtime editor drafts), keyed by
// user so accounts sharing a device never see each other's drafts.
//
// Device-local by design for now: syncing drafts into server-side profile
// data needs its own API surface.

const draftKey = (userId: string, targetId: string) => `tt-draft:${userId}:${targetId}`;

const SAVE_DEBOUNCE_MS = 350;

export const useCommentDraft = (
  userId: string | null | undefined,
  targetId: string
): {
  value: string;
  setValue: (next: string) => void;
  clear: () => void;
  // true once the stored draft (if any) has been loaded
  hydrated: boolean;
} => {
  const [value, setValueState] = React.useState('');
  const [hydrated, setHydrated] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = userId ? draftKey(userId, targetId) : null;

  React.useEffect(() => {
    let cancelled = false;
    if (!key) {
      setHydrated(true);
      return;
    }
    localforage
      .getItem<string>(key)
      .then((stored) => {
        if (cancelled) return;
        if (typeof stored === 'string' && stored) setValueState(stored);
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const setValue = React.useCallback(
    (next: string) => {
      setValueState(next);
      if (!key) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (next.trim()) {
          void localforage.setItem(key, next);
        } else {
          void localforage.removeItem(key);
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [key]
  );

  const clear = React.useCallback(() => {
    setValueState('');
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (key) void localforage.removeItem(key);
  }, [key]);

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return { value, setValue, clear, hydrated };
};
