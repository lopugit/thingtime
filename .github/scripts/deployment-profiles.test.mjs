import assert from 'node:assert/strict';
import test from 'node:test';
import { profiles, matchesTarget, origin, legacyEnabled } from './deployment-profiles.mjs';
import { publishParallel } from './publish-parallel.mjs';

const feature = 'api.integration-ci-deployment-profiles';
const path = '/api/v1/integrations/ci/deployment-profiles';
const repository = 'lopugit/thingtime';
const row = { id: 'hobby', mode: 'parallel', teamId: 'team_test', teamSlug: 'test', projectId: 'prj_test', projectName: 'app', testOrigin: 'https://app-test.vercel.app', enabled: true };
const manifest = { schemaVersion: 1, origin, features: { [feature]: { version: '1.0.0' } }, operations: [{ path, feature, methods: ['POST'] }] };
const env = { THINGTIME_CI_ROUTER_SECRET: 'fixture', GITHUB_REPOSITORY: repository, VERCEL_PROJECT_ID: row.projectId, VERCEL_TEAM_ID: row.teamId, VERCEL_TEAM_SLUG: row.teamSlug, VERCEL_PROJECT_NAME: row.projectName };
const response = (value) => Response.json(value);
test('requires exact origin before signing and rejects duplicate or unsafe targets', async () => {
  const read = (rows, m = manifest) => profiles(env, async (url, init) => {
    assert.equal(init.redirect, 'error');
    if (url === origin + path) {
      assert.match(init.headers['x-thingtime-ci-signature'], /^sha256=[a-f0-9]{64}$/);
      assert.equal(JSON.parse(init.body).purpose, 'deployment-profiles');
      return response({ ok: true, repository, profiles: rows });
    }
    return response(m);
  });
  assert.deepEqual(await read([row]), [row]);
  await assert.rejects(read([row], { ...manifest, origin: 'https://different.example' }), /unavailable/);
  await assert.rejects(read([row, row]), /identity/);
  await assert.rejects(read([{ ...row, testOrigin: 'https://thingtime.com' }]), /identity/);
  assert.equal(matchesTarget(row, { ...env, VERCEL_TEAM_ID: 'team_other' }), false);
  assert.equal(await legacyEnabled({}), true);
});
test('parallel publisher checks pinned identities, environment inventory and domains before upload', async () => {
  const sha = 'f'.repeat(40);
  const input = { ...env, PROFILE_ID: row.id, GITHUB_REF: 'refs/heads/main', SOURCE_SHA: sha, VERCEL_DEPLOY_TOKEN: 'test', TEST_ORIGIN: row.testOrigin };
  const fake = (envs, domains) => async (url) => {
    const q = new URL(url);
    if (q.host === 'api.github.com') return response({ object: { sha } });
    if (q.pathname === path) return response({ ok: true, repository, profiles: [row] });
    if (q.host === 'thingtime.com') return response(manifest);
    assert.equal(q.searchParams.get('teamId'), row.teamId);
    if (q.pathname.endsWith('/env')) return response({ envs });
    if (q.pathname.endsWith('/domains')) return response({ domains });
    return response({ id: row.projectId, accountId: row.teamId, name: row.projectName });
  };
  await assert.rejects(publishParallel(input, fake([{ key: 'EXAMPLE' }], [])), /zero/);
  await assert.rejects(publishParallel(input, fake([], [{ name: 'thingtime.com' }])), /alias/);
  await assert.rejects(publishParallel({ ...input, VERCEL_TEAM_ID: 'team_other' }, fake([], [])), /GitHub environment/);
});
