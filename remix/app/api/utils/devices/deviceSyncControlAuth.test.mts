import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { withInternalRequestActor } from '../auth/internalRequestActor';

let session: any, users: Record<string, any>;
const calls: any[] = [];
mock.module(new URL('../auth/jwt.ts', import.meta.url).href, { namedExports: { verifyJwt: async () => ({ sub: 'owner', jti: 'session' }) } });
mock.module(new URL('../auth/sessions.ts', import.meta.url).href, { namedExports: { getLiveSession: async () => session } });
mock.module(new URL('../auth/users.ts', import.meta.url).href, { namedExports: {
  findUserById: async (id: string) => users[id] ?? null,
  toPublicUser: (user: any) => ({ id: user._id, accountKind: user.accountKind, temporary: user.meta?.temporary === true, isCharacter: !!user.meta?.character })
} });
mock.module(new URL('../subscriptions/subscriptions.ts', import.meta.url).href, { namedExports: { getSubscription: async () => null } });
const { createDeviceSyncControlHandlers } = await import('../../../routes/api/v1/devices/sync-control/_sync-control');
const { action } = createDeviceSyncControlHandlers({ plane: () => 'home', limit: async () => ({ allowed: true } as any),
  control: async (owner, input) => { calls.push({ owner, input }); return { ok: true, command: null } as any; } });
const request = (headers: Record<string, string> = {}) => new Request('https://thingtime.test/api/v1/devices/sync-control', {
  method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ action: 'poll', deviceId: 'device' })
});
beforeEach(() => {
  calls.length = 0;
  session = { jti: 'session', userId: 'owner', purpose: 'browser', meta: {} };
  users = { owner: { _id: 'owner', accountKind: 'user', meta: {} }, character: { _id: 'character', accountKind: 'user',
    meta: { character: { ownerId: 'owner', loginMode: 'switch', disabled: false } } } };
});
test('real account resolver accepts a full user Bearer session and derives its owner', async () => {
  assert.equal((await action({ request: request() })).status, 200);
  assert.deepEqual(calls, [{ owner: 'owner', input: { action: 'poll', deviceId: 'device' } }]);
});
test('real account resolver refuses scoped app, PAT, device and unknown credential purposes', async () => {
  for (const purpose of ['pat', 'app', 'app-sandbox', 'device', 'device-node', 'future-scope']) {
    session.purpose = purpose;
    const response = await action({ request: request() });
    assert.equal(response.status, 401, purpose);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
  assert.equal(calls.length, 0);
});
test('Character selections and synthetic Action principals cannot control devices', async () => {
  assert.equal((await action({ request: request({ 'X-Thingtime-Character': 'character' }) })).status, 403);
  const incoming = request();
  const response = await withInternalRequestActor(incoming, async () => ({ id: 'owner', accountKind: 'user' } as any), () => action({ request: incoming }));
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});
test('expired or revoked browser sessions never reach device storage', async () => {
  session = null;
  assert.equal((await action({ request: request() })).status, 401);
  assert.equal(calls.length, 0);
});
