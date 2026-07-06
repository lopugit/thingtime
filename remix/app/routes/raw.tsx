import { Container, Flex } from '@chakra-ui/react';
import { TopSpacing } from '~/components/Layout/TopSpacing';
import { Raw } from '~/components/MongoDB/Raw';
import { RawResults } from '~/components/MongoDB/RawResults';

export default function login() {
  const template = (
    <Container maxW="container" width="100%" px={['18px', '24px']} pb={24}>
      <TopSpacing />
      <Flex flexDir="column" rowGap={16}>
        <Raw></Raw>
        <RawResults></RawResults>
      </Flex>
    </Container>
  );

  return template;
}
