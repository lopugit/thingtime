import React from 'react';
import { contextDockTop, contextLayoutHeight } from './contextViewport';

/** CSS fixed offsets use layout coordinates. WebKit already subtracts its
 * visual pan from client rects, so compensating that origin again hides UI. */
export function useContextViewportDock(ref: React.RefObject<HTMLDivElement>, active: boolean, gap = 0, onMeasure?: (height: number, reserved: number) => void) {
 React.useLayoutEffect(() => {
  const element = ref.current; if (!active || !element) return;
  let frame = 0;
  const align = () => {
   const layoutHeight = contextLayoutHeight(), viewport = window.visualViewport;
   const visible = viewport?.scale === 1 ? viewport : { offsetTop: 0, height: layoutHeight };
   const height = Math.ceil(element.getBoundingClientRect().height);
   const top = contextDockTop(visible, height, gap);
   element.style.top = `${top}px`;
   onMeasure?.(height, Math.max(height, Math.ceil(layoutHeight - element.getBoundingClientRect().top)));
  };
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(align); };
  const observer = new ResizeObserver(schedule); observer.observe(element);
  window.addEventListener('resize', schedule); window.visualViewport?.addEventListener('resize', schedule); window.visualViewport?.addEventListener('scroll', schedule); align();
  return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule); };
 }, [ref, active, gap, onMeasure]);
}
