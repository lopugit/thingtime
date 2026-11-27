import React from 'react';
import { Box } from '@chakra-ui/react';
import { DRAWER_Z } from '../Nav/Drawer/useDrawer';
import { useContextViewportDock } from './useContextViewportDock';

/** Keep a context's existing controls above its toolbar/keyboard while
 * retaining their measured space and width in the scrolling document. */
export function ContextActionDock({ active, bottomOffset, children }: { active: boolean; bottomOffset?: number; children: React.ReactNode }) {
 const anchor = React.useRef<HTMLDivElement>(null), controls = React.useRef<HTMLDivElement>(null);
 const [bounds, setBounds] = React.useState<{ left: number; width: number; height: number } | null>(null);
 useContextViewportDock(controls, active && !!bounds, bottomOffset);
 React.useLayoutEffect(() => {
  if (!active || !anchor.current || !controls.current) return;
  const measure = () => {
   const rect = anchor.current!.getBoundingClientRect(), height = Math.ceil(controls.current!.getBoundingClientRect().height);
   setBounds(previous => previous?.left === rect.left && previous.width === rect.width && previous.height === height ? previous : { left: rect.left, width: rect.width, height });
  };
  const observer = new ResizeObserver(measure); observer.observe(anchor.current); observer.observe(controls.current);
  window.addEventListener('resize', measure); window.addEventListener('scroll', measure, { passive: true }); measure();
  return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure); };
 }, [active]);
 if (!active) return <>{children}</>;
 return <Box ref={anchor} minH={bounds ? `${bounds.height}px` : undefined}>
  <Box data-context-dock ref={controls} position={bounds ? 'fixed' : undefined} left={bounds ? `${bounds.left}px` : undefined} width={bounds ? `${bounds.width}px` : undefined} zIndex={DRAWER_Z - 1}>{children}</Box>
 </Box>;
}
