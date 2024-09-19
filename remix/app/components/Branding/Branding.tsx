import { Box, Center, Flex, Heading } from '@chakra-ui/react';
import { Logo } from './Logo';

export const Branding = () => {
  return (
    <Flex pt={[25, 50]} flexDir="column" w="100%" minH="100vh" px={'18px'} maxW={'container'} textAlign={'left'}>
      <Heading>Branding</Heading>
      <Heading mt={12}>Logo</Heading>
      <Logo editable />
      <Logo editable icon />
      <Logo editable theme="nature" />
      <Logo editable theme="nature" icon />
    </Flex>
  );
};
