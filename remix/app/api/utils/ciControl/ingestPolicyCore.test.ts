import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldRecordEntityEvent } from './ingestPolicyCore';

test('always-policy entities record an event for every accepted delivery', () => {
  assert.equal(
    shouldRecordEntityEvent('always', { inserted: false, previousStatus: 'clean', nextStatus: 'clean', ignoredAsOlder: false }),
    true
  );
  assert.equal(
    shouldRecordEntityEvent('always', { inserted: false, previousStatus: 'clean', nextStatus: 'clean', ignoredAsOlder: true }),
    true
  );
});

test('on-change entities skip the no-op transition that dominated production history', () => {
  const noop = { inserted: false, previousStatus: 'active', nextStatus: 'active', ignoredAsOlder: false };
  assert.equal(shouldRecordEntityEvent('on-change', noop), false);
  assert.equal(shouldRecordEntityEvent('on-change', { ...noop, inserted: true }), true);
  assert.equal(shouldRecordEntityEvent('on-change', { ...noop, nextStatus: 'archived' }), true);
  assert.equal(shouldRecordEntityEvent('on-change', { ...noop, previousStatus: null }), true);
  // a stale delivery that was rejected as older changed nothing either
  assert.equal(shouldRecordEntityEvent('on-change', { ...noop, nextStatus: 'archived', ignoredAsOlder: true }), false);
});
