import assert from 'node:assert/strict';
import test from 'node:test';

import {
  groupVercelDeployments,
  MAX_DEPLOYMENT_HISTORY_LIMIT,
  normaliseDeploymentHistoryLimit,
  type VercelDeploymentSummary
} from './status';

const deployment = ({
  branch,
  createdAt,
  id,
  state = 'ready'
}: {
  branch: string;
  createdAt: string;
  id: string;
  state?: VercelDeploymentSummary['state'];
}): VercelDeploymentSummary => ({
  branch,
  createdAt,
  id,
  state,
  url: `https://${id}.vercel.app`
});

test('deployment history limits are bounded and support an explicit all value', () => {
  assert.equal(normaliseDeploymentHistoryLimit(undefined), 1);
  assert.equal(normaliseDeploymentHistoryLimit('10'), 10);
  assert.equal(normaliseDeploymentHistoryLimit('all'), MAX_DEPLOYMENT_HISTORY_LIMIT);
  assert.equal(normaliseDeploymentHistoryLimit(0), 1);
  assert.equal(normaliseDeploymentHistoryLimit(999), MAX_DEPLOYMENT_HISTORY_LIMIT);
});

test('deployment groups retain recent history for each selected branch', () => {
  const groups = groupVercelDeployments({
    branchLimit: 2,
    deployments: [
      deployment({
        branch: 'feature/older-branch',
        createdAt: '2026-08-18T00:00:00.000Z',
        id: 'older-branch-ready'
      }),
      deployment({
        branch: 'feature/current',
        createdAt: '2026-08-18T03:00:00.000Z',
        id: 'current-queued',
        state: 'queued'
      }),
      deployment({
        branch: 'feature/second',
        createdAt: '2026-08-18T02:00:00.000Z',
        id: 'second-ready'
      }),
      deployment({
        branch: 'feature/current',
        createdAt: '2026-08-18T01:00:00.000Z',
        id: 'current-ready'
      })
    ],
    historyLimit: 10
  });

  assert.deepEqual(groups.map((group) => group.branch), [
    'feature/current',
    'feature/second'
  ]);
  assert.deepEqual(groups[0]?.deployments.map((item) => item.id), [
    'current-queued',
    'current-ready'
  ]);
  assert.deepEqual(groups[1]?.deployments.map((item) => item.id), [
    'second-ready'
  ]);
});

test('deployment groups deduplicate paginated deployment results and cap each history', () => {
  const duplicate = deployment({
    branch: 'feature/current',
    createdAt: '2026-08-18T03:00:00.000Z',
    id: 'current-latest'
  });
  const groups = groupVercelDeployments({
    deployments: [
      duplicate,
      duplicate,
      deployment({
        branch: 'feature/current',
        createdAt: '2026-08-18T02:00:00.000Z',
        id: 'current-previous'
      })
    ],
    historyLimit: 1
  });

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.deployments.map((item) => item.id), ['current-latest']);
});
