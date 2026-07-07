import { Flex, Heading } from '@chakra-ui/react';
import { useLocation } from 'react-router';
import { requireAuthenticatedDevUser } from '~/api/utils/auth/requireAuthenticatedDevUser';
import { Submit } from '~/components/API/Submit';
import setup from '~/scripts/mongodb/setup';

const routeName = 'Populate';

export default function Index() {
  const { pathname } = useLocation();

  return (
    <Flex flexDir={'column'}>
      {/* <Thingtime></Thingtime> */}
      {/* hmmmmm */}
      <Submit pathname={pathname}></Submit>
    </Flex>
  );
}

const actionExport = async ({ request }: { request: Request }) => {
  const access = await requireAuthenticatedDevUser(request, 'MongoDB populate');
  if (access.ok === false) return access.response;

  // literally just run the setup.ts script


  const ret = await setup();

  if (!ret) {
    return earlyReturn({
      status: 500,
      message: `failed to setup mongodb`
    });
  }

  return earlyReturn({
    status: 200,
    message: `successful`,
    data: {
      ret
    }
  });
};

const earlyReturn = (args) => {
  return {
    status: args?.status || 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: {
      message: `Early return triggered in ${routeName} action` + (args?.message ? `: ${args.message}` : ''),
      data: args?.data
    },
    cache: {
      revalidate: 60
    }
  };
};

export const action = actionExport;

export const populateAction = actionExport;
