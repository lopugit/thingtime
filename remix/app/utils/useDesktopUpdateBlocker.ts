import React from 'react';
import { desktopBundleSafety } from './desktopBundleSafety';

/** Volatile drafts and active jobs deliberately cannot certify a durable save. */
export function useDesktopUpdateBlocker(blocked: boolean) {
  const current = React.useRef(blocked); current.current = blocked;
  React.useLayoutEffect(() => desktopBundleSafety.register({ kind: 'work', ready: () => !current.current }), []);
  React.useLayoutEffect(() => { desktopBundleSafety.changed(); }, [blocked]);
}
