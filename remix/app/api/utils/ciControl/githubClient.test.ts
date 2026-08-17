import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCiWorkflowEntryRef } from './githubClient';

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
