import React from 'react';
import { Flex } from '@chakra-ui/react';

export const RainbowSkeleton = (props: any) => {
  const [rainbowColours] = React.useState(['#f34a4a', '#ffbc48', '#58ca70', '#47b5e6', '#a555e8']);

  const keyframes = React.useMemo(() => {
    const keyframes = {};
    rainbowColours.forEach((colour, idx) => {
      keyframes[Math.round((idx * 100) / rainbowColours.length) + '%'] = {
        backgroundColor: colour
      };
    });
    keyframes['100%'] = { backgroundColor: rainbowColours[0] };
    return keyframes;
  }, [rainbowColours]);

  if (props?.loaded) {
    return props?.children;
  }

  return (
    <Flex
      sx={{
        '@keyframes placeholder-rainbow': keyframes,
        '@keyframes placeholder-opacity': {
          '0%': { opacity: 0.2 },
          '100%': { opacity: 1 }
        },
        // add delay
        animation: `placeholder-rainbow 8s infinite linear, placeholder-opacity 1.3s linear 0s infinite alternate none running}`
      }}
      width="10px"
      height="8px"
      borderRadius="2px"
      cursor="pointer"
      {...props}
    ></Flex>
  );
};
