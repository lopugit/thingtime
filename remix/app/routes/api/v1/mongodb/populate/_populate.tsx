import { Flex, Heading } from '@chakra-ui/react';
import { useLocation } from 'react-router';
import { Submit } from '~/components/API/Submit';
import setup, { SETUP_STAGES } from '~/scripts/mongodb/setup';

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

const actionExport = async ({ request }) => {
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
