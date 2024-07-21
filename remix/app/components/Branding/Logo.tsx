import { Box, Center, Flex, Heading, Slider, SliderFilledTrack, SliderThumb, SliderTrack } from '@chakra-ui/react';
import React, { useMemo, useState } from 'react';

export const Logo = (props) => {
  // a completely dynamic and interactive logo
  // uses borders, border radius, and colour themes to create a simple timeless beautiful logo

  // const defaultThemeRaw = ['white', '#F20009', '#FD5F00', '#FFEB03', '#52E013', '#09A7EC', '#982E77', 'white'];
  const defaultThemeRaw = ['#F20009', '#FD5F00', '#FFEB03', '#52E013', '#09A7EC', '#982E77', 'white'];

  const [reverseColours, setReverseColours] = useState(false);

  const defaultTheme = reverseColours ? defaultThemeRaw?.reverse() : defaultThemeRaw;

  const [theme, setTheme] = useState('blue');

  const [squares, setSquares] = useState(9);

  const initialWidth = props?.width || 300;

  const [width, setWidth] = useState(initialWidth);

  // logo is a T/plus shape made of two intersecting squares
  // you can toggle border sides on both squares to create different shapes

  const [borderWidth, setBorderWidth] = useState(18);

  const [borderRadius, setBorderRadius] = useState(0);

  const [padding, setPadding] = useState(0);

  const squaresArray = Array.from({ length: squares }, (_, index) => index);

  const [spacing, setSpacing] = useState(borderWidth);

  // log squaresArray
  console.debug('tt.squaresArray', squaresArray);

  // basically the 5 squares that make up a plus but with the centre one missing

  const [divisions, setDivisions] = useState(3);

  const [boxWidth, setBoxWidth] = useState(100 / divisions + '%');

  const uuid = useMemo(() => {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }, []);

  const boxStyles = {
    padding: `${padding}px`
  };

  const InnerBox = (props: any = {}) => <Box borderRadius={`${borderRadius}px`} background="hotpink" w="100%" h="100%" {...props}></Box>;

  const Square = (props: any = {}) => (
    <Box {...boxStyles} display="inline-block" w={boxWidth} h={boxWidth}>
      <InnerBox {...props}></InnerBox>
    </Box>
  );

  return (
    <>
      {/* these are the controls */}
      {/* border radius use chakra slider */}
      {props?.editable && (
        <Flex pb={12} flexDir={'column'}>
          <Heading my={4} as="h2" size="md">
            Logo Controls
          </Heading>
          <Heading my={4} as="h3" size="sm">
            Width {width}px
          </Heading>
          <Slider aria-label="slider-ex-1" defaultValue={width} min={0} max={initialWidth * 10} onChange={setWidth}>
            <SliderTrack>
              <SliderFilledTrack />
            </SliderTrack>
            <SliderThumb>🟡</SliderThumb>
          </Slider>
          <Heading my={4} as="h3" size="sm">
            Border Radius {borderRadius}px
          </Heading>
          <Slider aria-label="slider-ex-1" defaultValue={borderRadius} min={0} max={width} onChange={setBorderRadius}>
            <SliderTrack>
              <SliderFilledTrack />
            </SliderTrack>
            <SliderThumb>🟡</SliderThumb>
          </Slider>
          <Heading my={4} as="h3" size="sm">
            Padding {padding}px
          </Heading>
          <Slider aria-label="slider-ex-1" defaultValue={padding} min={0} max={width} onChange={setPadding}>
            <SliderTrack>
              <SliderFilledTrack />
            </SliderTrack>
            <SliderThumb>🟡</SliderThumb>
          </Slider>
        </Flex>
      )}
      <Box className="tt.logo" fontSize={0} overflow="hidden" w={width + 'px'} h={width + 'px'} position="relative">
        {squaresArray.map((_, index) => {
          const odd = index % 2 === 0;
          const even = !odd;
          return <Square key={uuid + 'tt.logo' + index} bg={even ? 'hotpink' : 'transparent'} />;
        })}
      </Box>
    </>
  );
};
