import { Flex } from '@chakra-ui/react';
import React from 'react';
import { redirect } from '@vercel/remix';

import { Login } from '~/components/Login/Login';
import { useApi } from '~/hooks/useApi';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';

// already logged in? skip the form and go to the profile
export async function loader({ request }: { request: Request }) {
  if (await getCurrentUser(request)) return redirect('/profile');
  return null;
}

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
