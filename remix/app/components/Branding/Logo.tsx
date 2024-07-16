import { Box, Center, Flex, Slider, SliderFilledTrack, SliderThumb, SliderTrack } from '@chakra-ui/react';
import React, { useMemo, useState } from 'react';

export const Logo = () => {
  // a completely dynamic and interactive logo
  // uses borders, border radius, and colour themes to create a simple timeless beautiful logo

  // const defaultThemeRaw = ['white', '#F20009', '#FD5F00', '#FFEB03', '#52E013', '#09A7EC', '#982E77', 'white'];
  const defaultThemeRaw = ['#F20009', '#FD5F00', '#FFEB03', '#52E013', '#09A7EC', '#982E77', 'white'];

  const [reverseColours, setReverseColours] = useState(false);

  const defaultTheme = reverseColours ? defaultThemeRaw?.reverse() : defaultThemeRaw;

  const [theme, setTheme] = useState('blue');

  const [squares, setSquares] = useState(9);

  const [width, setWidth] = useState(250);

  const [height, setHeight] = useState(250);

  // logo is a T/plus shape made of two intersecting squares
  // you can toggle border sides on both squares to create different shapes

  const [borderWidth, setBorderWidth] = useState(18);

  const [borderRadius, setBorderRadius] = useState(12);

  const squaresArray = Array.from({ length: squares }, (_, index) => index);

  const [spacing, setSpacing] = useState(borderWidth);

  // log squaresArray
  console.debug('tt.squaresArray', squaresArray);

  // basically the 5 squares that make up a plus but with the centre one missing

  const [divisions, setDivisions] = useState(3);

  const [divisionHeight, setDivisionHeight] = useState(100 / divisions);

  const [divisionWidth, setDivisionWidth] = useState(100 / divisions);

  const uuid = useMemo(() => {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }, []);

  return (
    <>
      {/* these are the controls */}
      {/* border radius use chakra slider */}
      <Center py={12}>
        <Slider aria-label="slider-ex-1" defaultValue={borderRadius} onChange={setBorderRadius}>
          <SliderTrack>
            <SliderFilledTrack />
          </SliderTrack>
          <SliderThumb>🟡</SliderThumb>
        </Slider>
      </Center>
      <Box className="tt.logo" overflow="hidden" w={width + 'px'} h={height + 'px'} position="relative">
        {squaresArray.map((_, idx) => {
          // technically not even in programming terms cause it starts at 0 😂

          const humanIdx = idx + 1;

          const even = humanIdx % 2 === 0;

          const colourIndex = Math.round(idx / 2);

          // log the colourIndex
          console.debug('tt.colourIndex', colourIndex);

          return (
            <Box
              display="inline-block"
              key={`logo-${uuid}-${idx}`}
              bg={even ? defaultTheme[colourIndex] : 'rgba(0,0,0,0)'}
              w={`${divisionHeight}%`}
              h={`${divisionWidth}%`}
            ></Box>
          );
        })}
      </Box>
    </>
  );
};
