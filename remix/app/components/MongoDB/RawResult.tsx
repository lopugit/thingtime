import React from 'react';
import { useThingtime } from '../Thingtime/useThingtime';
import { Flex, Box } from '@chakra-ui/react';

type RawResultProps = {
  result: object;
};

export const RawResult = (props: RawResultProps) => {
  const { thingtime } = useThingtime();

  const { result } = props;

  const stringified = React.useMemo(() => {
    try {
      return (
        <Box
          as="pre"
          fontFamily="mono"
          fontSize="12.5px"
          lineHeight={1.7}
          color="var(--tt-text, #5a5a66)"
          background="var(--tt-surface, #fafafb)"
          border="1px solid var(--tt-border, #ececef)"
          borderRadius="var(--tt-radius-md, 12px)"
          boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
          padding={4}
          overflowX="auto"
        >
          {JSON.stringify(result, null, 2)}
        </Box>
      );
    } catch (e) {
      ('Error stringifying result');
    }
  }, []);

  return (
    <Flex w="100%" position="relative" maxW="container" flexDir={'column'}>
      {stringified}
    </Flex>
  );
};
