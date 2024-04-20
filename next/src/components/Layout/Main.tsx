import { Box, Flex } from '@chakra-ui/react';

import { Footer } from '../Nav/Footer';
import { Nav } from '../Nav/Nav';
import { ProfileDrawer } from '../Nav/ProfileDrawer';

export const Main = (props: any) => {
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
      maxWidth="100vw"
    >
      {/* <ProfileDrawer></ProfileDrawer> */}
      <Nav />
      <Box width="100%" minHeight="100vh">
        {props.children}
      </Box>
      <Footer></Footer>
    </Flex>
  );
};
