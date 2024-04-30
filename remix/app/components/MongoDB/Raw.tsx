import { Suspense, useState } from 'react';
import { useThingtime } from '../Thingtime/useThingtime';
import { Flex, Heading, Box } from '@chakra-ui/react';
import Editor from '@monaco-editor/react';

export const Raw = () => {
  const { thingtime } = useThingtime();

  const [rawValue, setRawValue] = useState(thingtime?.rawValue || '// Raw');

  return (
    <Flex w="100%" position="relative" minH="50vh" maxW="container" flexDir={'column'}>
      <Heading size="sm" pb={8}>
        Raw
      </Heading>

      {/* only on client side render editor */}
      <Suspense fallback={<div>Loading...</div>}>
        {/* {editor} */}
        <Flex flexGrow={1} position="relative">
          <Box pos={'absolute'} top={'0'} left={'0'} right={'0'} bottom={'0'}>
            <Editor defaultLanguage="javascript" defaultValue={rawValue}></Editor>;
          </Box>
        </Flex>
      </Suspense>
    </Flex>
  );
};
