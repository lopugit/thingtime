import assert from 'node:assert/strict';
import test from 'node:test';

import {
  installVercelRunnerDependencies,
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

test('Vercel runner bootstrap uses GitHub\'s dependency installer non-interactively', async () => {
  const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  await installVercelRunnerDependencies(
    {
      runCommand: async (params) => {
        calls.push(params);
        return { exitCode: 0 };
      }
    },
    '/vercel/actions-runner'
  );
  assert.deepEqual(calls, [
    {
      cmd: 'sudo',
      args: ['-n', 'env', 'DEBIAN_FRONTEND=noninteractive', './bin/installdependencies.sh'],
      cwd: '/vercel/actions-runner'
    },
    {
      cmd: 'sudo',
      args: ['-n', 'sh', '-c', 'test -e /dev/fd || ln -s /proc/self/fd /dev/fd'],
      cwd: '/vercel/actions-runner'
    }
  ]);
});

test('Vercel runner bootstrap fails closed when dependencies cannot be installed', async () => {
  await assert.rejects(
    installVercelRunnerDependencies(
      {
        runCommand: async () => ({ exitCode: 1 })
      },
      '/vercel/actions-runner'
    ),
    /runtime dependencies could not be installed/
  );
});

test('Vercel runner bootstrap fails closed when Bash process substitution cannot be enabled', async () => {
  let calls = 0;
  await assert.rejects(
    installVercelRunnerDependencies(
      {
        runCommand: async () => ({ exitCode: calls++ === 0 ? 0 : 1 })
      },
      '/vercel/actions-runner'
    ),
    /file-descriptor compatibility link could not be installed/
  );
  assert.equal(calls, 2);
});
