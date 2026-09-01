import assert from 'node:assert/strict';
import test from 'node:test';

import { rootDataResponse } from './root-data.server';

const TEST_ENV_KEYS = [
  'NODE_ENV',
  'VERCEL_ENV',
  'VERCEL_GIT_COMMIT_REF',
  'VERCEL_GIT_COMMIT_SHA',
  'VERCEL_URL',
  'THINGTIME_CI_ROUTER_SECRET',
  'THINGTIME_DEVELOPMENT_STATUS_ORIGIN',
  'THINGTIME_DATA_ENV',
  'THINGTIME_DATA_AUTHORITY_ORIGIN',
  'THINGTIME_FEDERATION_ID',
  'THINGTIME_DEV_STATUS_ORIGIN',
  'THINGTIME_EMAIL_UNSUB_SECRET',
  'THINGTIME_GITHUB_WEBHOOK_SECRET',
  'THINGTIME_LOCAL_STATUS_ORIGIN',
  'THINGTIME_PRODUCTION_STATUS_ORIGIN',
  'THINGTIME_PROD_STATUS_ORIGIN',
  'THINGTIME_PUBLIC_LABEL',
  'THINGTIME_STAGING_STATUS_ORIGIN',
  'THINGTIME_STAGE_STATUS_ORIGIN',
  'THINGTIME_VERCEL_WEBHOOK_SECRET'
] as const;

const withTestEnv = async (run: () => Promise<void>) => {
  const previous = Object.fromEntries(TEST_ENV_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: 'production',
    VERCEL_ENV: 'production',
    VERCEL_GIT_COMMIT_REF: 'main',
    VERCEL_GIT_COMMIT_SHA: 'abc123',
    VERCEL_URL: 'thingtime.example.vercel.app',
    THINGTIME_CI_ROUTER_SECRET: 'router-secret-must-not-leak',
    THINGTIME_DEVELOPMENT_STATUS_ORIGIN: 'https://development.thingtime.com',
    THINGTIME_DATA_ENV: 'production',
    THINGTIME_DEV_STATUS_ORIGIN: 'https://dev.thingtime.com',
    THINGTIME_EMAIL_UNSUB_SECRET: 'unsubscribe-secret-must-not-leak',
    THINGTIME_GITHUB_WEBHOOK_SECRET: 'github-secret-must-not-leak',
    THINGTIME_LOCAL_STATUS_ORIGIN: 'http://localhost:9999',
    THINGTIME_PRODUCTION_STATUS_ORIGIN: 'https://production.thingtime.com',
    THINGTIME_PROD_STATUS_ORIGIN: 'https://prod.thingtime.com',
    THINGTIME_PUBLIC_LABEL: 'not-secret-looking-but-not-allowlisted',
    THINGTIME_STAGING_STATUS_ORIGIN: 'https://staging.thingtime.com',
    THINGTIME_STAGE_STATUS_ORIGIN: 'https://stage.thingtime.com',
    THINGTIME_VERCEL_WEBHOOK_SECRET: 'vercel-secret-must-not-leak'
  });

  try {
    await run();
  } finally {
    TEST_ENV_KEYS.forEach((key) => {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
};

test('root data exposes only explicit browser-safe deployment values', async () => {
  await withTestEnv(async () => {
    const response = await rootDataResponse(new Request('https://thingtime.com/api/root-data'));
    const body = await response.json();
    const env = body.envFromCookie as Record<string, string | undefined>;

    assert.equal(env.THINGTIME_BRANCH_NAME, 'main');
    assert.equal(env.THINGTIME_DEVELOPMENT_STATUS_ORIGIN, 'https://development.thingtime.com');
    assert.equal(env.THINGTIME_DEV_STATUS_ORIGIN, 'https://dev.thingtime.com');
    assert.equal(env.THINGTIME_LOCAL_STATUS_ORIGIN, 'http://localhost:9999');
    assert.equal(env.THINGTIME_PRODUCTION_STATUS_ORIGIN, 'https://production.thingtime.com');
    assert.equal(env.THINGTIME_PROD_STATUS_ORIGIN, 'https://prod.thingtime.com');
    assert.equal(env.THINGTIME_STAGING_STATUS_ORIGIN, 'https://staging.thingtime.com');
    assert.equal(env.THINGTIME_STAGE_STATUS_ORIGIN, 'https://stage.thingtime.com');
    assert.equal(env.THINGTIME_VERCEL_ENV, 'production');
    assert.equal(env.THINGTIME_VERCEL_GIT_COMMIT_SHA, 'abc123');
    assert.equal(env.THINGTIME_VERCEL_URL, 'thingtime.example.vercel.app');
    assert.deepEqual(body.dataEnvironment, {
      schemaVersion: 1,
      id: 'production',
      kind: 'production',
      federationId: 'production',
      authorityOrigin: 'https://thingtime.com'
    });

    assert.equal('THINGTIME_CI_ROUTER_SECRET' in env, false);
    assert.equal('THINGTIME_EMAIL_UNSUB_SECRET' in env, false);
    assert.equal('THINGTIME_GITHUB_WEBHOOK_SECRET' in env, false);
    assert.equal('THINGTIME_PUBLIC_LABEL' in env, false);
    assert.equal('THINGTIME_VERCEL_WEBHOOK_SECRET' in env, false);
    assert.equal(Object.keys(env).some((key) => /SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY/i.test(key)), false);
  });
});

test('root data is private and non-cacheable', async () => {
  await withTestEnv(async () => {
    const response = await rootDataResponse(new Request('https://thingtime.com/api/root-data'));

    assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0, must-revalidate');
    assert.equal(response.headers.get('Pragma'), 'no-cache');
    assert.match(response.headers.get('Vary') || '', /(?:^|,\s*)Cookie(?:,|$)/i);
  });
});
