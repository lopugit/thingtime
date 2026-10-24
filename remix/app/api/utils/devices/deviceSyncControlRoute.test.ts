import assert from 'node:assert/strict';
import test from 'node:test';
import { REMOTE_SYNC_RESULT_BYTES } from '~/fileSync/remoteSyncProtocol';
import { createDeviceSyncControlHandlers } from '../../../routes/api/v1/devices/sync-control/_sync-control';

function fixture() {
  let user: any = { id: 'owner', accountKind: 'user', temporary: false }, plane = 'home', allowed = true;
  const calls: any[] = [];
  const route = createDeviceSyncControlHandlers({ user: async () => user, plane: () => plane,
    limit: async () => ({ allowed, retryAfterSeconds: 60 } as any),
    control: async (owner, input) => { calls.push({ owner, input }); return { ok: true, status: 'pending' } as any; } });
  const request = (method = 'POST', headers: Record<string, string> = {}, body: any = { action: 'poll', deviceId: 'device' }) =>
    new Request('https://thingtime.test/api/v1/devices/sync-control?deviceId=device&requestId=request&ownerId=foreign',
      { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
  return { route, request, calls, user: (value: any) => { user = value; }, plane: (value: string) => { plane = value; }, limit: () => { allowed = false; } };
}
test('auth identity is server-derived and all responses are private', async () => {
  const f = fixture(); const response = await f.route.loader({ request: f.request('GET') });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(f.calls, [{ owner: 'owner', input: { action: 'read', deviceId: 'device', requestId: 'request' } }]);
});
test('unauthenticated, temporary, service, changed-account, foreign-origin and custom-plane requests fail before storage', async () => {
  const f = fixture();
  for (const [user, status] of [[null, 401], [{ id: 'owner', accountKind: 'service' }, 403], [{ id: 'owner', accountKind: 'user', temporary: true }, 403]] as const) {
    f.user(user); assert.equal((await f.route.action({ request: f.request() })).status, status);
  }
  f.user({ id: 'owner', accountKind: 'user' });
  assert.equal((await f.route.action({ request: f.request('POST', { 'X-Thingtime-Expected-Actor': 'other' }) })).status, 409);
  assert.equal((await f.route.action({ request: f.request('POST', { Origin: 'https://foreign.test' }) })).status, 403);
  assert.equal((await f.route.action({ request: f.request('POST', { 'Sec-Fetch-Site': 'cross-site' }) })).status, 403);
  f.plane('custom-other'); assert.equal((await f.route.action({ request: f.request() })).status, 409);
  assert.equal(f.calls.length, 0);
});
test('methods, content types, oversized bodies and rate limits fail privately', async () => {
  const f = fixture();
  assert.equal((await f.route.action({ request: f.request('DELETE') })).status, 405);
  assert.equal((await f.route.action({ request: f.request('POST', { 'Content-Type': 'text/plain' }) })).status, 415);
  assert.equal((await f.route.action({ request: f.request('POST', {}, { data: 'x'.repeat(REMOTE_SYNC_RESULT_BYTES + 8192) }) })).status, 413);
  f.limit(); const response = await f.route.action({ request: f.request() });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(f.calls.length, 0);
});
