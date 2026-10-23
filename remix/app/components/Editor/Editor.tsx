import { Suspense } from 'react';
import { Box, Button, Flex } from '@chakra-ui/react';
import { Editor as MonacoEditor } from '@monaco-editor/react';

export const Editor = (props) => {
  const { defaultValue = '', defaultLanguage = 'javascript', width = '100%', height = '100%' } = props;

  return (
    <>
      <Box
        minH="60vh"
        w="100%"
        maxW={'container'}
        pos={'relative'}
        overflow="hidden"
        background="var(--tt-card, #ffffff)"
        border="1px solid var(--tt-border, #ececef)"
        borderRadius="var(--tt-radius-lg, 16px)"
        boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
      >
        <Flex position="absolute" w={width} h={height} top={0} left={0} right={0} bottom={0}>
          {/* only on client side render editor */}
          <Suspense
            fallback={
              <div
                style={{
                  color: 'var(--tt-muted, #9a9aa6)',
                  fontFamily: 'var(--tt-font-mono, monospace)',
                  fontSize: '12px',
                  letterSpacing: '0.1em',
                  padding: '16px',
                  textTransform: 'uppercase'
                }}
              >
                Loading...
              </div>
            }
          >
            <MonacoEditor defaultLanguage={defaultLanguage} defaultValue={defaultValue} />
          </Suspense>
        </Flex>
      </Box>
    </>
  );
};
