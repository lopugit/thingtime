// branding page which basically just renders a bunch of assets loaded from json encoded Thingtime ".tt" data files
// import from ./assets/all.ts = [{...},...]
import { Container, Flex, Heading, Text } from '@chakra-ui/react';
import { Thingtime } from '~/components/Thingtime/Thingtime';
import Assets from './assets/all';

export default function Branding() {
  return (
    <Container
      maxW="container"
      width="100%"
      px={['18px', '24px']}
      pt="calc(var(--thingtime-safe-area-top, 0px) + 108px)"
      pb={24}
    >
      <Flex flexDir="column">
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
        <Heading as="h1" size="lg" color="var(--tt-ink, #16161a)" letterSpacing="-0.02em" pb={8}>
          Thingtime Branding Assets
        </Heading>
        <Thingtime thing={Assets} />
      </Flex>
    </Container>
  );
}
