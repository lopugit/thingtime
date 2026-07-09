import { Flex, Heading } from '@chakra-ui/react';
import { useLocation } from 'react-router';
import { requireAdmin } from '~/api/utils/auth/getCurrentUser';
import { getCollection } from '~/api/utils/mongodb/collection';
import { getConnection } from '~/api/utils/mongodb/connection';
import { Submit } from '~/components/API/Submit';
import setup from '~/scripts/mongodb/setup';

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

const actionExport = async ({ request }) => {
  // raw docs include every user's private things (and now their crystal
  // payloads) — admin-only debug endpoint
  const admin = await requireAdmin(request);
  if (!admin) {
    return earlyReturn({
      status: 401,
      message: 'Unauthorized'
    });
  }

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
