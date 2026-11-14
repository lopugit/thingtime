import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
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
  assert.equal(calls[0].redirect, 'manual');
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
    assert.equal(init?.redirect, 'manual');
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


test('bound Vercel SSO challenge reports authentication required without following it', async () => {
  const target = 'https://staging.thingtime.com/';
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    // Model native fetch: redirect:error rejects before exposing headers.
    if (init?.redirect === 'error') throw new TypeError('fetch failed');
    assert.equal(init?.redirect, 'manual');
    return new Response(null, { status: 302, headers: {
      location: `https://vercel.com/sso-api?url=${encodeURIComponent(target)}&nonce=opaque`
    } });
  };
  await assert.rejects(fetchWithTimeout(target), ProtectedStatusTargetError);
  assert.equal(calls, 1);
});


test('only an exact configured target and unambiguous bound SSO redirect are protected', async () => {
  const target = 'https://staging.thingtime.com/api/v1/health/nitro';
  const valid = `https://vercel.com/sso-api?url=${encodeURIComponent(target)}&nonce=opaque`;
  const invalid = [
    valid.replace('vercel.com/', 'vercel.com.evil.test/'),
    valid.replace('https://', 'http://'),
    valid.replace('vercel.com/', 'vercel.com:443/'),
    valid.replace('vercel.com/', 'name@vercel.com/'),
    valid.replace('/sso-api?', '/sso-api/?'),
    valid + '#', valid + '#fragment', valid + '&extra=value',
    valid + '&url=' + encodeURIComponent(target), valid + '&nonce=other',
    valid.replace('nonce=opaque', 'nonce='), valid.replace('nonce=opaque', 'nonce=%20'),
    valid.replace('nonce=opaque', 'nonce=%0A'),
    valid.replace(encodeURIComponent(target), encodeURIComponent('https://staging.thingtime.com/')),
    valid.replace(encodeURIComponent(target), encodeURIComponent('https://evil.test/api/v1/health/nitro')),
    '/sso-api?url=' + encodeURIComponent(target) + '&nonce=opaque',
    valid.replace('sso-api?', 'sso-api? ')
  ];
  for (const location of invalid) {
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location } });
    await assert.rejects(fetchWithTimeout(target), error => !(error instanceof ProtectedStatusTargetError));
  }
  for (const status of [301, 303, 307, 308]) {
    globalThis.fetch = async () => new Response(null, { status, headers: { location: valid } });
    await assert.rejects(fetchWithTimeout(target), error => !(error instanceof ProtectedStatusTargetError));
  }
  const foreign = 'https://unconfigured.vercel.app/api/v1/health/nitro';
  globalThis.fetch = async () => new Response(null, { status: 302, headers: {
    location: `https://vercel.com/sso-api?url=${encodeURIComponent(foreign)}&nonce=opaque`
  } });
  await assert.rejects(fetchWithTimeout(foreign), error => !(error instanceof ProtectedStatusTargetError));
});

test('unrecognized redirects are refused before consumption and network failures remain failures', async () => {
  let consumed = false;
  globalThis.fetch = async () => new Response('Thingtime', { status: 302, headers: { location: 'https://evil.test/' } });
  await assert.rejects(fetchWithTimeout('https://staging.thingtime.com/', {}, undefined, async response => {
    consumed = true;
    return response.text();
  }), /redirect refused/);
  assert.equal(consumed, false);
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(fetchWithTimeout('https://staging.thingtime.com/'), error => !(error instanceof ProtectedStatusTargetError));
});


test('native HTTP fetch inspects SSO without following redirects and preserves readiness, outage and timeout', async () => {
  const priorLocal = process.env.THINGTIME_LOCAL_STATUS_ORIGIN;
  globalThis.fetch = originalFetch;
  let followed = 0;
  const server = createServer((request, response) => {
    const origin = process.env.THINGTIME_LOCAL_STATUS_ORIGIN;
    if (request.url === '/protected') {
      response.writeHead(302, { location: `https://vercel.com/sso-api?url=${encodeURIComponent(`${origin}/protected`)}&nonce=opaque` });
      response.end();
    } else if (request.url === '/redirect') {
      response.writeHead(302, { location: `${origin}/followed` }); response.end();
    } else if (request.url === '/followed') {
      followed++; response.end('should not be fetched');
    } else if (request.url === '/slow') {
      // The request stays open until the caller's deadline aborts it.
    } else {
      response.writeHead(request.url === '/outage' ? 503 : 200);
      response.end('<div id="root"></div>');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  process.env.THINGTIME_LOCAL_STATUS_ORIGIN = origin;
  try {
    await assert.rejects(fetchWithTimeout(`${origin}/protected`), ProtectedStatusTargetError);
    await assert.rejects(fetchWithTimeout(`${origin}/redirect`), /redirect refused/);
    assert.equal(followed, 0);
    const ready = await fetchWithTimeout(`${origin}/ready`, {}, undefined, response => response.text());
    assert.equal(ready.response.status, 200);
    assert.match(ready.body || '', /root/);
    const outage = await fetchWithTimeout(`${origin}/outage`, {}, undefined, response => response.text());
    assert.equal(outage.response.status, 503);
    await assert.rejects(fetchWithTimeout(`${origin}/slow`, {}, Date.now() + 40), { name: 'TimeoutError' });
  } finally {
    if (priorLocal === undefined) delete process.env.THINGTIME_LOCAL_STATUS_ORIGIN;
    else process.env.THINGTIME_LOCAL_STATUS_ORIGIN = priorLocal;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
