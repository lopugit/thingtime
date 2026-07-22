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
      if (node && event.target instanceof Node && !node.contains(event.target)) {
        closeRef.current();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [isOpen]);

  return ref;
};
