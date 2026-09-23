import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

let browserUser = null;
let context = null;
mock.module('./getCurrentUser.ts', { namedExports: { getCurrentUser: async () => browserUser } });
mock.module('../apps/appTokens.ts', { namedExports: { resolveAppToken: async () => context } });
const { getScopedUser, getScopedActor } = await import('./scopedUser.ts');
const user = { id: 'synthetic-owner', username: 'test' };
const request = (origin) => new Request('https://thingtime.test/api/v1/actions/run', {
  headers: { Authorization: 'Bearer synthetic-test-token', ...(origin ? { Origin: origin } : {}) }
});

test('ordinary sessions keep their existing authority', async () => {
  browserUser = user; context = null;
  assert.equal(await getScopedUser(request(), 'actions.run'), user);
  browserUser = null;
});

test('scoped operations reject missing, expired, picker-only and sandbox app authority', async () => {
  browserUser = null;
  for (const value of [null, { user, scopes: ['things'] }, { user, scopes: ['app-data'] },
    { user, scopes: ['actions.run'], sandbox: true }]) {
    context = value;
    assert.equal(await getScopedUser(request(), 'actions.run'), null);
  }
});

test('each operation requires its own approved scope and enforces the bound origin', async () => {
  for (const scope of ['actions.run', 'lopu.chat', 'lopu.voice', 'lopu.recordings']) {
    context = { user, scopes: [scope], origin: 'https://client.test' };
    assert.equal(await getScopedUser(request(), scope), user);
    assert.equal(await getScopedUser(request('https://client.test'), scope), user);
    assert.equal(await getScopedUser(request('https://another.test'), scope), null);
    for (const other of ['actions.run', 'lopu.chat', 'lopu.voice', 'lopu.recordings'].filter(item => item !== scope)) {
      assert.equal(await getScopedUser(request(), other), null);
    }
  }
});

test('Action preparation can distinguish full account sessions from scoped app grants', async () => {
  browserUser = user; context = null;
  assert.deepEqual(await getScopedActor(request(), 'actions.run'), { user, kind: 'account' });
  browserUser = null;
  context = { user, scopes: ['actions.run'], origin: 'https://client.test' };
  assert.deepEqual(await getScopedActor(request('https://client.test'), 'actions.run'), { user, kind: 'app' });
  assert.equal(await getScopedActor(request('https://another.test'), 'actions.run'), null);
});

let runContext;
mock.module('../actions/execute.ts', { namedExports: { runAction: async (_viewer, _request, _shared, authority) => {
  runContext = authority;
  return { ok: true, status: 'ok' };
} } });
mock.module('../rateLimit/enforce.ts', { namedExports: {
  enforceRateLimit: async () => ({ allowed: true }), rateLimitedResponseInit: () => ({ status: 429 })
} });
mock.module('../things/things.ts', { namedExports: {
  isFail: (value) => value?.ok === false, viewerOf: (value) => value,
  withFriendIds: async (value) => value, withLinkKeys: (value) => value
} });
mock.module('../actions/sharedComposition.ts', { namedExports: { resolveSharedComposition: async () => undefined } });
const { action: runRoute } = await import('../../../routes/api/v1/actions/run/_run.tsx');

test('run route derives browser authority from credentials, never request fields or actor header', async () => {
  const invoke = () => runRoute({ request: new Request('https://thingtime.test/api/v1/actions/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Thingtime-Expected-Actor': user.id },
    body: JSON.stringify({ action: 'test-action', execution: 'browser', firstPartyActorId: user.id, kind: 'account', context: { firstPartyActorId: user.id } })
  }) });
  browserUser = user; context = null;
  assert.equal((await invoke()).status, 200);
  assert.equal(runContext.firstPartyActorId, user.id);
  browserUser = null; context = { user, scopes: ['actions.run'], origin: 'https://client.test' };
  assert.equal((await invoke()).status, 200);
  assert.equal(runContext.firstPartyActorId, undefined, 'App grant may run server Actions but cannot prepare a browser Action');
  context = null;
  assert.equal((await invoke()).status, 401);
});
