import { Flex } from '@chakra-ui/react';
import React from 'react';

import { Register } from '~/components/Login/Register';

export default function register() {
  return (
    <Flex alignItems="center" justifyContent="center" width="100%" height="100%" minHeight="100vh">
      <Register></Register>
    </Flex>
  );
}
