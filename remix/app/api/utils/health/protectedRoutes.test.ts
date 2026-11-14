import assert from 'node:assert/strict';
import test from 'node:test';

import { loader as frontend } from '../../../routes/api/v1/health/frontend/_frontend';
import { loader as nitro } from '../../../routes/api/v1/health/nitro/_nitro';
import { loader as mongodb } from '../../../routes/api/v1/health/mongodb/_mongodb';
import { loader as vercel } from '../../../routes/api/v1/health/vercel/_vercel';

test('all remote health projections identify protected platform branch without forwarding credentials', async () => {
  const priorFetch = globalThis.fetch;
  const priorBranch = process.env.VERCEL_BRANCH_URL;
  process.env.VERCEL_BRANCH_URL = 'thingtime-git-main.vercel.app';
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(null, { status: 403 });
  };
  try {
    const request = new Request('https://thingtime.com/api/v1/health/frontend?targetOrigin=https%3A%2F%2Fthingtime-git-main.vercel.app', {
      headers: { Cookie: 'tt_auth=private' }
    });
    for (const loader of [frontend, nitro, mongodb, vercel]) {
      const response = await loader({ request });
      assert.equal(response.status, 200);
      const body = await response.json() as Record<string, unknown>;
      assert.match(JSON.stringify(body), /authentication required|requires authentication/i);
      assert.doesNotMatch(JSON.stringify(body), /tt_auth=private/);
    }
    assert.equal(requests.length, 4, 'protected branches do not trigger legacy fallback probes');
    for (const { url, init } of requests) {
      assert.ok(url.startsWith('https://thingtime-git-main.vercel.app/'));
      assert.equal(init?.redirect, 'manual');
      assert.equal(new Headers(init?.headers).has('cookie'), false);
      assert.equal(new Headers(init?.headers).has('x-vercel-protection-bypass'), false);
    }
  } finally {
    globalThis.fetch = priorFetch;
    if (priorBranch === undefined) delete process.env.VERCEL_BRANCH_URL;
    else process.env.VERCEL_BRANCH_URL = priorBranch;
  }
});


test('all configured custom-origin health projections identify exact SSO challenges and stay anonymous', async () => {
  const priorFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(null, { status: 302, headers: {
      location: `https://vercel.com/sso-api?url=${encodeURIComponent(String(url))}&nonce=opaque`
    } });
  };
  try {
    const request = new Request('https://thingtime.com/api/v1/health/frontend?targetOrigin=https%3A%2F%2Fstaging.thingtime.com', {
      headers: { Cookie: 'tt_auth=private', Authorization: 'Bearer private' }
    });
    for (const loader of [frontend, nitro, mongodb, vercel]) {
      const response = await loader({ request });
      assert.equal(response.status, 200);
      const body = JSON.stringify(await response.json());
      assert.match(body, /authentication required|requires authentication/i);
      assert.doesNotMatch(body, /tt_auth|Bearer|sso-api|nonce|opaque/);
    }
    assert.equal(requests.length, 4);
    for (const { url, init } of requests) {
      assert.ok(url.startsWith('https://staging.thingtime.com/'));
      assert.equal(init?.redirect, 'manual');
      const headers = new Headers(init?.headers);
      for (const name of ['cookie', 'authorization', 'x-vercel-protection-bypass']) assert.equal(headers.has(name), false);
    }
  } finally {
    globalThis.fetch = priorFetch;
  }
});


test('current custom preview frontend recognizes SSO with every status-origin override unset', async () => {
  const priorFetch = globalThis.fetch;
  const names = [
    'THINGTIME_PRODUCTION_STATUS_ORIGIN', 'THINGTIME_PROD_STATUS_ORIGIN',
    'THINGTIME_DEVELOPMENT_STATUS_ORIGIN', 'THINGTIME_DEV_STATUS_ORIGIN',
    'THINGTIME_STAGING_STATUS_ORIGIN', 'THINGTIME_STAGE_STATUS_ORIGIN',
    'THINGTIME_LOCAL_STATUS_ORIGIN', 'VERCEL_BRANCH_URL', 'VERCEL_URL'
  ];
  const prior = names.map(name => process.env[name]);
  for (const name of names) delete process.env[name];
  const urls: string[] = [];
  globalThis.fetch = async (url, init) => {
    urls.push(String(url));
    assert.equal(init?.redirect, 'manual');
    return new Response(null, { status: 302, headers: {
      location: `https://vercel.com/sso-api?url=${encodeURIComponent(String(url))}&nonce=opaque`
    } });
  };
  try {
    for (const origin of ['https://master.previews.thingtime.com', 'https://master.previews.dev.thingtime.com']) {
      const response = await frontend({ request: new Request(`${origin}/api/v1/health/frontend`) });
      const body = await response.json();
      assert.equal(body.label, 'Frontend: authentication required');
      assert.equal(body.ok, false);
      assert.equal(body.targetOrigin, origin);
    }
    assert.deepEqual(urls, ['https://master.previews.thingtime.com/', 'https://master.previews.dev.thingtime.com/']);
  } finally {
    globalThis.fetch = priorFetch;
    names.forEach((name, index) => {
      if (prior[index] === undefined) delete process.env[name];
      else process.env[name] = prior[index];
    });
  }
});
