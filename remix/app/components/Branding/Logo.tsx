import { Box, Center, Code, Flex, Heading, Slider, SliderFilledTrack, SliderThumb, SliderTrack } from '@chakra-ui/react';
import React, { useMemo, useState } from 'react';
import { Editor as Edi } from '@monaco-editor/react';

export const Logo = (props: any = {}) => {
  const { voxelSize = 25, unit = 'px', theme = 'pink' } = props;

  const simpleMatrix = [
    [0, 7, 0],
    [7, 0, 7],
    [0, 8, 0]
  ];

  const fullLogoMatrix = [
    '111,020,030,000,000,070,030',
    '010,022,000,550,660,707,000,999,0xx',
    '010,022,040,550,660,080,040,999,0xx',
    '00000000000006',
    '00000000000066'
  ];

  const matrix = props?.matrix || (props.icon ? simpleMatrix : fullLogoMatrix);

  const defaultColours = {
    0: 'transparent',
    1: '#59ff9c',
    2: '#59bdff',
    3: '#00b7ef',
    4: '#ed1c24',
    5: '#ffa3b1',
    6: '#6f3198',
    7: '#a8e61d',
    8: '#9c5a3c',
    9: '#ffc20e',
    x: '#ff7e00'
  };

  const themes = {
    default: defaultColours,
    nature: defaultColours,
    tt: defaultColours,
    thingtime: defaultColours,
    pink: {
      0: 'transparent',
      1: 'hotpink',
      2: 'hotpink'
    }
  };

  const colourMap = props?.colourMap || (themes[theme] ? themes[theme] : themes.pink);

  const getColour = (col: string) => {
    const colour = colourMap[col];

    if (colour === 'random') {
      const filteredKeys = Object.keys(defaultColours).filter((key) => defaultColours[key] !== 'transparent');
      const filteredColours = {};
      filteredKeys.forEach((key) => {
        filteredColours[key] = defaultColours[key];
      });

      const randomKey = filteredKeys[Math.floor(Math.random() * filteredKeys.length)];
      return filteredColours[randomKey];
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
