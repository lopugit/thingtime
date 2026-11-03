import assert from 'node:assert/strict';
import test from 'node:test';
import { createMongoConnectionsLoader, loader } from './_connections';

const request = () => new Request('https://inventory.example/api/v1/admin/mongodb/connections');

test('real anonymous route fails closed with no-store and does not invoke telemetry', async () => {
  const response = await loader({ request: request() });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.deepEqual(await response.json(), { ok: false, error: 'Unauthorized' });
});

test('admin route refuses non-admins before rate/storage reads, and validates cursors before querying', async () => {
  let reads = 0;
  const read = async () => { reads++; return {} as any; };
  const reject = createMongoConnectionsLoader({ requireAdmin: async () => ({ error: { status: 403, message: 'Admins only' } }), read,
    enforceRateLimit: async () => { assert.fail('authorization must precede limiter storage'); } });
  assert.equal((await reject({ request: request() })).status, 403);
  const invalid = createMongoConnectionsLoader({ requireAdmin: async () => ({ user: { id: 'admin' } as any }), read,
    enforceRateLimit: async () => { assert.fail('invalid cursors must not access storage'); } });
  const response = await invalid({ request: new Request(request().url + '?cursor=invalid') });
  assert.equal(response.status, 400);
  assert.equal(reads, 0);
  assert.equal(response.headers.get('pragma'), 'no-cache');
});

test('authorized route uses private home inventory page and contains raw infrastructure errors', async () => {
  let input: any;
  const route = createMongoConnectionsLoader({ requireAdmin: async () => ({ user: { id: 'admin' } as any }),
    enforceRateLimit: async () => ({ allowed: true, limit: 30, remaining: 29, resetAt: new Date().toISOString() }),
    read: async page => { input = page; return { sources: [], coverage: { complete: false, notes: [] } } as any; } });
  const response = await route({ request: request() });
  assert.equal(response.status, 200);
  assert.deepEqual(input, { cursor: null, limit: 50 });
  assert.equal((await response.json()).ok, true);
  const failed = createMongoConnectionsLoader({ requireAdmin: async () => ({ user: { id: 'admin' } as any }),
    enforceRateLimit: async () => ({ allowed: true, limit: 30, remaining: 29, resetAt: new Date().toISOString() }), read: async () => { throw new Error('mongodb://private:secret@db'); } });
  const error = await failed({ request: request() });
  assert.equal(error.status, 503);
  assert.ok(!(await error.text()).includes('secret'));
});

test('service admins and changed origin or actor cannot read connection telemetry', async () => {
  let kind: 'user' | 'service' = 'service', reads = 0;
  const route = createMongoConnectionsLoader({ requireAdmin: async () => ({ user: { id: 'admin', accountKind: kind } as any }),
    enforceRateLimit: async () => ({ allowed: true, limit: 30, remaining: 29, resetAt: new Date().toISOString() }), read: async () => { reads++; return {} as any; } });
  assert.equal((await route({ request: request() })).status, 403);
  kind = 'user';
  for (const headers of [{ 'X-Thingtime-Expected-Actor': 'other-user' }, { 'X-Thingtime-Expected-Api-Origin': 'https://another.example' }]) {
    assert.equal((await route({ request: new Request(request().url, { headers }) })).status, 409);
  }
  assert.equal(reads, 0);
});
