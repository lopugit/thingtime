import { Flex } from '@chakra-ui/react';
import { useLocation } from 'react-router';
import { json } from '~/api/http';
import { getMongoStatus } from '~/api/utils/mongodb/status';
import { Submit } from '~/components/API/Submit';

// GET /api/v1/mongodb/status — used by the footer indicator and the status page.
// Always responds 200; `connected` in the body carries the real health so
// consumers (fetcher.load) never mistake a down DB for a request error.
export const loader = async () => {
  const status = await getMongoStatus();
  return json(status);
};

// POST /api/v1/mongodb/status — same payload, so the in-app API tester (Submit)
// can exercise this endpoint like the other /api/v1/mongodb/* routes.
export const action = async () => {
  const status = await getMongoStatus();
  return json(status);
};

export default function Index() {
  const { pathname } = useLocation();

  return (
    <Flex flexDir={'column'}>
      <Submit pathname={pathname}></Submit>
    </Flex>
  );
}
