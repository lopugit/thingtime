import { Suspense, useState } from 'react';
import { useThingtime } from '../Thingtime/useThingtime';
import { Flex, Heading, Box, Button } from '@chakra-ui/react';
import Editor from '@monaco-editor/react';
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
      <Heading size="sm" pb={8}>
        Raw Results
      </Heading>
      <Flex flexDir={'column'}>
        {results.map((result, index) => {
          return <RawResult key={index + 'rawResult'} result={result} />;
        })}
      </Flex>
    </Flex>
  );
};
