import { ChakraProvider } from '@chakra-ui/react';

import { theme } from './theme';
export const ChakraWrapper = (props: any) => {
  return <ChakraProvider theme={theme}>{props.children}</ChakraProvider>;
};
