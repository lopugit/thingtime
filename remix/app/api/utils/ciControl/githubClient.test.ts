import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCiWorkflowDispatch, resolveCiWorkflowEntryRef } from './githubClient';

test('workflow dispatches enter only through reviewed product branches', () => {
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
