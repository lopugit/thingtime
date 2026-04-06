import { Box, Button, Container, Flex, Heading } from '@chakra-ui/react';

import tt from '../tt';
import React from 'react';
import { useAsyncFetcher } from '~/hooks/useAsyncFetcher';
import { Thingtime } from '../Thingtime/Thingtime';
import { useThingtime } from '../Thingtime/useThingtime';

export const Submit = (props) => {
  const { pathname } = props;

  // turn pathname into a routeName
  // which should look like 'API V1 MongoDB Get Connection'
  // if pathname is '/api/v1/mongodb/get-connection'

  const routeName = pathname?.split('/')?.join(' ')?.toUpperCase()?.trim();

  const asyncFetcher = useAsyncFetcher();

  const [ret, setRet] = React.useState(null);

  const submit = React.useCallback(async () => {
    const data = props?.data || {};

    console.log('[tt] Submitting to', pathname, 'with data', data);

    const ret = await asyncFetcher.submit(data, { action: pathname });

    setRet(ret);

    return ret;
  }, []);

  const [input, setInput] = React.useState({
    query: {}
  });

  const { thingtime } = useThingtime();

  const connectionUrls = thingtime?.settings?.connectionUrls || ['mongodb://localhost:27017'];

  return (
    <Container py={64} px={0} mx={0}>
      <Flex gap={12} flexDir="column">
        <Heading mb={6}>{routeName}</Heading>
        <Heading as={'h2'} size={'md'} mb={4}>
          {pathname}
        </Heading>

        <Thingtime path={'settings.connectionUrls'} edit></Thingtime>

        <Thingtime value={input} edit></Thingtime>

        <Thingtime value={ret}></Thingtime>

        <Flex>
          <tt.Button onClick={submit}>Submit</tt.Button>
        </Flex>
      </Flex>
    </Container>
  );
};
