import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
const owner = { id: 'owner', username: 'owner', accountKind: 'user' };
let actor: any = owner, writes = 0;
mock.module('../auth/scopedUser', { namedExports: { getScopedUser: async () => owner } });
mock.module('../auth/getCurrentUser', { namedExports: { getCurrentUser: async () => actor } });
mock.module('../rateLimit/enforce', { namedExports: { enforceRateLimit: async () => ({ allowed: true }), rateLimitedResponseInit: () => ({ status: 429 }) } });
mock.module('./access', { namedExports: { assertLopuAccess: async () => ({ ok: true }), resolveLopuBilling: () => 'free', lopuAccessResponse: () => new Response('', { status: 403 }), LOPU_GUEST_CODE: 'guest', LOPU_GUEST_ERROR: 'guest' } });
mock.module('./chat', { namedExports: { hasLopuChatProviderConfigured: () => false, lopuChatProviderMode: () => 'auto' } });
mock.module('../messenger/lopuChats', { namedExports: {
  listLopuChats: async () => ({ ok: true, chats: [] }),
  createLopuChat: async () => { writes++; return { ok: true }; },
  updateLopuChat: async () => { writes++; return { ok: true }; }
} });
const { action: create } = await import('../../../routes/api/v1/lopu/chats/_chats');
const { action: update } = await import('../../../routes/api/v1/lopu/chats/update/_update');
const request = () => new Request('https://thingtime.test/api/v1/lopu/chats/update', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://thingtime.test' }, body: JSON.stringify({ chatId: 'chat', accessMode: 'full' }) });
test('only the same full first-party user session can write chat access', async () => {
  for (const route of [create, update]) {
    for (actor of [null, { ...owner, id: 'foreign' }, { ...owner, accountKind: 'service' }, { ...owner, temporary: true }]) {
      const before = writes;
      assert.equal((await route({ request: request() })).status, 403);
      assert.equal(writes, before);
    }
    actor = owner;
    const before = writes;
    assert.equal((await route({ request: request() })).status, 200);
    assert.equal(writes, before + 1);
  }
});
