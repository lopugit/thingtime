import assert from 'node:assert/strict';
import test from 'node:test';

import { isVercelStatusEnabled } from './environment';

test('deployment status stays enabled for a custom target backed by Preview', () => {
  assert.equal(
    isVercelStatusEnabled({
      NODE_ENV: 'production',
      VERCEL_ENV: 'preview',
      VERCEL_TARGET_ENV: 'develop'
    }),
    true
  );
});

test('deployment status checks the system and target environments independently', () => {
  assert.equal(
    isVercelStatusEnabled({ NODE_ENV: 'production', VERCEL_ENV: 'production' }),
    true
  );
  assert.equal(
    isVercelStatusEnabled({ NODE_ENV: 'production', VERCEL_TARGET_ENV: 'preview' }),
    true
  );
});

test('deployment status remains available locally or through the explicit override', () => {
  assert.equal(isVercelStatusEnabled({ NODE_ENV: 'development' }), true);
  assert.equal(
    isVercelStatusEnabled({
      NODE_ENV: 'production',
      THINGTIME_SHOW_DEPLOYMENT_STATUS: 'true',
      VERCEL_TARGET_ENV: 'other'
    }),
    true
  );
});

test('deployment status remains hidden outside an enabled environment', () => {
  assert.equal(
    isVercelStatusEnabled({
      NODE_ENV: 'production',
      VERCEL_TARGET_ENV: 'other'
    }),
    false
  );
});
