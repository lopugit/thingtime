import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  parseCiProviderRouteRequest,
  verifyCiProviderRouteSignature
} from './providerRouter';

test('CI provider route signatures require the exact signed body', () => {
  const secret = 'test-only-router-secret';
  const body = JSON.stringify({ workflow: 'resolve-conflicts' });
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  assert.equal(verifyCiProviderRouteSignature(body, signature, secret), true);
  assert.equal(verifyCiProviderRouteSignature(`${body} `, signature, secret), false);
  assert.equal(verifyCiProviderRouteSignature(body, null, secret), false);
});

test('CI provider route requests are bounded, allowlisted, and fresh', () => {
  const now = Date.parse('2026-08-10T01:00:00.000Z');
  const parsed = parseCiProviderRouteRequest(
    {
      workflow: 'resolve-conflicts',
      deliveryKey: '123:1:push',
      actorId: 'github-actions[bot]',
      requestedAt: new Date(now).toISOString(),
      inputs: { branch: 'develop', pr_number: '', manual_retry: false }
    },
    now
  );
  assert.deepEqual(parsed, {
    workflow: 'resolve-conflicts',
    deliveryKey: '123:1:push',
    actorId: 'github-actions[bot]',
    requestedAt: new Date(now),
    inputs: { branch: 'develop', pr_number: '', manual_retry: false }
  });
  assert.equal(
    parseCiProviderRouteRequest(
      {
        workflow: 'not-a-workflow',
        deliveryKey: '123',
        requestedAt: new Date(now).toISOString(),
        inputs: {}
      },
      now
    ),
    null
  );
  assert.equal(
    parseCiProviderRouteRequest(
      {
        workflow: 'resolve-conflicts',
        deliveryKey: '123',
        requestedAt: new Date(now - 11 * 60 * 1000).toISOString(),
        inputs: {}
      },
      now
    ),
    null
  );
});
