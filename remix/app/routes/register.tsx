import { Flex } from '@chakra-ui/react';
import React from 'react';
import { redirect } from '@vercel/remix';

import { Register } from '~/components/Login/Register';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';

// already logged in (incl. right after registering)? go to the welcome page
export async function loader({ request }: { request: Request }) {
  if (await getCurrentUser(request)) return redirect('/welcome');
  return null;
}

export default function register() {
  return (
    <Flex alignItems="center" justifyContent="center" width="100%" height="100%" minHeight="100vh">
      <Register></Register>
    </Flex>
  );
}
