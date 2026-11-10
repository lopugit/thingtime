import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeviceTurnAction } from './_device-turns';

const origin = 'https://account.test', providerId = 'chatgpt-plan-device-00000000-0000-4000-8000-000000000001';
const common = { providerId, chatId: 'chat-one', requestId: 'request-one', text: 'Hello' };
const request = (action: string, body: object = {}, headers: Record<string, string> = {}) => ({ request: new Request(`${origin}/api/v1/lopu/chats/device-turns`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Thingtime-Expected-Actor': 'owner-one', 'X-Thingtime-Expected-Data-Plane': 'home', ...headers },
  body: JSON.stringify({ ...common, ...body, action })
}) });

function fixture() {
  const calls: [string, any[]][] = [];
  const chat = { id: 'chat-one', createdBy: 'owner-one', lopu: { providerId } };
  const settings = { providerId, archived: false };
  let prior: any = null;
  const bound = (name: string, fn: (...args: any[]) => unknown) => async (...args: any[]) => { calls.push([name, args]); return fn(...args); };
  const action = createDeviceTurnAction({
    getCurrentUser: bound('user', () => ({ id: 'owner-one', accountKind: 'user' })),
    enforceRateLimit: bound('rate', () => ({ allowed: true })),
    getLopuChat: bound('chat', () => ({ ok: true, chat, settings })),
    createLopuChat: bound('create', () => { throw Error('unexpected create'); }),
    readLopuDeviceTurn: bound('receipt', () => ({ ok: true, receipt: prior })),
    loadLopuHistory: bound('history', () => ({ ok: true, history: [] })),
    persistLopuUserTurn: bound('save-user', () => ({ ok: true, message: { id: 'message-one' } })),
    persistLopuAssistantTurn: bound('save-assistant', () => ({ ok: true, messages: [{ id: 'message-two' }] }))
  } as unknown as Parameters<typeof createDeviceTurnAction>[0]);
  return { action, calls, settings, chat, setReceipt: (next: unknown) => { prior = next; } };
}

test('local text transcript requires the owning first-party browser and active matching conversation', async () => {
  const f = fixture();
  for (const headers of [{ Origin: 'https://other.test' }, { Authorization: 'Bearer scoped' }, { 'X-Thingtime-Character': 'other' }])
    assert.equal((await f.action(request('history', {}, headers))).status, 403);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.action(request('history', {}, { 'X-Thingtime-Expected-Data-Plane': 'custom-fixture' }))).status, 409);
  assert.equal((await f.action(request('history', {}, { 'X-Thingtime-Expected-Actor': 'other' }))).status, 409);
  f.settings.archived = true;
  assert.equal((await f.action(request('history'))).status, 403);
  assert.equal((await f.action(request('save', { answer: 'Hi' }))).status, 403);
  f.settings.archived = false;
  f.chat.createdBy = 'other';
  assert.equal((await f.action(request('history'))).status, 403);
  assert.equal(f.calls.some(([name]) => ['receipt', 'history', 'save-user', 'save-assistant'].includes(name)), false);
});

test('exact saved device turn replays and new saves carry no untrusted model, tool or billing receipt', async () => {
  const f = fixture(), receipt = { chatId: 'chat-one', userMessageId: 'message-one', messages: [{ id: 'message-two' }], answer: 'Hi' };
  f.setReceipt(receipt);
  assert.deepEqual(await (await f.action(request('history'))).json(), { ok: true, receipt });
  assert.deepEqual(f.calls.find(([name]) => name === 'receipt')?.[1], ['owner-one', 'chat-one', providerId, 'request-one', 'Hello']);
  assert.equal(f.calls.some(([name]) => name === 'history'), false);
  const result = await f.action(request('save', { answer: 'Hi', model: 'forged', toolCalls: ['forged'], billing: 'forged' }));
  assert.equal(result.status, 200);
  const save = f.calls.find(([name]) => name === 'save-assistant')?.[1];
  assert.equal(save?.[0], 'owner-one');
  assert.deepEqual(save?.[1], { chatId: 'chat-one', requestId: 'request-one', text: 'Hi', requireExactReplay: true,
    expectedProviderId: providerId, lopu: { deviceTranscript: true } });
});
