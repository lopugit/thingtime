import assert from 'node:assert/strict';
import test from 'node:test';

import { adminPreviewDispatchPayload, enabledAdminPreviewEnvironments } from './adminPreviewController';

const pr = {
  number: 505,
  state: 'open',
  draft: false,
  base: { repo: { id: 42, full_name: 'lopugit/thingtime' } },
  head: { ref: 'codex/example', sha: 'a'.repeat(40), repo: { id: 42, full_name: 'lopugit/thingtime' } }
};

test('admin preview dispatch carries every selected environment to github-actions', () => {
  const payload = adminPreviewDispatchPayload({
    pr,
    policy: { develop: true, production: true },
    action: 'configure'
  });
  assert.equal(payload.event_type, 'develop-pr-preview-controller');
  assert.equal(payload.client_payload.admin_preview, '1');
  assert.equal(payload.client_payload.pr_number, '505');
  assert.equal(payload.client_payload.head_sha, 'a'.repeat(40));
  assert.equal(payload.client_payload.head_ref, 'codex/example');
  assert.deepEqual(payload.client_payload.environments, ['develop', 'production']);
});

test('admin preview dispatch sends the full remaining policy when one environment is disabled', () => {
  assert.deepEqual(enabledAdminPreviewEnvironments({ develop: false, production: true }), ['production']);
  assert.deepEqual(enabledAdminPreviewEnvironments({ develop: false, production: false }), []);
});

test('admin preview dispatch rejects stale or malformed source identity', () => {
  assert.throws(
    () => adminPreviewDispatchPayload({ pr: { ...pr, head: { ...pr.head, sha: 'nope' } }, policy: { develop: true, production: false }, action: 'synchronize' }),
    /source is invalid/
  );
  assert.throws(
    () => adminPreviewDispatchPayload({ pr: { ...pr, head: { ...pr.head, ref: '../main' } }, policy: { develop: true, production: false }, action: 'synchronize' }),
    /source is invalid/
  );
});
