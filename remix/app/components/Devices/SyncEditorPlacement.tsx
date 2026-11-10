import React from 'react';
import { createPortal } from 'react-dom';

/** Move a stable portal container beside its selected folder. The form's React
 * identity and incomplete input state survive selection and DOM placement. */
export function SyncEditorPlacement({ targetId, children }: { targetId?: string; children: React.ReactNode }) {
 const fallback = React.useRef<HTMLDivElement>(null);
 const stableContainer = React.useRef<HTMLDivElement | null>(null);
 const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
 React.useLayoutEffect(() => {
  const element = stableContainer.current ??= document.createElement('div');
  const target = (targetId && document.getElementById(targetId)) || fallback.current;
  target?.appendChild(element);
  setContainer(element);
  return () => element.remove();
 }, [targetId]);
 return <><div ref={fallback} />{container ? createPortal(children, container) : null}</>;
}
