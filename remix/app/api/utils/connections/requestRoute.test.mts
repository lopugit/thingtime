import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
let actor: any;
let allowed = true;
const received: any[] = [];
mock.module(new URL('../auth/getCurrentUser.ts', import.meta.url).href, {
  namedExports: { getCurrentUser: async () => actor }
});
mock.module(new URL('../rateLimit/enforce.ts', import.meta.url).href, {
  namedExports: {
    enforceRateLimit: async () => ({ allowed }),
    rateLimitedResponseInit: () => ({ status: 429 })
  }
});
mock.module(new URL('./requests.ts', import.meta.url).href, {
  namedExports: { runConnectionRequest: async (_user: unknown, input: unknown, signal: AbortSignal) => {
    received.push({ input, signal });
    return { ok: true, data: { accepted: true } };
  } }
});
const { action } = await import('../../../routes/api/v1/connections/request/_request.tsx');
beforeEach(() => { actor = { id: 'synthetic-owner' }; allowed = true; received.length = 0; });
const request = (body: unknown) => new Request('https://thingtime.test/api/v1/connections/request', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
test('saved-operation HTTP body preserves opaque pagination tokens larger than 4 KiB', async () => {
  const input = { connectionId: 'synthetic-link', operation: 'drive.list-files', pageToken: 'next&access_token=opaque+/=?' + 'x'.repeat(8192) };
  const req = request(input);
  const response = await action({ request: req });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(received[0].input, { ...input, resourceId: undefined });
  assert.equal(received[0].signal, req.signal);
});
test('uncapped pagination still checks owner authentication and rate admission before provider work', async () => {
  actor = null;
  assert.equal((await action({ request: request({}) })).status, 401);
  actor = { id: 'synthetic-service', accountKind: 'service' };
  assert.equal((await action({ request: request({}) })).status, 401);
  actor = { id: 'synthetic-owner' }; allowed = false;
  assert.equal((await action({ request: request({}) })).status, 429);
  assert.equal(received.length, 0);
});
