import { Box, Flex } from '@chakra-ui/react';

import { Footer } from '../Nav/Footer';
import { Nav } from '../Nav/Nav';
import { ProfileDrawer } from '../Nav/ProfileDrawer';

export const Main = (props) => {
  return (
    <Flex
      sx={{
        '*': {
          whiteSpace: 'pre-wrap'
        }
      }}
      position="relative"
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      overflow="hidden"
      width="100%"
      minH="100vh"
      maxWidth="100vw"
    >
      {/* <ProfileDrawer></ProfileDrawer> */}
      <Nav />
      <Flex
        position="relative"
        alignItems="center"
        justifyContent="center"
        flexDirection="column"
        overflow="hidden"
        width="100%"
        minH="100vh"
        maxWidth="100vw"
      >
        {props.children}
      </Flex>
      <Footer></Footer>
    </Flex>
  );
};
