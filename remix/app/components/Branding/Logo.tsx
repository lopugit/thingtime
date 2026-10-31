import { Box, Flex } from '@chakra-ui/react';
import React from 'react';

import brandingAssets from './brandingAssets.generated.json';
import { LOGO_DEFAULT_COLOURS, LOGO_FULL_MATRIX, LOGO_ICON_MATRIX, LOGO_THEMES } from './logoMatrix';

// Which committed /branding/generated variant draws the same pixels as a
// given DOM logo. Only the stock matrices + named themes have files; a custom
// matrix or colour map renders voxels alone (nothing crawlable to point at).
const DEFAULT_FAMILY_THEMES = new Set(['default', 'nature', 'tt', 'thingtime']);

type GeneratedVariant = { slug: string; aspect: { cols: number; rows: number }; svg: { url: string }; pngs: Array<{ w: number; h: number; url: string }> };

const generatedVariantFor = (props: { matrix?: unknown; colourMap?: unknown; icon?: boolean; theme?: string }): GeneratedVariant | null => {
  if (props.matrix || props.colourMap) return null;
  const family = DEFAULT_FAMILY_THEMES.has(props.theme || '') ? '' : props.theme === 'pink' ? '-pink' : null;
  if (family === null) return null;
  const slug = `${props.icon ? 'icon' : 'logo'}${family}`;
  return (brandingAssets.variants as GeneratedVariant[]).find((variant) => variant.slug === slug) ?? null;
};

export const Logo = (props: any = {}) => {
  const { voxelSize = 25, unit = 'px', theme = 'pink' } = props;

  // matrices + themes live in logoMatrix.ts so the DOM logo, the /branding
  // SVG previews, and PNG exports all render from one data source
  const matrix = props?.matrix || (props.icon ? LOGO_ICON_MATRIX : LOGO_FULL_MATRIX);

  const colourMap = props?.colourMap || (LOGO_THEMES[theme] ? LOGO_THEMES[theme] : LOGO_THEMES.pink);

  const getColour = (col: string) => {
    const colour = colourMap[col];

    if (colour === 'random') {
      const filteredKeys = Object.keys(LOGO_DEFAULT_COLOURS).filter((key) => LOGO_DEFAULT_COLOURS[key] !== 'transparent');
      const randomKey = filteredKeys[Math.floor(Math.random() * filteredKeys.length)];
      return LOGO_DEFAULT_COLOURS[randomKey];
    }

    return colour || colourMap[1];
  };

  // Crawlable twin (claude-todo brand SEO): the voxel grid is plain <div>s, so
  // image search never sees a logo on the landing page or the nav. When the
  // committed asset for this exact variant exists, a real <img> of the same
  // trimmed artwork sits directly underneath the grid at the same size — it
  // is visible content (not display:none), just fully covered by identical
  // pixels — so Google can index the file while hover states stay live.
  const generated = generatedVariantFor({ matrix: props?.matrix, colourMap: props?.colourMap, icon: props?.icon, theme });
  const crawlable = generated ? generated.pngs.find((png) => png.w === 1024) ?? generated.pngs[generated.pngs.length - 1] : null;

  return (
    <Box my={8} opacity={props?.opacity} m={props?.space} p={props?.space}>
      {/* use the matrix to create a pixel image using the colour maps */}

      <Flex flexDir="column" position="relative" width="fit-content">
        {crawlable ? (
          <img
            src={crawlable.url}
            alt={props?.alt ?? (props?.icon ? 'Thingtime icon — the five-voxel tree logo mark' : 'Thingtime logo — colourful voxel wordmark')}
            width={crawlable.w}
            height={crawlable.h}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              imageRendering: 'pixelated',
              pointerEvents: 'none',
              userSelect: 'none'
            }}
          />
        ) : null}
        {matrix?.map((row: any, rowIndex) => {
          const rowIterator = row instanceof Array ? row : Array.from(row);

          const rowEls = rowIterator?.map((col, colIndex) => {
            if (col === ',') {
              return null;
            }

            return (
              <Box
                flexShrink={0}
                _hover={{ opacity: '0.5', cursor: 'pointer' }}
                transition={'all 250ms ease'}
                w={voxelSize + unit}
                h={voxelSize + unit}
                bg={getColour(col)}
                key={colIndex}
                // rainbow border
                // border={'1px solid rgba(0,0,0,0.1)'}
              />
            );
          });

          return (
            <Flex data-row={'logo-row-' + rowIndex} key={rowIndex} flexDir="row" position="relative">
              {rowEls?.filter((el) => el)}
            </Flex>
          );
        })}
      </Flex>
    </Box>
  );
};
