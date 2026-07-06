import { Suspense, useState } from 'react';
import { useThingtime } from '../Thingtime/useThingtime';
import { Flex, Heading, Button, Text } from '@chakra-ui/react';
import Editor from '@monaco-editor/react';

export const Raw = () => {
  const { thingtime } = useThingtime();

  const [rawValue, setRawValue] = useState(thingtime?.rawValue || '// Raw');

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
        Raw
      </Heading>

      {/* only on client side render editor */}
      <Suspense fallback={<Text fontSize="sm" color="var(--tt-muted, #9a9aa6)">Loading...</Text>}>
        {/* {editor} */}
        <Flex flexGrow={1} position="relative">
          <Flex flexDir="column" pos={'absolute'} top={'0'} left={'0'} right={'0'} bottom={'0'}>
            <Flex
              flexGrow={1}
              position="relative"
              overflow="hidden"
              background="var(--tt-card, #ffffff)"
              border="1px solid var(--tt-border, #ececef)"
              borderRadius="var(--tt-radius-lg, 16px)"
              boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
              paddingY="12px"
            >
              <Editor defaultLanguage="javascript" defaultValue={rawValue}></Editor>
            </Flex>
            <Flex pt={4}>
              <Button onClick={() => {}}>Save Export Default</Button>
            </Flex>
          </Flex>
        </Flex>
      </Suspense>
    </Flex>
  );
};
