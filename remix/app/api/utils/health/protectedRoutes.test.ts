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
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).has('cookie'), false);
      assert.equal(new Headers(init?.headers).has('x-vercel-protection-bypass'), false);
    }
  } finally {
    globalThis.fetch = priorFetch;
    if (priorBranch === undefined) delete process.env.VERCEL_BRANCH_URL;
    else process.env.VERCEL_BRANCH_URL = priorBranch;
  }
});
