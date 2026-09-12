import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

let browserUser = null;
let context = null;
mock.module('./getCurrentUser.ts', { namedExports: { getCurrentUser: async () => browserUser } });
mock.module('../apps/appTokens.ts', { namedExports: { resolveAppToken: async () => context } });
const { getScopedUser } = await import('./scopedUser.ts');
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
