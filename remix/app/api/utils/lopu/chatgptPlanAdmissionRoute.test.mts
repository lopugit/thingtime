import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { ownsPlanAdmission } from '../ai/chatgptPlanAdmissionCore';
const owner = { id: 'plan-owner', username: 'synthetic', accountKind: 'user', temporary: false };
let session: any = owner, runtimeAvailable = true, connected = true, savedProvider: string | null = null;
let refuseUpdate = false;
let writes = 0, resolutions = 0, streams = 0, persistenceProof = false;
const id = 'chatgpt-plan-test';
const ok = async () => ({ ok: true });
mock.module('../auth/authCookie', { namedExports: { getAuthToken: async () => 'synthetic-session' } });
mock.module('../auth/getCurrentUser', { namedExports: { getCurrentUser: async () => session, resolveTokenUser: async () => session ? { user: session } : null } });
mock.module('../auth/scopedUser', { namedExports: { getScopedUser: async () => owner } });
mock.module('../ai/chatgptPlanRuntime', { namedExports: {
  ChatGPTPlanRuntimeError: class extends Error {},
  getChatGPTPlanRuntime: () => runtimeAvailable ? { resolveProvider: async (scope: any, providerId: string) => {
    resolutions++; assert.equal(scope.ownerId, owner.id); assert.equal(scope.origin, 'http://127.0.0.1:28631');
    if (!connected || providerId !== id) throw new Error('unavailable');
    return { id, name: 'Synthetic plan', provider: 'openai', endpoint: 'https://api.openai.com/v1', model: 'model-one', token: 'synthetic-token', authMode: 'chatgpt-plan', authSignal: new AbortController().signal };
  } } : null
} });
mock.module('../settings/lopuAccess', { namedExports: { getStoredLopuAccessSettings: async () => ({ requireVerification: true, allowByoUnverified: false, starterCredits: 0 }) } });
mock.module('./accounting', { namedExports: {
  ensureLopuAccount: async () => { throw new Error('plan must not need credits'); }, reserveLopuTurn: async () => { throw new Error('plan must not reserve credits'); },
  debitLopuUsage: async () => ({ ok: true, costMicros: 0, priced: false, balanceMicros: 0 })
} });
mock.module('../rateLimit/enforce', { namedExports: { enforceRateLimit: async () => ({ allowed: true }), rateLimitedResponseInit: () => ({ status: 429 }) } });
mock.module('../ai/models', { namedExports: { listAiModels: async () => ({ models: [], defaults: {} }), resolveLopuModelChoice: () => ({ ok: true, choice: null }) } });
mock.module('./chatMedia.server', { namedExports: { resolveLopuMedia: async () => ({ text: '', media: [] }) } });
mock.module('./chatAttachments', { namedExports: { lopuReferenceIds: () => [], resolveLopuThingReferences: async () => [], lopuReferenceContext: () => '' } });
mock.module('./chat', { namedExports: {
  hasLopuChatProviderConfigured: () => false, lopuChatProviderMode: () => 'auto',
  streamLopuChatTurn: async function* (input: any) { streams++; assert.equal(input.vaultProvider.authMode, 'chatgpt-plan'); yield { type: 'delta', text: 'Synthetic response' }; return { text: 'Synthetic response', stopReason: 'end_turn', provider: 'vault', toolCalls: [], usage: null }; }
} });
mock.module('../messenger/lopuChats', { namedExports: {
  listLopuChats: async () => ({ ok: true, chats: [] }), readLopuContinuation: ok, createLopuNoteReader: () => async () => [], deleteLopuChat: ok,
  createLopuChat: async (ownerId: string, input: any, _identity: any, proof: any) => { writes++; persistenceProof = ownsPlanAdmission(proof, ownerId, input.providerId); return { ok: true, chat: { id: 'chat-test' } }; },
  updateLopuChat: async (ownerId: string, _chatId: any, input: any, proof: any) => { if (refuseUpdate) return { ok: false, status: 409, error: 'Provider changed' }; writes++; persistenceProof = ownsPlanAdmission(proof, ownerId, input.providerId); return { ok: true }; },
  getLopuChat: async () => ({ ok: true, settings: { providerId: savedProvider } }), loadLopuHistory: async () => ({ ok: true, history: [] }),
  persistLopuUserTurn: async () => { writes++; return { ok: true, message: { id: 'user-message' } }; },
  persistLopuAssistantTurn: async () => ({ ok: true, messages: [{ id: 'assistant-message' }] })
} });
const { action: create } = await import('../../../routes/api/v1/lopu/chats/_chats');
const { action: update } = await import('../../../routes/api/v1/lopu/chats/update/_update');
const { action: reply, replyAsUser } = await import('../../../routes/api/v1/lopu/chats/reply/_reply');
const request = (body: any = {}, headers = {}) => new Request('http://127.0.0.1:28631/api/v1/lopu/chats/reply', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ text: 'Hello', requestId: 'synthetic-request', providerId: id, ...body }) });
beforeEach(() => { session = owner; refuseUpdate = false; runtimeAvailable = connected = true; savedProvider = null; writes = resolutions = streams = 0; persistenceProof = false; });

test('fresh unverified owner creates and persists a plan chat, streams a reply and changes an existing pin without admin/credits', async () => {
  for (const action of [create, update, reply]) {
    const response = await action({ request: request({ chatId: action === update ? 'existing' : undefined }) });
    assert.equal(response.status, 200); const output = await response.text();
    assert.equal(output.includes('synthetic-token'), false);
    assert.equal(persistenceProof, true);
  }
  assert.equal(streams, 1);
});

test('full session ownership, availability and Character header are checked before persistence or inference', async () => {
  for (const action of [create, update, reply]) {
    for (session of [null, { ...owner, id: 'other' }, { ...owner, temporary: true }, { ...owner, accountKind: 'service' }]) {
      assert.equal((await action({ request: request() })).status, 409);
      assert.equal(resolutions, 0); assert.equal(writes, 0);
    }
    session = owner;
    for (const value of ['', owner.id]) assert.equal((await action({ request: request({}, { 'X-Thingtime-Character': value }) })).status, 409);
    runtimeAvailable = false;
    assert.equal((await action({ request: request() })).status, 409); runtimeAvailable = true;
    connected = false;
    assert.equal((await action({ request: request() })).status, 409); connected = true;
    assert.equal(writes, 0); assert.equal(streams, 0); resolutions = 0;
  }
});

test('caller eligibility claims and ordinary BYO do not unlock text; unavailable saved plan never falls back', async () => {
  for (const providerId of [null, 'ordinary-vault']) {
    const response = await create({ request: request({ providerId, ownedPlan: { ownerId: owner.id, providerId: id }, planChatEligible: true }) });
    assert.equal(response.status, 403);
  }
  savedProvider = id; connected = false;
  assert.equal((await reply({ request: request({ chatId: 'existing', providerId: undefined }) })).status, 409);
  assert.equal(writes, 0); assert.equal(streams, 0);
});

test('durable continuation uses its private live full-session resolver, never a request-body substitute', async () => {
  session = null;
  const response = await replyAsUser(request(), owner as any, { resolveActionActor: async () => owner as any });
  assert.equal(response.status, 200); await response.text(); assert.equal(streams, 1);
  const denied = await replyAsUser(request(), owner as any, { resolveActionActor: async () => null });
  assert.equal(denied.status, 409);
});


test('a rejected plan pin update stops the turn before user writes or provider calls', async () => {
  refuseUpdate = true;
  const response = await reply({ request: request({ chatId: 'existing' }) });
  assert.equal(response.status, 409); assert.equal(writes, 0); assert.equal(streams, 0);
});
