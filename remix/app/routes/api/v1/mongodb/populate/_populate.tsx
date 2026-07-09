import { Flex } from '@chakra-ui/react';
import { useLocation } from 'react-router';
import { json, readJsonBody } from '~/api/http';
import { requireAdminUser } from '~/api/utils/auth/admin';
import { Submit } from '~/components/API/Submit';
import setup from '~/scripts/mongodb/setup';

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

const actionExport = async ({ request }) => {
  const admin = await requireAdminUser(request);
  if (admin.ok === false) {
    return json({ ok: false, error: admin.error }, { status: admin.status });
  }

  await readJsonBody(request, 16 * 1024);
  const ret = await setup();

  if (!ret || ret.ok === false) {
    return json(
      { ok: false, error: ret?.error || 'failed to setup mongodb' },
      { status: 500 }
    );
  }

  return json({ ok: true, result: ret });
};

export const action = actionExport;

export const populateAction = actionExport;
