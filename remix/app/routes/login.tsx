import { Flex } from '@chakra-ui/react';
import React from 'react';

import { Login } from '~/components/Login/Login';

export default function login() {
  const template = (
    <>
      <Flex
        alignItems="center"
        justifyContent="center"
        width="100%"
        height="100%"
        minHeight="100vh"
        background="var(--tt-surface, #fafafb)"
        paddingX={4}
        paddingY={12}
      >
        <Login></Login>
      </Flex>
    </>
  );

  return template;
}
