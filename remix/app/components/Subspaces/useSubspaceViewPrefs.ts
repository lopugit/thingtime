import React from 'react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { normalizeSubspaceViewPrefs, readSubspaceViewPrefs, subspaceViewPrefsKey, type SubspaceViewPrefs } from './subspaceViewPrefs';

const storage = () => { try { return window.localStorage; } catch { return undefined; } };
export function useSubspaceViewPrefs(subspaceId: string) {
  const user = useCurrentUser();
  const dataPlane = useDataPlane();
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const key = subspaceViewPrefsKey({ origin, dataPlane, viewerId: user?.id || null, subspaceId });
  const [state, setState] = React.useState(() => ({ key, prefs: readSubspaceViewPrefs(storage(), key) }));
  // Derive the new scope synchronously so the old viewer's preference cannot
  // paint for even one frame before the subscription effect changes.
  const prefs = state.key === key ? state.prefs : readSubspaceViewPrefs(storage(), key);
  React.useEffect(() => {
    setState({ key, prefs: readSubspaceViewPrefs(storage(), key) });
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setState({ key, prefs: readSubspaceViewPrefs(storage(), key) });
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [key]);
  const update = React.useCallback((patch: Partial<SubspaceViewPrefs>) => {
    setState(previous => {
      const next = normalizeSubspaceViewPrefs({ ...(previous.key === key ? previous.prefs : readSubspaceViewPrefs(storage(), key)), ...patch });
      try { storage()?.setItem(key, JSON.stringify(next)); } catch { /* keep usable in memory when storage is unavailable */ }
      return { key, prefs: next };
    });
  }, [key]);
  return { prefs, update, scopeKey: key };
}
