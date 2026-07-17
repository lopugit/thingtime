import { Flex } from '@chakra-ui/react';
import { useLocation } from 'react-router';
import { Submit } from '~/components/API/Submit';
import { json } from '~/api/http';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import setup, { SETUP_STAGES } from '~/scripts/mongodb/setup';

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

  // Run the setup.ts seeder, time-boxed: serverless functions get a hard
  // platform budget, so each invocation seeds what fits (default 8s) and
  // reports complete: false when it ran out — every write is idempotent, so
  // repeated calls converge. Optional JSON body:
  //   { stages?: ["schemas", …], budgetMs?: number }
  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const budgetMs = Math.min(Math.max(Number(body?.budgetMs) || 8000, 1000), 300_000);
  const requested = Array.isArray(body?.stages)
    ? body.stages.filter((stage) => (SETUP_STAGES as readonly string[]).includes(String(stage)))
    : [];

  const ret = await setup({
    deadlineAt: Date.now() + budgetMs,
    stages: requested.length ? requested : undefined
  });

  if (!ret) {
    return json({ ok: false, error: 'failed to setup mongodb' }, { status: 500 });
  }

  return json({ ok: true, message: 'successful', data: { ret } });
};

export const action = actionExport;

export const populateAction = actionExport;
