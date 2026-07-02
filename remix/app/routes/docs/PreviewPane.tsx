import React from 'react';
import { Box, Flex, Icon, IconButton, Text } from '@chakra-ui/react';
import { GripHorizontal, Minus, Plus } from 'lucide-react';

const PREVIEW_HEIGHT_STEP = 120;

const clampPreviewHeight = (height: number, minHeight: number, maxHeight: number) =>
  Math.min(maxHeight, Math.max(minHeight, height));

type PreviewFrameProps = {
  expanded?: boolean;
  height?: string;
  previewSrc: string;
  testId: string;
  title: string;
};

export function PreviewFrame({ expanded = false, height = '100%', previewSrc, testId, title }: PreviewFrameProps) {
  return (
    <iframe
      data-testid={testId}
      key={`${testId}-${previewSrc}`}
      src={previewSrc}
      title={`${title} preview`}
      allowFullScreen
      style={{
        border: 0,
        display: 'block',
        height: expanded ? 'calc(100vh - 56px)' : height,
        marginTop: expanded ? '56px' : 0,
        minHeight: 'inherit',
        width: '100%'
      }}
    />
  );
}

type ResizablePreviewPaneProps = {
  height: number;
  maxHeight?: number;
  minHeight?: number;
  onHeightChange: (height: number) => void;
  previewSrc: string;
  testId: string;
  title: string;
};

export function ResizablePreviewPane({
  height,
  maxHeight = 1100,
  minHeight = 240,
  onHeightChange,
  previewSrc,
  testId,
  title
}: ResizablePreviewPaneProps) {
  const resizePreview = React.useCallback(
    (nextHeight: number) => {
      onHeightChange(clampPreviewHeight(nextHeight, minHeight, maxHeight));
    },
    [maxHeight, minHeight, onHeightChange]
  );

  const startHeightResize = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();

      const startY = event.clientY;
      const startHeight = height;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        resizePreview(startHeight + moveEvent.clientY - startY);
      };

      const stopResize = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', stopResize);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', stopResize);
    },
    [height, resizePreview]
  );

  return (
    <Box bg="white" border="1px solid" borderColor="blackAlpha.200" borderRadius="sm" overflow="hidden">
      <Box h={`${height}px`} maxH={`${maxHeight}px`} minH={`${minHeight}px`} overflow="hidden">
        <PreviewFrame previewSrc={previewSrc} testId={testId} title={title} />
      </Box>
      <Flex
        align="center"
        bg="#f8fafc"
        borderTop="1px solid"
        borderColor="blackAlpha.200"
        gap={2}
        minH="34px"
        px={2}
      >
        <Box
          as="button"
          aria-label={`Resize ${title} preview height`}
          cursor="ns-resize"
          display="flex"
          flex="1"
          justifyContent="center"
          minW={0}
          onPointerDown={startHeightResize}
          py={1}
          type="button"
        >
          <Icon as={GripHorizontal} boxSize={4} color="gray.500" />
        </Box>
        <Text color="gray.500" flexShrink={0} fontSize="xs" fontFamily="mono">
          {height}px
        </Text>
        <IconButton
          aria-label={`Make ${title} preview shorter`}
          icon={<Icon as={Minus} boxSize={3.5} />}
          isDisabled={height <= minHeight}
          onClick={() => resizePreview(height - PREVIEW_HEIGHT_STEP)}
          size="xs"
          type="button"
          variant="ghost"
        />
        <IconButton
          aria-label={`Make ${title} preview taller`}
          icon={<Icon as={Plus} boxSize={3.5} />}
          isDisabled={height >= maxHeight}
          onClick={() => resizePreview(height + PREVIEW_HEIGHT_STEP)}
          size="xs"
          type="button"
          variant="ghost"
        />
      </Flex>
    </Box>
  );
}
