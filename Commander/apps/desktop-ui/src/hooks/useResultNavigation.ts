import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

// A tap always advances exactly one row. Holding starts promptly, then ramps
// from 12.5 to 40 rows/second without depending on macOS's key-repeat settings.
const holdDelayMs = 180;
function repeatInterval(elapsedMs: number): number {
  return Math.max(25, 80 - Math.max(0, elapsedMs - holdDelayMs) * 0.055);
}

type Direction = -1 | 1;
interface NavigationOptions {
  selectedIndex: number;
  rowCount: number;
  setSelectedIndex(index: number): void;
  enabled: boolean;
  scope: readonly unknown[];
  ownsTarget(target: EventTarget | null): boolean;
}

export function useResultNavigation(options: NavigationOptions) {
  const latest = useRef(options);
  const index = useRef(options.selectedIndex);
  const held = useRef<{ direction: Direction; startedAt: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const stop = useCallback(() => {
    held.current = null;
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  useLayoutEffect(() => {
    latest.current = options;
    index.current = Math.max(0, Math.min(options.selectedIndex, options.rowCount - 1));
    if (index.current !== options.selectedIndex) options.setSelectedIndex(index.current);
  });

  // Result replacement, typing, menus and view changes end the gesture. Native
  // repeat keydowns cannot restart it; a fresh physical press is required.
  useLayoutEffect(() => stop, [stop, options.enabled, ...options.scope]);

  const move = useCallback((direction: Direction) => {
    const current = latest.current;
    const next = Math.max(0, Math.min(current.rowCount - 1, index.current + direction));
    if (next === index.current || !current.rowCount) return false;
    index.current = next;
    current.setSelectedIndex(next);
    return true;
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      const direction: Direction | null = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : null;
      const current = latest.current;
      if (
        !direction ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !current.enabled ||
        !current.ownsTarget(event.target)
      ) {
        stop();
        return false;
      }
      event.preventDefault();
      // Our clock owns repeat. Counting OS repeat events too causes jumps and
      // makes acceleration depend on the user's system keyboard preferences.
      if (event.repeat) return true;
      stop();
      if (!move(direction)) return true;
      const gesture = { direction, startedAt: performance.now() };
      held.current = gesture;
      const repeat = () => {
        timer.current = undefined;
        if (held.current !== gesture || !latest.current.enabled || document.hidden) {
          stop();
          return;
        }
        if (!move(gesture.direction)) {
          stop();
          return;
        }
        // Schedule from now, never replay missed ticks after a busy frame.
        timer.current = window.setTimeout(repeat, repeatInterval(performance.now() - gesture.startedAt));
      };
      timer.current = window.setTimeout(repeat, holdDelayMs);
      return true;
    },
    [move, stop],
  );

  useEffect(() => {
    const release = (event: KeyboardEvent) => {
      if (
        (event.key === 'ArrowDown' && held.current?.direction === 1) ||
        (event.key === 'ArrowUp' && held.current?.direction === -1)
      )
        stop();
    };
    const visibility = () => {
      if (document.hidden) stop();
    };
    window.addEventListener('keyup', release, true);
    window.addEventListener('blur', stop);
    window.addEventListener('focusin', stop);
    window.addEventListener('pointerdown', stop, true);
    window.addEventListener('compositionstart', stop, true);
    window.addEventListener('commander:launcher-opened', stop);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stop();
      window.removeEventListener('keyup', release, true);
      window.removeEventListener('blur', stop);
      window.removeEventListener('focusin', stop);
      window.removeEventListener('pointerdown', stop, true);
      window.removeEventListener('compositionstart', stop, true);
      window.removeEventListener('commander:launcher-opened', stop);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [stop]);

  const select = useCallback(
    (next: number) => {
      stop();
      index.current = next;
      latest.current.setSelectedIndex(next);
    },
    [stop],
  );

  return { index, handleKeyDown, stop, select };
}
