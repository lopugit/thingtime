import { Heading } from '@chakra-ui/react';
import { userCheckExists } from '~/api/utils/userCheckExists';
import { userValidatePassword } from '~/api/utils/userValidatePassword';
import { TestAPI } from '~/components/API/Test';
import { TopSpacing } from '~/components/Layout/TopSpacing';

export default function Index() {
  return (
    <>
      <TopSpacing />
      <Heading size="lg">API V1 Template</Heading>
      <TestAPI />
    </>
  );
}

export const action = async ({ request }) => {
  console.log('[tt] request', request);

  // get remix action body
  const body = await request.json();

  const {} = body;

  return earlyReturn({ status: 200, message: 'Template API' });
};

const earlyReturn = (args) => {
  return {
    status: args?.status || 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: {
      message: 'Early return triggered in login action' + (args?.message ? `: ${args.message}` : '')
    },
    cache: {
      revalidate: 60
    }
  };
};
