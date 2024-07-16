import { Box, Center, Flex, Slider, SliderFilledTrack, SliderThumb, SliderTrack } from '@chakra-ui/react';
import React, { useState } from 'react';

export const LogoOld2 = () => {
  // a completely dynamic and interactive logo
  // uses borders, border radius, and colour themes to create a simple timeless beautiful logo

  // const defaultThemeRaw = ['white', '#F20009', '#FD5F00', '#FFEB03', '#52E013', '#09A7EC', '#982E77', 'white'];
  const defaultThemeRaw = ['#F20009', '#FD5F00', '#FFEB03', '#52E013', '#09A7EC', '#982E77', 'white'];

  const [reverseColours, setReverseColours] = useState(false);

  const defaultTheme = reverseColours ? defaultThemeRaw?.reverse() : defaultThemeRaw;

  const [theme, setTheme] = useState('blue');

  const [squares, setSquares] = useState(8);

  const [width, setWidth] = useState(50);

  const [height, setHeight] = useState(50);

  // logo is a T/plus shape made of two intersecting squares
  // you can toggle border sides on both squares to create different shapes

  const [borderWidth, setBorderWidth] = useState(18);

  const [borderRadius, setBorderRadius] = useState(12);

  const squaresArray = Array.from({ length: squares }, (_, index) => index);

  const [spacing, setSpacing] = useState(borderWidth);

  // log squaresArray
  console.debug('tt.squaresArray', squaresArray);

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
      <Center overflow="hidden" w={width} h={height} position="relative">
        {/* border top left squares */}
        {squaresArray.map((_, index) => {
          const top = index * spacing;
          const left = index * spacing;
          const colour = defaultTheme[index];

          const square = (
            <Box
              zIndex={2}
              backgroundColor={colour}
              borderRadius={`${borderRadius}px`}
              className="logo-square"
              position={'absolute'}
              width={width}
              top={12}
              left={12}
              height={height}
              transform={`translateY(${top}px) translateX(${left}px)`}
            >
              {/* another box which acts as a mask */}

              {/* <Box
                backgroundColor={theme}
                borderRadius={`${borderRadius}px`}
                className="logo-square"
                position={'absolute'}
                width={width}
                top={12}
                left={12}
                height={height}
                top={`${top}px`}
                left={`${left}px`}
              /> */}
            </Box>
          );

          return square;
        })}

        {/* make squares for bottom right */}

        {squaresArray.map((_, index) => {
          const bottom = index * spacing + height * 2;
          const right = index * spacing + width * 2;
          const colour = defaultTheme[index];

          const square = (
            <Box
              zIndex={1}
              backgroundColor={colour}
              borderRadius={`${borderRadius}px`}
              className="logo-square"
              position={'absolute'}
              width={width}
              top={14}
              left={14}
              height={height}
              transform={`translateY(${-bottom}px) translateX(${-right}px)`}
            >
              {/* another box which acts as a mask */}

              {/* <Box
                backgroundColor={theme}
                borderRadius={`${borderRadius}px`}
                className="logo-square"
                position={'absolute'}
                width={width}
                height={height}
                top={`${top}px`}
                left={`${left}px`}
              /> */}
            </Box>
          );

          return square;
        })}
      </Center>
    </>
  );
};
