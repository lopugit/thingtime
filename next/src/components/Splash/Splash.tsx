import { Flex } from '@chakra-ui/react';

import { TextAnimation1 } from '~/components/textAnimation1';

export const Splash = (props: any) => {
  return (
    <Flex alignItems="center" justifyContent="center" width="100vw" maxWidth="100vw" minHeight="100vh" paddingY="100px">
      <Flex alignItems="center" justifyContent="center" width="800px" textAlign="center">
        <TextAnimation1 ce={props?.ce} texts={props?.texts}></TextAnimation1>
      </Flex>
    </Flex>
  );
};
