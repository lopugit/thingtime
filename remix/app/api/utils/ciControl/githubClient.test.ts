import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalFeatureStackPlanFromPullRequests,
  resolveCiWorkflowDispatch,
  resolveCiWorkflowEntryRef
} from './githubClient';

test('Feature Stack snapshots preserve admin order and exact same-repository heads', () => {
  const plan = canonicalFeatureStackPlanFromPullRequests({
    name: 'Search + Messenger',
    sourcePrNumbers: [12, 14],
    targets: ['develop', 'main'],
    repository: 'lopugit/thingtime',
    pullRequests: [
      { number: 12, title: 'Search', state: 'open', draft: false, head: { ref: 'feature/search', sha: 'a'.repeat(40), repo: { full_name: 'lopugit/thingtime' } } },
      { number: 14, title: 'Messenger', state: 'open', draft: false, head: { ref: 'feature/messenger', sha: 'b'.repeat(40), repo: { full_name: 'lopugit/thingtime' } } }
    ]
  });
  assert.deepEqual(plan.sources.map((source) => source.pr), [12, 14]);
  assert.equal(JSON.stringify(plan), `{"autoMerge":true,"name":"Search + Messenger","sources":[{"head":"feature/search","pr":12,"sha":"${'a'.repeat(40)}","title":"Search"},{"head":"feature/messenger","pr":14,"sha":"${'b'.repeat(40)}","title":"Messenger"}],"targets":["develop","main"],"version":1}`);
  assert.throws(
    () => canonicalFeatureStackPlanFromPullRequests({ ...plan, sourcePrNumbers: [12, 14], pullRequests: [
      { number: 12, title: 'Search', state: 'open', head: { ref: 'feature/search', sha: 'a'.repeat(40), repo: { full_name: 'someone/fork' } } },
      { number: 14, title: 'Messenger', state: 'open', head: { ref: 'feature/messenger', sha: 'b'.repeat(40), repo: { full_name: 'lopugit/thingtime' } } }
    ], repository: 'lopugit/thingtime' }),
    /not an eligible immutable same-repository PR/
  );
});

test('workflow dispatches enter only through reviewed product branches', () => {
  assert.equal(resolveCiWorkflowEntryRef('feature-stack'), 'develop');
  assert.equal(resolveCiWorkflowEntryRef('resolve-conflicts'), 'develop');
  assert.equal(resolveCiWorkflowEntryRef('rebase-stack', 'develop'), 'develop');
  assert.equal(resolveCiWorkflowEntryRef('promote-features'), 'develop');
  assert.equal(resolveCiWorkflowEntryRef('promote-develop'), 'develop');
  assert.equal(resolveCiWorkflowEntryRef('web-ci'), 'develop');
  assert.equal(resolveCiWorkflowEntryRef('sync-main'), 'main');
  assert.equal(resolveCiWorkflowEntryRef('electron-release', 'main'), 'main');
});

test('workflow dispatches reject arbitrary feature and control-plane refs', () => {
  assert.throws(
    () => resolveCiWorkflowEntryRef('resolve-conflicts', 'feature/unreviewed-listener'),
    /must enter through develop/
  );
  assert.throws(
    () => resolveCiWorkflowEntryRef('electron-release', 'develop'),
    /must enter through main/
  );
  assert.throws(
    () => resolveCiWorkflowEntryRef('web-ci', 'github-actions'),
    /must enter through develop/
  );
});

test('repository maintenance dispatches through the one Lopu manager', () => {
  const featureStackPlan = Buffer.from('{"autoMerge":true,"name":"Search + Messenger","sources":[],"targets":["develop"],"version":1}').toString('base64');
  assert.deepEqual(resolveCiWorkflowDispatch('feature-stack', {
    feature_stack_plan_b64: featureStackPlan,
    unexpected: 'discarded'
  }), {
    workflowFile: 'resolve-pr-conflicts.yml',
    inputs: {
      maintenance_operation: 'merge-feature-stack',
      feature_stack_plan_b64: featureStackPlan
    }
  });
  assert.deepEqual(resolveCiWorkflowDispatch('rebase-stack', {
    pr_number: 202,
    branch: 'feature/example',
    cascade: false,
    unexpected: 'discarded'
  }), {
    workflowFile: 'resolve-pr-conflicts.yml',
    inputs: {
      maintenance_operation: 'manage-prs',
      pr_number: '202',
      branch: 'feature/example',
      rebase_cascade: false
    }
  });
  assert.deepEqual(resolveCiWorkflowDispatch('promote-features', {
    dry_run: true,
    lookback: 25
  }), {
    workflowFile: 'resolve-pr-conflicts.yml',
    inputs: {
      maintenance_operation: 'promote-features',
      promotion_dry_run: true,
      promotion_lookback: '25'
    }
  });
  assert.deepEqual(resolveCiWorkflowDispatch('promote-develop'), {
    workflowFile: 'resolve-pr-conflicts.yml',
    inputs: { maintenance_operation: 'promote-develop' }
  });
  assert.deepEqual(resolveCiWorkflowDispatch('sync-main'), {
    workflowFile: 'resolve-pr-conflicts.yml',
    inputs: { maintenance_operation: 'sync-main-develop' }
  });
});
