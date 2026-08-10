import assert from 'node:assert/strict';
import test from 'node:test';

import {
  summarizeVercelRunnerJobs,
  vercelRunnerIdentity
} from './vercelRunner';

test('Vercel runner identity is unique, bounded, and label-safe', () => {
  assert.deepEqual(vercelRunnerIdentity('ci-Dispatch/ABC_123'), {
    name: 'thingtime-vercel-dispatch-abc-123',
    label: 'thingtime-vercel-dispatch-abc-123'
  });
  const bounded = vercelRunnerIdentity(`ci-${'a'.repeat(100)}`);
  assert.equal(bounded.label, `thingtime-vercel-${'a'.repeat(28)}`);
  assert.throws(() => vercelRunnerIdentity('ci-!!!'), /cannot identify a Vercel runner/);
});

test('Vercel runner job summaries deduplicate runs and preserve failure state', () => {
  assert.deepEqual(
    summarizeVercelRunnerJobs([
      { runId: 101, status: 'completed', conclusion: 'success' },
      { runId: 101, status: 'completed', conclusion: 'failure' },
      { runId: 102, status: 'in_progress', conclusion: null },
      { runId: 103, status: 'completed', conclusion: 'cancelled' }
    ]),
    {
      seen: 4,
      active: 1,
      failed: 2,
      runIds: [101, 102, 103]
    }
  );
});
