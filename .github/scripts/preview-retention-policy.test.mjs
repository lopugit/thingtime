import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { parsePreviewRetentionPolicy, previewRetentionCapability, readPreviewRetentionPolicy, pullRequestIsLive, previewGraceElapsed } from './preview-retention-policy.mjs';
import { reconcileOrphanPreviews } from './orphan-preview-cleanup.mjs';
const policy = { version: 1, enabled: true, noOpenPrGraceHours: 0, pruneSupersededOpenPr: false, supersededGraceHours: 24, inactivePullRequestDays: null };
const repository = 'owner/repo', origin = 'https://example.test', feature = 'api.integration-ci-preview-retention', endpoint = '/api/v1/integrations/ci/preview-retention';
const now = Date.parse('2026-10-30T00:00:00Z');
const manifest = () => ({ schemaVersion: 1, origin, features: { [feature]: { version: '1.0.0' } }, operations: [{ feature, path: endpoint, methods: ['POST'] }] });
test('signed policy reader negotiates origin and operation, sends only scoped runtime identity', async () => {
  const calls = [];
  const result = await readPreviewRetentionPolicy({ repository }, { env: { THINGTIME_PREVIEW_POLICY_ORIGIN: origin, THINGTIME_CI_ROUTER_SECRET: 'fixture-secret' }, now: () => now, fetcher: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/.well-known/thingtime-capabilities.json')) return Response.json(manifest());
    assert.equal(url, origin + endpoint); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), { repository, ref: 'github-actions', requestedAt: new Date(now).toISOString() });
    assert.equal(init.headers['X-Thingtime-CI-Signature'], 'sha256=' + createHmac('sha256', 'fixture-secret').update(init.body).digest('hex'));
    assert.ok(!init.body.includes('fixture-secret'));
    return Response.json({ ok: true, repository, policy });
  } });
  assert.deepEqual(result, policy); assert.equal(calls.length, 2);
});
test('policy parser refuses absent, mismatched, malformed and unsafe settings', () => {
  for (const change of [{ version: 2 }, { enabled: 'true' }, { noOpenPrGraceHours: -1 }, { supersededGraceHours: 0.5 }, { inactivePullRequestDays: 0 }, { pruneSupersededOpenPr: null }, { noOpenPrGraceHours: Number.MAX_SAFE_INTEGER }, { inactivePullRequestDays: Number.MAX_SAFE_INTEGER }]) {
    assert.throws(() => parsePreviewRetentionPolicy({ ok: true, repository, policy: { ...policy, ...change } }, repository));
  }
  assert.throws(() => parsePreviewRetentionPolicy({ ok: true, repository: 'other/repo', policy }, repository));
  assert.throws(() => parsePreviewRetentionPolicy({ ok: true, repository }, repository));
});
test('capability check rejects wrong origin, breaking version and missing executable operation', () => {
  assert.equal(previewRetentionCapability(manifest(), origin), true);
  assert.equal(previewRetentionCapability({ ...manifest(), origin: 'https://other.test' }, origin), false);
  assert.equal(previewRetentionCapability({ ...manifest(), features: { [feature]: { version: '2.0.0' } } }, origin), false);
  assert.equal(previewRetentionCapability({ ...manifest(), operations: [] }, origin), false);
});
test('missing secret or unavailable/invalid policy has no destructive fallback', async () => {
  let calls = 0;
  await assert.rejects(readPreviewRetentionPolicy({ repository }, { env: {}, fetcher: () => { calls++; } }), /secret/);
  assert.equal(calls, 0);
  const settings = { env: { THINGTIME_PREVIEW_POLICY_ORIGIN: origin, THINGTIME_CI_ROUTER_SECRET: 'fixture' } };
  await assert.rejects(readPreviewRetentionPolicy({ repository }, { ...settings, fetcher: async () => new Response('', { status: 503 }) }), /HTTP 503/);
  await assert.rejects(readPreviewRetentionPolicy({ repository }, { ...settings, fetcher: async () => Response.json({}) }), /capability/);
  await assert.rejects(reconcileOrphanPreviews({ repository }, { github: () => { calls++; }, vercel: () => { calls++; } }), /invalid/);
  assert.equal(calls, 0);
  assert.deepEqual(await reconcileOrphanPreviews({ repository, retentionPolicy: { ...policy, enabled: false } }, { github: () => { calls++; }, vercel: () => { calls++; } }), { disabled: true, removedIds: [], retainedIds: null });
  assert.equal(calls, 0);
});
test('activity expiry is opt-in, uses fresh updated_at, resumes on activity, never changes PR state', () => {
  const pr = { state: 'open', updated_at: new Date(now - 4 * 86_400_000).toISOString() };
  assert.equal(pullRequestIsLive(pr, policy, now), true);
  const active = { ...policy, inactivePullRequestDays: 3 };
  assert.equal(pullRequestIsLive(pr, active, now), false);
  assert.equal(pullRequestIsLive({ ...pr, updated_at: new Date(now).toISOString() }, active, now), true);
  assert.equal(pullRequestIsLive(pr, { ...active, enabled: false }, now), true);
  assert.equal(pr.state, 'open');
  assert.throws(() => pullRequestIsLive({ state: 'open' }, active, now), /timestamp/);
});
test('grace uses the later deployment/PR-close age and preserves unknown timestamps', () => {
  const grace = { ...policy, noOpenPrGraceHours: 24 }, deployment = { createdAt: now - 48 * 3_600_000 };
  assert.equal(previewGraceElapsed(deployment, grace, { state: 'closed', closed_at: new Date(now - 3_600_000).toISOString() }, now), false);
  assert.equal(previewGraceElapsed(deployment, grace, { state: 'closed', closed_at: new Date(now - 30 * 3_600_000).toISOString() }, now), true);
  assert.throws(() => previewGraceElapsed({}, grace, null, now), /age/);
  assert.throws(() => previewGraceElapsed(deployment, grace, { state: 'closed' }, now), /age/);
});
