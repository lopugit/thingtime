import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { CurrentPageBuilderProvider, CurrentPageBuilderToggle } from '../../app/components/Builder/CurrentPageBuilder';

/** Give isolated document fixtures an explicit Builder entry without the app shell. */
export function CurrentPageBuilderFixture({ children }: { children: React.ReactNode }) {
  return <CurrentPageBuilderProvider>
    <ChakraProvider resetCSS={false}><CurrentPageBuilderToggle /></ChakraProvider>
    {children}
  </CurrentPageBuilderProvider>;
}
