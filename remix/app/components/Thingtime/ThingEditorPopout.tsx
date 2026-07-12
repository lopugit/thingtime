import React from 'react';
import { createPortal } from 'react-dom';
import { Box, Flex, IconButton, Text } from '@chakra-ui/react';
import { X } from 'lucide-react';

import { EditorSplit, startPointerGesture } from './EditorSplit';

// A popped-out thing editor: a portal'd, viewport-fixed frame holding its own
// embedded EditorSplit over the same store path as whatever spawned it — both
// stay live-synced through the shared thingtime store, so "pop out" duplicates
// the editing surface instead of stealing it. The frame drags by its header
// and resizes by its corner (pointer events, so touch works); the EditorSplit
// inside splits/floats/re-docks like the real /editor.

// below EditorSplit's FLOATING_Z_INDEX (1250): frames popped out from INSIDE
// this window must layer above its shell
const POPOUT_Z_INDEX = 1240;

const DEFAULT_WIDTH = 760;
const DEFAULT_HEIGHT = 540;

export type ThingEditorPopoutProps = {
  path: string;
  title?: string;
  onClose: () => void;
};

export const ThingEditorPopout = (props: ThingEditorPopoutProps) => {
  const { path, title, onClose } = props;

  const [geometry, setGeometry] = React.useState(() => {
    const width = Math.min(DEFAULT_WIDTH, typeof window !== 'undefined' ? window.innerWidth - 24 : DEFAULT_WIDTH);
    const height = Math.min(DEFAULT_HEIGHT, typeof window !== 'undefined' ? window.innerHeight - 24 : DEFAULT_HEIGHT);
    return {
      x: typeof window !== 'undefined' ? Math.max(12, (window.innerWidth - width) / 2) : 60,
      y: typeof window !== 'undefined' ? Math.max(12, (window.innerHeight - height) / 2) : 60,
      width,
      height
    };
  });

  const startDrag = (e: React.PointerEvent) => {
    // header buttons keep their clicks
    if ((e.target as HTMLElement)?.closest?.('button')) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { x: geometry.x, y: geometry.y };
    startPointerGesture(e, (move) => {
      setGeometry((prev) => ({
        ...prev,
        // keep at least the header reachable so the window can't be lost
        x: Math.min(Math.max(origin.x + move.clientX - startX, 48 - prev.width), window.innerWidth - 48),
        y: Math.min(Math.max(origin.y + move.clientY - startY, 0), window.innerHeight - 40)
      }));
    });
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { width: geometry.width, height: geometry.height };
    startPointerGesture(e, (move) => {
      setGeometry((prev) => ({
        ...prev,
        width: Math.max(320, origin.width + move.clientX - startX),
        height: Math.max(220, origin.height + move.clientY - startY)
      }));
    });
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <Flex
      className="tt-thing-editor-popout"
      position="fixed"
      left={`${geometry.x}px`}
      top={`${geometry.y}px`}
      width={`${geometry.width}px`}
      height={`${geometry.height}px`}
      zIndex={POPOUT_Z_INDEX}
      flexDirection="column"
      background="var(--tt-card, #ffffff)"
      border="1px solid var(--tt-border, #ececef)"
      borderRadius="var(--tt-radius-md, 12px)"
      boxShadow="var(--tt-shadow-panel, 0 24px 60px -28px rgba(20, 20, 40, 0.28))"
      overflow="hidden"
    >
      <Flex
        alignItems="center"
        columnGap={2}
        paddingX={3}
        height="38px"
        flexShrink={0}
        borderBottom="1px solid var(--tt-border, #ececef)"
        background="var(--tt-surface, #fafafb)"
        cursor="grab"
        sx={{ touchAction: 'none' }}
        onPointerDown={startDrag}
      >
        <Text
          fontFamily="mono"
          fontSize="11px"
          fontWeight={600}
          letterSpacing="0.06em"
          textTransform="uppercase"
          color="var(--tt-muted, #9a9aa6)"
          noOfLines={1}
        >
          {title || `${path} · editor 🌀`}
        </Text>
        <IconButton
          aria-label="Close editor popout"
          icon={<X size={14} />}
          size="xs"
          variant="ghost"
          marginLeft="auto"
          color="var(--tt-muted, #9a9aa6)"
          borderRadius="8px"
          onClick={onClose}
        />
      </Flex>

      <Box flex="1" minHeight={0} padding={2}>
        <EditorSplit initialPath={path} embedded height="100%" />
      </Box>

      <Box
        aria-hidden
        position="absolute"
        right="1px"
        bottom="1px"
        width="16px"
        height="16px"
        cursor="nwse-resize"
        color="var(--tt-faint, #b6b6c0)"
        sx={{ touchAction: 'none' }}
        title="Drag to resize"
        onPointerDown={startResize}
      >
        <svg viewBox="0 0 14 14" width="14" height="14">
          <path d="M12 6 L6 12 M12 10 L10 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        </svg>
      </Box>
    </Flex>,
    document.body
  );
};
