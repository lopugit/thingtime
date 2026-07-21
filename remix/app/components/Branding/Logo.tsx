import { Box, Center, Code, Flex, Heading, Slider, SliderFilledTrack, SliderThumb, SliderTrack } from '@chakra-ui/react';
import React, { useMemo, useState } from 'react';
import { Editor as Edi } from '@monaco-editor/react';

import { LOGO_DEFAULT_COLOURS, LOGO_FULL_MATRIX, LOGO_ICON_MATRIX, LOGO_THEMES } from './logoMatrix';

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

  return (
    <Box my={8} opacity={props?.opacity} m={props?.space} p={props?.space}>
      {/* <Edi></Edi> */}
      {/* use the matrix to create a pixel image using the colour maps */}

      <Flex flexDir="column">
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
            <Flex data-row={'logo-row-' + rowIndex} key={rowIndex} flexDir="row">
              {rowEls?.filter((el) => el)}
            </Flex>
          );
        })}
      </Flex>
    </Box>
  );
};
