import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ciProviderReadiness,
  validateCiExecutionProvider
} from './providerReadiness';

const completeEnvironment = {
  THINGTIME_GITHUB_APP_ID: '123456',
  THINGTIME_GITHUB_APP_INSTALLATION_ID: '987654',
  THINGTIME_GITHUB_APP_PRIVATE_KEY: 'test-only-private-key',
  THINGTIME_CI_ROUTER_SECRET: 'test-only-router-secret',
  VERCEL: '1'
};

test('Vercel presence alone never reports the CI runner ready', () => {
  const readiness = ciProviderReadiness({ VERCEL: '1' });
  assert.equal(readiness.vercelRuntimeConfigured, true);
  assert.equal(readiness.githubAppConfigured, false);
  assert.equal(readiness.vercelRunnerReady, false);
  assert.deepEqual(readiness.missing, [
    'THINGTIME_GITHUB_APP_ID',
    'THINGTIME_GITHUB_APP_INSTALLATION_ID',
    'THINGTIME_GITHUB_APP_PRIVATE_KEY',
    'THINGTIME_CI_ROUTER_SECRET'
  ]);
});

test('the runner is ready only when App, router, and Vercel capabilities are present', () => {
  const readiness = ciProviderReadiness(completeEnvironment);
  assert.deepEqual(readiness, {
    githubAppConfigured: true,
    providerRouterConfigured: true,
    vercelRuntimeConfigured: true,
    vercelRunnerReady: true,
    missing: []
  });
});

test('provider selection fails closed with authored setup guidance', () => {
  assert.deepEqual(validateCiExecutionProvider('github-actions', {}), { ok: true });
  assert.deepEqual(validateCiExecutionProvider('vercel-sandbox', completeEnvironment), { ok: true });
  assert.deepEqual(validateCiExecutionProvider('vercel-sandbox', { VERCEL: '1' }), {
    ok: false,
    error: 'Vercel Sandbox is not ready. Complete the GitHub App, provider router, and Vercel runtime setup first.',
    missing: [
      'THINGTIME_GITHUB_APP_ID',
      'THINGTIME_GITHUB_APP_INSTALLATION_ID',
      'THINGTIME_GITHUB_APP_PRIVATE_KEY',
      'THINGTIME_CI_ROUTER_SECRET'
    ]
  });
});

test('blank configuration values are not treated as credentials', () => {
  const readiness = ciProviderReadiness({
    ...completeEnvironment,
    THINGTIME_GITHUB_APP_PRIVATE_KEY: '   '
  });
  assert.equal(readiness.vercelRunnerReady, false);
  assert.deepEqual(readiness.missing, ['THINGTIME_GITHUB_APP_PRIVATE_KEY']);
});
