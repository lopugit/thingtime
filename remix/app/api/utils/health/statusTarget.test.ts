import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { ProtectedStatusTargetError, fetchRemoteJson, fetchWithTimeout, isPlatformGeneratedStatusOrigin } from './statusTarget';

const originalFetch = globalThis.fetch;
const originalBranch = process.env.VERCEL_BRANCH_URL;
const originalDeployment = process.env.VERCEL_URL;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBranch === undefined) delete process.env.VERCEL_BRANCH_URL;
  else process.env.VERCEL_BRANCH_URL = originalBranch;
  if (originalDeployment === undefined) delete process.env.VERCEL_URL;
  else process.env.VERCEL_URL = originalDeployment;
});

test('only exact platform generated origins qualify as protected status targets', () => {
  process.env.VERCEL_BRANCH_URL = 'thingtime-git-main.vercel.app';
  process.env.VERCEL_URL = 'thingtime-abc.vercel.app';
  assert.equal(isPlatformGeneratedStatusOrigin('https://thingtime-git-main.vercel.app'), true);
  assert.equal(isPlatformGeneratedStatusOrigin('https://thingtime-abc.vercel.app'), true);
  assert.equal(isPlatformGeneratedStatusOrigin('https://attacker.vercel.app'), false);
  assert.equal(isPlatformGeneratedStatusOrigin('https://thingtime.com'), false);
});

test('accessible branch health stays anonymous, redirection is refused, and no bypass secret is sent', async () => {
  process.env.VERCEL_BRANCH_URL = 'thingtime-git-main.vercel.app';
  const calls: RequestInit[] = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(init || {});
    return Response.json({ ok: true });
  };
  const result = await fetchRemoteJson<{ ok: boolean }>('https://thingtime-git-main.vercel.app', '/api/v1/health/nitro');
  assert.equal(result.data.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].redirect, 'error');
  assert.equal(calls[0].cache, 'no-store');
  assert.equal(new Headers(calls[0].headers).has('x-vercel-protection-bypass'), false);
});

test('401 from exact branch reports protected without probing a fallback route', async () => {
  process.env.VERCEL_BRANCH_URL = 'thingtime-git-main.vercel.app';
  const urls: string[] = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(null, { status: 401 });
  };
  await assert.rejects(fetchRemoteJson('https://thingtime-git-main.vercel.app', '/api/v1/health/mongodb', '/api/v1/mongodb/status-data'), ProtectedStatusTargetError);
  assert.deepEqual(urls, ['https://thingtime-git-main.vercel.app/api/v1/health/mongodb']);
});

test('unrelated vercel.app 403 does not receive platform protected classification', async () => {
  process.env.VERCEL_BRANCH_URL = 'thingtime-git-main.vercel.app';
  globalThis.fetch = async () => new Response(null, { status: 403 });
  await assert.rejects(fetchRemoteJson('https://attacker.vercel.app', '/api/v1/health/nitro'), error =>
    !(error instanceof ProtectedStatusTargetError));
});

test('legacy fallback shares the original deadline and cannot follow redirects', async (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const urls: string[] = [];
  globalThis.fetch = async (url, init) => {
    urls.push(String(url));
    assert.equal(init?.redirect, 'error');
    now += 3500;
    return new Response(null, { status: 503 });
  };
  await assert.rejects(fetchRemoteJson('https://dev.thingtime.com', '/api/v1/health/mongodb', '/api/v1/mongodb/status-data'));
  assert.equal(urls.length, 1, 'the legacy fallback cannot start after the shared deadline');
  await assert.rejects(fetchWithTimeout('https://dev.thingtime.com/api/v1/health/mongodb', {}, now - 1), { name: 'TimeoutError' });
  assert.equal(urls.length, 1);
});

test('headers arriving promptly do not let a stalled body exceed the deadline', async () => {
  globalThis.fetch = async () => new Response(new ReadableStream({ start() {} }), { status: 200 });
  const started = Date.now();
  await assert.rejects(fetchWithTimeout('https://dev.thingtime.com/api/v1/health/mongodb', {}, started + 40,
    response => response.json()), { name: 'TimeoutError' });
  assert.ok(Date.now() - started < 1000);
});
