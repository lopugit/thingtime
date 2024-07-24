import { Suspense } from 'react';
import { Box, Button, Flex } from '@chakra-ui/react';
import { Editor as MonacoEditor } from '@monaco-editor/react';

export const Editor = (props) => {
  const { defaultValue = '', defaultLanguage = 'javascript', width = '100%', height = '100%' } = props;

  return (
    <>
      <Box minH="60vh" w="100%" maxW={'container'} pos={'relative'}>
        <Flex position="absolute" w={width} h={height} top={0} left={0} right={0} bottom={0}>
          {/* only on client side render editor */}
          <Suspense fallback={<div>Loading...</div>}>
            <MonacoEditor defaultLanguage={defaultLanguage} defaultValue={defaultValue} />
          </Suspense>
        </Flex>
      </Box>
    </>
  );
};
