import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@chakra-ui/react';

// The reaction button + picker opener shared by posts and comments. The picker
// popover is CONTROLLED so every input works:
//   desktop  — hover opens it (small delay), leaving both sides closes it
//   mobile   — touch-and-hold (~400ms) opens it; a plain tap quick-reacts
//   keyboard — Enter/Space quick-reacts
// Chakra's trigger="hover" never fires on touch, which is why this exists.
//
// `trigger` is cloned with the press/hover handlers; `content` renders inside
// the popover and receives close() so picking an emoji can dismiss it.

const BORDER = '1px solid var(--tt-border, #ececef)';

const LONG_PRESS_MS = 400;
const HOVER_OPEN_MS = 150;
const HOVER_CLOSE_MS = 250;

export type ReactionControlProps = {
  // cloned as the popover trigger; its own onClick is replaced by onQuickTap
  trigger: React.ReactElement;
  // popover body — receives close() for dismissing after a pick
  content: (close: () => void) => React.ReactNode;
  // a plain tap/click on the trigger (not a long-press)
  onQuickTap: () => void;
  // guests skip the picker entirely — onQuickTap still fires (login nudge)
  enabled?: boolean;
};

export const ReactionControl = (props: ReactionControlProps) => {
  const { trigger, content, onQuickTap, enabled = true } = props;

  const [isOpen, setIsOpen] = React.useState(false);

  const pressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = React.useRef(false);
  // a touch sequence also fires synthetic mouseenter/click — ignore hover
  // logic while a touch interaction is in flight
  const touchActiveRef = React.useRef(false);

  const clearTimer = (ref: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) => {
    if (ref.current) {
      clearTimeout(ref.current);
      ref.current = null;
    }
  };

  React.useEffect(
    () => () => {
      clearTimer(pressTimerRef);
      clearTimer(hoverTimerRef);
    },
    []
  );

  const open = () => setIsOpen(true);
  // cancel any pending hover/press timer so a queued open can't undo the close
  const close = () => {
    clearTimer(hoverTimerRef);
    clearTimer(pressTimerRef);
    setIsOpen(false);
  };

  const handleTouchStart = () => {
    touchActiveRef.current = true;
    longPressFiredRef.current = false;
    clearTimer(pressTimerRef);
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      longPressFiredRef.current = true;
      try {
        navigator.vibrate?.(10);
      } catch {
        // haptics are best-effort
      }
      open();
    }, LONG_PRESS_MS);
  };

  const endTouch = () => {
    clearTimer(pressTimerRef);
    // let the synthetic click (which follows touchend) see the flags first
    setTimeout(() => {
      touchActiveRef.current = false;
    }, 500);
  };

  const handleClick = (event: React.MouseEvent) => {
    if (longPressFiredRef.current) {
      // this click is the tail of the long-press — the picker is open
      longPressFiredRef.current = false;
      event.preventDefault();
      return;
    }
    close();
    onQuickTap();
  };

  const hoverEnabled = () =>
    !touchActiveRef.current && typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches;

  const handleMouseEnter = () => {
    if (!hoverEnabled()) return;
    clearTimer(hoverTimerRef);
    hoverTimerRef.current = setTimeout(open, HOVER_OPEN_MS);
  };

  const handleMouseLeave = () => {
    clearTimer(hoverTimerRef);
    if (!hoverEnabled()) return;
    hoverTimerRef.current = setTimeout(close, HOVER_CLOSE_MS);
  };

  const clonedTrigger = React.cloneElement(trigger, {
    onClick: handleClick,
    onTouchStart: enabled ? handleTouchStart : undefined,
    onTouchEnd: enabled ? endTouch : undefined,
    onTouchMove: enabled ? endTouch : undefined,
    onTouchCancel: enabled ? endTouch : undefined,
    onMouseEnter: enabled ? handleMouseEnter : undefined,
    onMouseLeave: enabled ? handleMouseLeave : undefined,
    onContextMenu: enabled ? (event: React.MouseEvent) => event.preventDefault() : undefined,
    style: {
      ...(trigger.props as any)?.style,
      // stop iOS text-selection/callout hijacking the long-press
      WebkitTouchCallout: 'none',
      WebkitUserSelect: 'none',
      userSelect: 'none',
      touchAction: 'manipulation'
    }
  } as any);

  if (!enabled) return clonedTrigger;

  return (
    <Popover isOpen={isOpen} onClose={close} placement="top" isLazy autoFocus={false}>
      <PopoverTrigger>{clonedTrigger}</PopoverTrigger>
      <PopoverContent
        width="auto"
        border={BORDER}
        borderRadius="999px"
        boxShadow="var(--tt-shadow-panel, 0px 18px 60px rgba(0, 0, 0, 0.22))"
        zIndex={10}
        _focusVisible={{ outline: 'none' }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {content(close)}
      </PopoverContent>
    </Popover>
  );
};
