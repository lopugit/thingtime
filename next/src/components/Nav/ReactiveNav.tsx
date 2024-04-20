import React from 'react';
import { Flex } from '@chakra-ui/react';

import { Attention } from '../Buttons/Attention';
import { Hamburger } from '../Buttons/Hamburger';
import { RightNav } from './ReactiveRightNav';

export const ReactiveNav = (props: any) => {
  const [navItems] = React.useState([{}]);

  const setNav = React.useCallback((active) => {
    setMt(active ? '100%' : '0%');
    setNavActive(active);
  }, []);

  React.useEffect(() => {
    // react to mouse move event
    const listener = (event) => {
      if (event?.clientY <= 20) {
        setNav(true);
      } else if (event?.clientY >= 100) {
        setNav(false);
      }
    };
    window.addEventListener('mousemove', listener);
    return () => {
      window.removeEventListener('mousemove', listener);
    };
  }, [setNav]);

  const [navActive, setNavActive] = React.useState(false);

  const [mt, setMt] = React.useState('0%');

  return (
    <>
      <Flex
        as="nav"
        position="fixed"
        right={0}
        bottom="100%"
        left={0}
        alignItems="center"
        justifyContent="center"
        flexDirection="row"
        width="100%"
        transform={`translateY(${mt})`}
        transition="all 0.3s ease-in-out"
        // top={'100%'}
        // top={0}
        paddingX="1%"
        paddingY="1%"
      >
        <Hamburger marginLeft="auto"></Hamburger>
        <Flex position="absolute" top="100%" left="50%" opacity={navActive ? 0 : 1} transition="all 0.2s ease-in-out" translateX="-50%">
          {/* w={navActive ? '0px' : '40px'} */}
          <Attention></Attention>
        </Flex>
      </Flex>
      <RightNav></RightNav>
    </>
  );
};
