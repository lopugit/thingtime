import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ciFeatureIdentity,
  verifyGitHubWebhookSignature,
  verifyVercelWebhookSignature
} from './webhooks';
import { ciEntityKey } from './store';

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
