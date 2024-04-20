import { Box, Flex } from '@chakra-ui/react';

import { Providers } from '@/providers/providers';

import { Footer } from '@/components/Nav/Footer';
import { Nav } from '@/components/Nav/Nav';
import { ProfileDrawer } from '@/components/Nav/ProfileDrawer';

export const DefaultLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <Providers>
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
          {children}
        </Box>
        <Footer></Footer>
      </Flex>
    </Providers>
  );
};
