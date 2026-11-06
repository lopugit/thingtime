import assert from 'node:assert/strict';
import test from 'node:test';

import { loader } from './_mongodb';

test('remote MongoDB failure returns the complete status shape without forwarding cookies', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; headers: Headers }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response('unavailable', { status: 503 });
  };

  try {
    const response = await loader({
      request: new Request('https://local.thingtime.test/api/v1/health/mongodb?targetOrigin=https%3A%2F%2Fremote.thingtime.com', {
        headers: { cookie: 'local-session=private' }
      })
    });
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(body).sort(), [
      'checkedAt', 'collections', 'connected', 'custom', 'dbName', 'error', 'host', 'pingMs', 'replicaSet'
    ]);
    assert.equal(body.connected, false);
    assert.equal(body.custom, false);
    assert.equal(body.replicaSet, null);
    assert.equal(body.host, null);
    assert.equal(body.dbName, null);
    assert.equal(body.pingMs, null);
    assert.equal(body.collections, null);
    assert.equal(typeof body.checkedAt, 'string');
    assert.equal(typeof body.error, 'string');
    assert.deepEqual(requests.map(({ url }) => url), [
      'https://remote.thingtime.com/api/v1/health/mongodb',
      'https://remote.thingtime.com/api/v1/mongodb/status-data'
    ]);
    for (const request of requests) {
      assert.equal(request.headers.get('accept'), 'application/json');
      assert.equal(request.headers.get('cookie'), null);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
