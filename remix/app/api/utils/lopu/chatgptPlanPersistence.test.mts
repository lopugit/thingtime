import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createOwnedPlanResolver } from '../ai/chatgptPlanAdmissionCore';
const id = 'chatgpt-plan-test';
const chat: any = { shareId: 'lopu-chat-test', ownerId: 'owner', thingtime: ['chat'], crystal: { externalSource: { access: 'lopu', provider: 'lopu' }, lopu: { providerId: null } } };
let writes = 0;
mock.module('../lopu/userVault', { namedExports: { hasUserVaultProvider: async (_owner: string, provider: string) => provider === 'ordinary-owned' } });
mock.module('../mongodb/collections', { namedExports: { getThingsCollection: async () => ({ countDocuments: async () => 0 }), getHomeThingsCollection: async () => ({}), withHomeMongoTransaction: async () => {} } });
mock.module('../messenger/messenger', { namedExports: {
  resolveChatAccess: async (viewer: string) => viewer === 'owner' ? { chat, member: { crystal: { role: 'owner', state: 'active' } } } : { ok: false, status: 403, error: 'Forbidden' },
  chatListEntryFor: async () => ({ ok: true, chat: { id: chat.shareId } }), chatPreviewOf: () => ({}), insertChatMember: async () => {}, listChatsById: async () => [], projectMessages: async () => ({ messages: [] })
} });
mock.module('../messenger/storage', { namedExports: {
  updateMessengerThing: async (_collection: any, _filter: any, update: any) => { writes++; chat.crystal.lopu.providerId = update.$set['crystal.lopu.providerId']; },
  insertMessengerThing: async (_collection: any, row: any) => { writes++; assert.equal(row.crystal.lopu.providerId, id); },
  deleteMessengerThing: async () => {}, deleteMessengerThings: async () => {}, withMessengerStorageTransaction: async (run: any) => run({})
} });
const { createLopuChat, updateLopuChat } = await import('../messenger/lopuChats');
test('real persistence rejects forged, wrong-owner/provider and revoked proofs, then stores an issued plan pin', async () => {
  const controller = new AbortController();
  const resolve = createOwnedPlanResolver({ sessionOwns: async () => true, resolve: async () => ({ id, authMode: 'chatgpt-plan' as const, authSignal: controller.signal }) });
  const proof = (await resolve(new Request('http://127.0.0.1:28631'), 'owner', id)).admission;
  const foreign = (await resolve(new Request('http://127.0.0.1:28631'), 'other', id)).admission;
  for (const action of [
    (value: any, providerId = id) => createLopuChat('owner', { providerId }, undefined, value),
    (value: any, providerId = id) => updateLopuChat('owner', chat.shareId, { providerId }, value)
  ]) {
    chat.crystal.lopu.providerId = null;
    const before = writes;
    for (const value of [undefined, { ownerId: 'owner', providerId: id }, JSON.parse(JSON.stringify(proof)), foreign]) assert.equal((await action(value)).ok, false);
    assert.equal((await action(proof, 'chatgpt-plan-other')).ok, false);
    assert.equal(writes, before);
    assert.equal((await action(proof)).ok, true);
    assert.equal(writes, before + 1);
  }
  controller.abort(); chat.crystal.lopu.providerId = null;
  assert.equal((await createLopuChat('owner', { providerId: id }, undefined, proof)).ok, false);
  assert.equal((await updateLopuChat('owner', chat.shareId, { providerId: id }, proof)).ok, false);
  assert.equal((await updateLopuChat('owner', chat.shareId, { providerId: 'ordinary-owned' })).ok, true, 'ordinary vault ownership remains supported');
});
