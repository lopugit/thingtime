import { Container, Flex } from '@chakra-ui/react';
import { TopSpacing } from '~/components/Layout/TopSpacing';
import { Raw } from '~/components/MongoDB/Raw';

export default function RawPage() {
  const template = (
    <Container maxW="1400px" width="100%" px={['18px', '24px']} pb={24}>
      <TopSpacing />
      <Flex flexDir="column" rowGap={8} minWidth={0}>
        <Raw />
      </Flex>
    </Container>
  );

  return template;
}
