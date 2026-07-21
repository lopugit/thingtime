import { Box, Button, Flex, Select, Text } from '@chakra-ui/react';
import React from 'react';

import { useLopu } from '~/components/Lopu/useLopu';
import { buildLogoSvg } from './logoMatrix';
import type { LogoColourMap, LogoMatrix } from './logoMatrix';

// SVG → PNG export card for one logo variant (claude-todo/08 §3). Everything
// happens client-side: the shared matrix builds an SVG, the SVG renders as the
// preview <img>, and PNG export rasterises that same SVG through a canvas at
// the chosen size — one data source for screen and files.

const PNG_SIZES = [256, 512, 1024, 2048];

const triggerDownload = (url: string, filename: string) => {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
};

export const LogoExport = ({
  name,
  slug,
  matrix,
  colourMap,
  background
}: {
  name: string;
  slug: string;
  matrix: LogoMatrix;
  colourMap: LogoColourMap;
  background?: string;
}) => {
  const lopu = useLopu();
  const [pngSize, setPngSize] = React.useState(1024);

  const { svg, columns, rows } = React.useMemo(
    () => buildLogoSvg({ matrix, colourMap, background }),
    [matrix, colourMap, background]
  );
  const svgDataUri = React.useMemo(() => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, [svg]);

  const downloadSvg = () => {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `thingtime-${slug}.svg`);
    URL.revokeObjectURL(url);
  };

  const downloadPng = () => {
    const width = pngSize;
    const height = Math.round((pngSize / columns) * rows);
    const image = new Image();
    const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
    const svgUrl = URL.createObjectURL(svgBlob);

    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas 2D context unavailable');
        context.imageSmoothingEnabled = false;
        context.drawImage(image, 0, 0, width, height);
        canvas.toBlob((pngBlob) => {
          URL.revokeObjectURL(svgUrl);
          if (!pngBlob) {
            lopu({ title: 'PNG export failed', description: `The PNG could not be rendered for ${name} 🥺`, status: 'error' });
            return;
          }
          const pngUrl = URL.createObjectURL(pngBlob);
          triggerDownload(pngUrl, `thingtime-${slug}-${width}x${height}.png`);
          URL.revokeObjectURL(pngUrl);
        }, 'image/png');
      } catch (err) {
        URL.revokeObjectURL(svgUrl);
        lopu({
          title: 'PNG export failed',
          description: `The export hit a snag: ${err instanceof Error ? err.message : String(err)} 🥺`,
          status: 'error'
        });
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      lopu({ title: 'PNG export failed', description: `The SVG could not be loaded for rasterising ${name} 🥺`, status: 'error' });
    };
    image.src = svgUrl;
  };

  return (
    <Flex
      flexDir="column"
      gap={3}
      p={5}
      border="1px solid var(--tt-border, rgba(0, 0, 0, 0.08))"
      borderRadius="12px"
      bg="var(--tt-surface, #fff)"
      minW={0}
    >
      <Text fontFamily="mono" fontSize="11px" fontWeight={600} letterSpacing="0.1em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)">
        {name}
      </Text>
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        py={6}
        borderRadius="8px"
        // checkerboard so transparent voxels read as transparent
        bgImage="repeating-conic-gradient(rgba(0,0,0,0.05) 0% 25%, transparent 0% 50%)"
        bgSize="16px 16px"
      >
        <img src={svgDataUri} alt={`${name} logo`} style={{ imageRendering: 'pixelated', width: `${columns * 24}px`, maxWidth: '100%' }} />
      </Box>
      <Flex gap={2} flexWrap="wrap" alignItems="center">
        <Button size="sm" variant="outline" onClick={downloadSvg} data-testid={`download-svg-${slug}`}>
          SVG
        </Button>
        <Button size="sm" variant="outline" onClick={downloadPng} data-testid={`download-png-${slug}`}>
          PNG
        </Button>
        <Select size="sm" width="auto" value={pngSize} onChange={(event) => setPngSize(Number(event.target.value))} aria-label="PNG width">
          {PNG_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}px
            </option>
          ))}
        </Select>
      </Flex>
    </Flex>
  );
};
