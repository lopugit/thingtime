import { Flex } from '@chakra-ui/react';
import { useLocation } from 'react-router';
import { json, rejectOversizeBody } from '~/api/http';
import { withAdmin } from '~/api/utils/auth/admin';
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

const actionExport = withAdmin(async ({ request }) => {
  await rejectOversizeBody(request, 16 * 1024);

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
});

export const action = actionExport;
