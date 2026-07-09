import { Flex } from '@chakra-ui/react';
import { useLocation } from 'react-router';
import { json, readJsonBody } from '~/api/http';
import { requireAdminUser } from '~/api/utils/auth/admin';
import { getThingsCollection } from '~/api/utils/mongodb/collections';
import { Submit } from '~/components/API/Submit';

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
  const admin = await requireAdminUser(request);
  if (admin.ok === false) {
    return json({ ok: false, error: admin.error }, { status: admin.status });
  }

  await readJsonBody(request, 16 * 1024);

  const thingsCollection = await getThingsCollection();
  const rawResults = await thingsCollection
    .find({ kind: 'post', visibility: 'public' })
    .project({ _id: 0 })
    .sort({ createdAt: -1, shareId: 1 })
    .limit(200)
    .toArray();

  return json({
    ok: true,
    rawResults,
    filter: {
      kind: 'post',
      visibility: 'public'
    }
  });
};

export const action = actionExport;

export const rawResultsAction = actionExport;
