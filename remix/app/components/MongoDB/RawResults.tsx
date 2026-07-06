import { useState } from 'react';
import { useThingtime } from '../Thingtime/useThingtime';
import { Flex, Heading, Text } from '@chakra-ui/react';
import { RawResult } from './RawResult';

export const RawResults = () => {
  const { thingtime } = useThingtime();

  const [results, setResults] = useState([]);

  const fetchResults = async () => {
    const res = await fetch('/api/v1/mongodb/raw-results');
    const data = await res.json();
    setResults(data);
  };

  return (
    <Flex w="100%" position="relative" minH="50vh" maxW="container" flexDir={'column'}>
      <Text
        fontFamily="mono"
        fontSize="11px"
        fontWeight={600}
        letterSpacing="0.14em"
        textTransform="uppercase"
        color="var(--tt-muted, #9a9aa6)"
        pb={2}
      >
        MongoDB
      </Text>
      <Heading size="md" color="var(--tt-ink, #16161a)" letterSpacing="-0.02em" pb={6}>
        Raw Results
      </Heading>
      <Flex flexDir={'column'} rowGap={4}>
        {results.map((result, index) => {
          return <RawResult key={index + 'rawResult'} result={result} />;
        })}
      </Flex>
    </Flex>
  );
};
