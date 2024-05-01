import React, { Suspense, useState } from 'react';
import { useThingtime } from '../Thingtime/useThingtime';
import { Flex, Heading, Box, Button } from '@chakra-ui/react';
import Editor from '@monaco-editor/react';

type RawResultProps = {
  result: object;
};

export const RawResult = (props: RawResultProps) => {
  const { thingtime } = useThingtime();

  const { result } = props;

  const stringified = React.useMemo(() => {
    try {
      return <pre>{JSON.stringify(result, null, 2)}</pre>;
    } catch (e) {
      ('Error stringifying result');
    }
  }, []);

  return (
    <Flex w="100%" position="relative" minH="50vh" maxW="container" flexDir={'column'}>
      {stringified}
    </Flex>
  );
};
