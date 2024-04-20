import React from 'react';
import { Center, Text } from '@chakra-ui/react';

export const ReactiveRightNav = (props: any) => {
  const setNav = React.useCallback((active) => {
    setMr(active ? '0%' : '-100%');
    setNavActive(active);
  }, []);

  const [entered, setEntered] = React.useState(false);

  React.useEffect(() => {
    // react to mouse move event
    const listener = (event) => {
      const windowWidth = window.innerWidth;
      if (!entered) {
        if (event?.clientX >= windowWidth - 60) {
          setNav(true);
        } else if (event?.clientX <= windowWidth - 100) {
          setNav(false);
        }
      }
    };
    window.addEventListener('mousemove', listener);
    return () => {
      window.removeEventListener('mousemove', listener);
    };
  }, [setNav, entered]);

  const [navActive, setNavActive] = React.useState(false);

  // const defaultMr = '-100%'
  const defaultMr = '0%';

  const [mr, setMr] = React.useState(defaultMr);

  const navItems = React.useMemo(() => {
    return ['home', 'imagine', 'create', 'share'];
  }, []);

  return (
    <Center position="fixed" top={0} right={0} flexDirection="column" height="100%" marginRight={mr} transition="all 0.3s ease-in-out">
      <Center
        flexDirection="column"
        minWidth="600px"
        maxWidth="100%"
        height="85%"
        background="rgba(0, 0, 0, 0.01)"
        borderLeftRadius="40px"
        onMouseEnter={() => setEntered(true)}
        onMouseLeave={() => setEntered(false)}
        paddingX={100}
        paddingY={80}
      >
        {navItems.map((navItem, idx) => {
          return (
            <Text key={idx} as="h2" color="black" fontSize="30px" fontWeight="semibold" textTransform="capitalize" cursor="pointer" marginY="auto">
              {navItem}
            </Text>
          );
        })}
      </Center>
    </Center>
  );
};
