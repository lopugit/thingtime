import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
let user: any, allowed: boolean, unavailable: boolean, denied: boolean, calls: any[];
mock.module(new URL('../auth/getCurrentUser.ts', import.meta.url).href, { namedExports: { getCurrentUser: async () => user } });
mock.module(new URL('../rateLimit/subscription.ts', import.meta.url).href, { namedExports: { enforceSubscriptionRateLimit: async () => ({ allowed, unavailable }) } });
mock.module(new URL('../messenger/lopuChats.ts', import.meta.url).href, { namedExports: {
	getLopuChat: async (owner: string, id: string) => { calls.push({ owner, id }); return denied ? { ok: false, status: 404, error: 'Chat unavailable' } : { ok: true, chat: { id } }; },
	createLopuChat: async (owner: string, input: any, identity: any) => { calls.push({ owner, input, identity }); return { ok: true, chat: { id: 'new-chat' } }; },
	persistLopuUserTurn: async (owner: string, input: any) => { calls.push({ owner, input }); return { ok: true, messages: [{ id: 'user-row' }] }; },
	persistLopuAssistantTurn: async (owner: string, input: any) => { calls.push({ owner, input }); return { ok: true, messages: [{ id: 'assistant-row' }] }; }
} });
const { parseVoiceCapture, saveVoiceCapture } = await import('./voiceCapture');
const { action } = await import('../../../routes/api/v1/lopu/voice/capture/_capture');
const body = { ownerId: 'owner', sessionId: 'session', eventId: 'event', chatId: 'chat', role: 'user', text: 'A completed transcript' };
const request = (input: any = body, origin = 'https://thingtime.test', contentType = 'application/json') => new Request('https://thingtime.test/api/v1/lopu/voice/capture', { method: 'POST', headers: { Origin: origin, 'Content-Type': contentType }, body: JSON.stringify(input) });
beforeEach(() => { user = { id: 'owner', accountKind: 'user' }; allowed = true; unavailable = false; denied = false; calls = []; });
test('strict parser bounds identities, roles and transcript length and strips executable/credential metadata', () => {
	assert.deepEqual(parseVoiceCapture({ ...body, token: 'ignored', toolCalls: [{ name: 'delete' }] }), { sessionId: 'session', eventId: 'event', chatId: 'chat', role: 'user', text: body.text });
	for (const patch of [{ role: 'system' }, { text: '' }, { text: 'x'.repeat(12001) }, { eventId: '../event' }, { chatId: {} }]) assert.throws(() => parseVoiceCapture({ ...body, ...patch }));
});
test('saving pins membership and stable ids, while assistant text is explicitly device-reported', async () => {
	const input = parseVoiceCapture({ ...body, role: 'assistant' });
	await saveVoiceCapture('owner', input); await saveVoiceCapture('owner', input);
	assert.equal(calls[1].input.requestId, calls[3].input.requestId);
	assert.equal(calls[1].input.requireExactReplay, true); assert.match(calls[1].input.lopu.providerLabel, /device-reported/); assert.equal(calls[1].input.lopu.toolCalls, undefined);
	calls = []; denied = true; assert.equal((await saveVoiceCapture('owner', input)).ok, false); assert.equal(calls.length, 1);
});
test('new chats use one stable owner/session creation key', async () => {
	await saveVoiceCapture('owner', parseVoiceCapture({ ...body, chatId: null }));
	assert.equal(calls[0].identity.creationKey, 'voice-capture:session'); assert.equal(calls[0].owner, 'owner');
});
test('delimiter-containing identities remain distinct', async () => {
	await saveVoiceCapture('owner', parseVoiceCapture({ ...body, sessionId: 'a:user', eventId: 'b' }));
	await saveVoiceCapture('owner', parseVoiceCapture({ ...body, sessionId: 'a', eventId: 'user:b' }));
	assert.notEqual(calls[1].input.requestId, calls[3].input.requestId);
});
test('route fences wrong accounts, guests, services, origins and content types before writes', async () => {
	for (const account of [null, { id: 'owner', temporary: true }, { id: 'owner', accountKind: 'service' }]) { user = account; assert.equal((await action({ request: request() })).status, 401); }
	user = { id: 'owner', accountKind: 'user' };
	assert.equal((await action({ request: request({ ...body, ownerId: 'other' }) })).status, 409);
	assert.equal((await action({ request: request(body, 'https://other.test') })).status, 403);
	assert.equal((await action({ request: request(body, undefined, 'text/plain') })).status, 415); assert.equal(calls.length, 0);
});
test('subscription limits fail closed and successful responses identify the account and canonical chat', async () => {
	allowed = false; assert.equal((await action({ request: request() })).status, 429);
	unavailable = true; assert.equal((await action({ request: request() })).status, 503); assert.equal(calls.length, 0);
	allowed = true; const response = await action({ request: request() }); assert.equal(response.status, 200);
	assert.equal((await response.json()).ownerId, 'owner'); assert.match(response.headers.get('Cache-Control') || '', /no-store/);
});
