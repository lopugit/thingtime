import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
let session: any = { user: { id: 'owner' }, claims: { jti: 'session' } };
let writes = 0;
mock.module('../../../../../api/utils/auth/authCookie.ts', { namedExports: { getAuthToken: async () => 'session-token' } });
mock.module('../../../../../api/utils/auth/getCurrentUser.ts', { namedExports: { resolveTokenUser: async () => session } });
mock.module('../../../../../api/utils/notifications/apns.ts', { namedExports: { pushConfigured: () => true } });
mock.module('../../../../../api/utils/notifications/pushDevices.ts', { namedExports: {
  listPushDevicesForUser: async (owner: string) => { assert.equal(owner, 'owner'); return [{platform: 'ios', token: 'must-stay-private', ownerId: owner}]; },
  registerPushDevices: async () => { writes++; return {ok: true, devices: []}; }, unregisterPushDevice: async () => { writes++; return true; }
} });
mock.module('../../../../../api/utils/watch/watchPairing.ts', { namedExports: { resolveWatchDevice: async () => null } });
mock.module('../../../../../api/utils/rateLimit/enforce.ts', { namedExports: { enforceRateLimit: async () => ({allowed: true}), rateLimitedResponseInit: () => ({status: 429}) } });
const { loader, action } = await import('./_devices.tsx');
test('device status is session-owned and contains only counts and configuration availability', async () => {
  const result = await loader({request: new Request('https://thingtime.com/api/v1/notifications/devices')});
  assert.equal(result.status, 200); assert.match(result.headers.get('cache-control')!, /private, no-store/);
  assert.deepEqual(await result.json(), {ok: true, ownerId: 'owner', configured: true, devices: {ios: 1, watchos: 0}});
});
test('registration rejects an account switch before any device mutation', async () => {
  const result = await action({request: new Request('https://thingtime.com/api/v1/notifications/devices', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ownerId: 'earlier-owner', devices: []})})});
  assert.equal(result.status, 409); assert.equal(writes, 0);
});
test('device diagnostics reject anonymous callers', async () => {
  session = null;
  const result = await loader({request: new Request('https://thingtime.com/api/v1/notifications/devices')});
  assert.equal(result.status, 401);
});
