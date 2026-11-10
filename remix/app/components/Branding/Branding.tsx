import { Flex, Heading, Text } from '@chakra-ui/react';
import { PAGE_TOP_CLEARANCE } from '../Layout/PageShell';
import { Logo } from './Logo';

export const Branding = () => {
  return (
    <Flex
      pt={PAGE_TOP_CLEARANCE}
      pb={24}
      flexDir="column"
      w="100%"
      minH="100vh"
      px={['18px', '24px']}
      maxW={'container'}
      mx="auto"
      textAlign={'left'}
    >
      <Text
        fontFamily="mono"
        fontSize="11px"
        fontWeight={600}
        letterSpacing="0.14em"
        textTransform="uppercase"
        color="var(--tt-muted, #9a9aa6)"
        pb={2}
      >
        Brand
      </Text>
      <Heading size="lg" color="var(--tt-ink, #16161a)" letterSpacing="-0.02em">
        Branding
      </Heading>
      <Heading mt={12} size="md" color="var(--tt-ink, #16161a)" letterSpacing="-0.02em">
        Logo
      </Heading>
      <Logo editable />
      <Logo editable icon />
      <Logo editable theme="nature" />
      <Logo editable theme="nature" icon />
    </Flex>
  );
};
