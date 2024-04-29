import { Flex } from '@chakra-ui/react';

import { Login } from '~/components/Login/Login';

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
