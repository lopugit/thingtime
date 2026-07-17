import { Flex } from '@chakra-ui/react';
import { useLocation } from 'react-router';
import { Submit } from '~/components/API/Submit';
import { json } from '~/api/http';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
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

// POST /api/v1/mongodb/populate — run the seed/setup script. This mutates the
// live database: it registers fixture users whose passwords are known constants
// and seeds showcase posts/schemas (app/scripts/mongodb/setup + data/*). On a
// self-hosted/production deploy an anonymous caller must never be able to seed
// known-credential accounts into the live DB, so this is admin-only and rate
// limited fail-closed — mirroring the sibling mongodb/raw-results route.
const actionExport = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const limit = await enforceRateLimit(request, 'mongodb.populate', `user:${gate.user.id}`, { failClosed: true });
  if (!limit.allowed) {
    if (limit.unavailable) {
      return json(
        { ok: false, error: 'The database seed limiter is temporarily unavailable. Please try again shortly.' },
        { status: 503, headers: { 'Retry-After': '5' } }
      );
    }
    return json(
      { ok: false, error: 'Seeding is heavy — please wait a moment before running it again 🌸' },
      rateLimitedResponseInit(limit)
    );
  }

  // literally just run the setup.ts script
  const ret = await setup();

  if (!ret) {
    return json({ ok: false, error: 'failed to setup mongodb' }, { status: 500 });
  }

  return json({ ok: true, message: 'successful', data: { ret } });
};

export const action = actionExport;

export const populateAction = actionExport;
