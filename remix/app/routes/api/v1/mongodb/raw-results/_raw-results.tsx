import { Flex, Heading } from '@chakra-ui/react';
import { useLocation } from 'react-router';
import { requireAuthenticatedDevOrRole } from '~/api/utils/auth/requireAuthenticatedDevUser';
import { THINGTIME_ADMIN_ROLE } from '~/api/utils/auth/users';
import { getCollection } from '~/api/utils/mongodb/collection';
import { getConnection } from '~/api/utils/mongodb/connection';
import { Submit } from '~/components/API/Submit';

const routeName = 'Raw Results';

export default function Index() {
  const { pathname } = useLocation();

  return (
    <Flex flexDir={'column'}>
      {/* <Thingtime ></Thingtime> */}
      <Submit pathname={pathname}></Submit>
    </Flex>
  );
}

const actionExport = async ({ request }: { request: Request }) => {
  const access = await requireAuthenticatedDevOrRole(request, 'MongoDB raw results', {
    allowedRoles: [THINGTIME_ADMIN_ROLE]
  });
  if (access.ok === false) return access.response;

  // literally just run the setup.ts script

  const connection = await getConnection();

  if (!connection) {
    return earlyReturn({
      status: 500,
      message: `failed to setup mongodb connection`
    });
  }

  const thingsCollection = await getCollection();

  const things = await thingsCollection.find().toArray();

  return earlyReturn({
    status: 200,
    message: `successful`,
    data: {
      rawResults: things
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

export const rawResultsAction = actionExport;
