import React from 'react';
import { LOCAL_WORKSPACE_CHANGED } from './runtime.client';

/** Invalidation carries no content or authority. Re-read the active workspace,
 * coalescing bursts without remounting editors or replacing their draft state. */
export function useWorkspaceRefresh(refresh: () => void, enabled = true) {
 const latest = React.useRef(refresh); latest.current = refresh;
 React.useEffect(() => {
  if (!enabled) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => { clearTimeout(timer); timer = setTimeout(() => latest.current(), 50); };
  window.addEventListener(LOCAL_WORKSPACE_CHANGED, changed);
  return () => { clearTimeout(timer); window.removeEventListener(LOCAL_WORKSPACE_CHANGED, changed); };
 }, [enabled]);
}
