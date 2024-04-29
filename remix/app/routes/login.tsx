import { Flex } from '@chakra-ui/react';
import React from 'react';

import { Login } from '~/components/Login/Login';
import { useApi } from '~/hooks/useApi';

export default function login() {
  const template = (
    <>
      <Flex alignItems="center" justifyContent="center" width="100%" height="100%" minHeight="100vh">
        <Login></Login>
      </Flex>
    </>
  );

  return template;
}
