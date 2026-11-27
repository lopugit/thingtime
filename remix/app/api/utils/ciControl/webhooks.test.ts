import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ciFeatureIdentity,
  isCiWebhookDetailEvent,
  verifyGitHubWebhookSignature,
  verifyVercelWebhookSignature
} from './webhooks';
import { ciEntityKey } from './store';

test('CI detail deliveries are recognised so the webhook can skip them before any write', () => {
  assert.equal(isCiWebhookDetailEvent('workflow_job', { action: 'completed' }), true);
  assert.equal(isCiWebhookDetailEvent('deployment', {}), true);
  assert.equal(isCiWebhookDetailEvent('deployment_status', {}), true);
  assert.equal(isCiWebhookDetailEvent('workflow_run', { workflow_run: { display_title: 'Lopu manages PRs after workflow_run' } }), true);
  // Feature Stack runs keep their workflow_run link.
  assert.equal(
    isCiWebhookDetailEvent('workflow_run', { workflow_run: { display_title: 'Stack feature-stack-run-0b2f6a3e-1c4d-4e5f-8a9b-0c1d2e3f4a5b' } }),
    false
  );
  for (const action of ['labeled', 'unlabeled', 'assigned', 'review_requested', 'auto_merge_enabled', '']) {
    assert.equal(isCiWebhookDetailEvent('pull_request', { action }), true, action);
  }
  for (const action of ['opened', 'reopened', 'synchronize', 'closed', 'ready_for_review', 'converted_to_draft', 'edited']) {
    assert.equal(isCiWebhookDetailEvent('pull_request', { action }), false, action);
  }
  for (const eventType of ['push', 'create', 'delete', 'ping']) {
    assert.equal(isCiWebhookDetailEvent(eventType, {}), false, eventType);
  }
});

test('GitHub webhook verification matches the published HMAC-SHA256 vector', () => {
  const payload = 'Hello, World!';
  const signature = 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';
  assert.equal(verifyGitHubWebhookSignature(payload, signature, "It's a Secret to Everybody"), true);
  assert.equal(verifyGitHubWebhookSignature(`${payload}!`, signature, "It's a Secret to Everybody"), false);
  assert.equal(verifyGitHubWebhookSignature(payload, null, "It's a Secret to Everybody"), false);
});

test('Vercel webhook verification uses the signed raw payload exactly', () => {
  const payload = '{"type":"deployment.ready"}';
  const signature = '39e3d923d99a99f74c3924bf949eb2b0c5aed5ea';
  assert.equal(verifyVercelWebhookSignature(payload, signature, 'vercel-test-secret'), true);
  assert.equal(verifyVercelWebhookSignature(`${payload}\n`, signature, 'vercel-test-secret'), false);
});

test('promotion metadata groups source and promotion PRs under one feature key', () => {
  assert.deepEqual(
    ciFeatureIdentity({
      body: '<!-- promotion-of: 172 -->\nPromotion-Group: social-suite',
      labels: ['promotion'],
      prNumber: 220
    }),
    { featureKey: 'group:social-suite', sourcePrNumber: 172, promotionGroup: 'social-suite' }
  );
  assert.deepEqual(
    ciFeatureIdentity({ body: '<!-- promotion-of: 172 -->', labels: ['promotion'], prNumber: 220 }),
    { featureKey: 'source-pr:172', sourcePrNumber: 172, promotionGroup: null }
  );
  assert.deepEqual(ciFeatureIdentity({ body: '', labels: [], prNumber: 220 }), {
    featureKey: 'pr:220',
    sourcePrNumber: null,
    promotionGroup: null
  });
});

test('entity keys are provider, repository, kind, and external-id scoped', () => {
  assert.equal(
    ciEntityKey({
      provider: 'github',
      repository: 'lopugit/thingtime',
      kind: 'ci-pull-request',
      externalId: '172'
    }),
    'github:lopugit/thingtime:ci-pull-request:172'
  );
});
