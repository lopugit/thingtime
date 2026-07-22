import React from 'react';

// Chakra's closeOnBlur closes a popover whenever focus leaves it — on mobile
// that includes dismissing the on-screen keyboard, which nukes pickers and
// composers with text fields mid-use (type in the reaction search, close the
// keyboard to see results, the whole picker vanishes). This replaces it:
// close only on a real tap/click outside the popover (capture-phase
// pointerdown), never on focus loss. Escape still closes via Chakra's own
// closeOnEsc. Attach the returned ref to the PopoverContent.
export const useOutsideTapClose = <T extends HTMLElement = HTMLDivElement>(isOpen: boolean, onClose: () => void) => {
  const ref = React.useRef<T | null>(null);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;

  React.useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const node = ref.current;
      if (!node || !(event.target instanceof Node) || node.contains(event.target)) return;

      // On touch, an outside tap while the on-screen keyboard is up (a text
      // field inside the popover is focused) should only dismiss the
      // keyboard — the popover stays open; the NEXT outside tap closes it.
      if (event.pointerType === 'touch') {
        const active = document.activeElement as HTMLElement | null;
        const keyboardOpen =
          !!active &&
          node.contains(active) &&
          (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
        if (keyboardOpen) {
          active.blur();
          return;
        }
      }

      closeRef.current();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [isOpen]);

  return ref;
};
