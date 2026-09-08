import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAiCompletionInput, AI_COMPLETION_REQUIREMENTS } from './completionCore';
import { AiTransportFailure, AiWaterfallFailure, runAiProviderWaterfall } from './providerWaterfall';
import { createAiCompletionService } from './completion';
import { createAiCompletionHandlers } from '../../../routes/api/v1/ai/complete/_complete';
import { capabilitySatisfies } from '../capabilities/capabilityContract';
import { thingtimeCapabilityManifest } from '../capabilities/thingtimeCapabilities';

const input = { connectionIds: ['first', 'second'], system: 'Summarize.', prompt: 'Synthetic transcript.' };
test('bounded text contract rejects inline secrets, URLs, duplicate IDs and audio', () => {
	assert.deepEqual(parseAiCompletionInput(input), input);
	for (const patch of [{ token: 'secret' }, { endpoint: 'https://example.test' }, { ownerId: 'other' }, { audio: 'data' },
		{ connectionIds: [] }, { connectionIds: ['x', 'x'] }, { connectionIds: ['../x'] }, { connectionIds: ['a', 'b', 'c', 'd', 'e'] },
		{ prompt: '' }, { prompt: 'x'.repeat(40_001) }, { system: 'x'.repeat(8_001) }])
		assert.throws(() => parseAiCompletionInput({ ...input, ...patch }), TypeError);
});

test('waterfall uses explicit order and returns only redacted failure status', async () => {
	const visited: string[] = [];
	const result = await runAiProviderWaterfall({ connectionIds: input.connectionIds, beforeAttempt: async (id) => { visited.push(id); },
		attempt: async (id) => { if (id === 'first') throw new AiTransportFailure(429); return 'ok'; } });
	assert.deepEqual(visited, ['first', 'second']);
	assert.deepEqual(result, { value: 'ok', connectionId: 'second', attempts: [{ connectionId: 'first', outcome: 'unavailable', status: 429 }, { connectionId: 'second', outcome: 'succeeded' }] });
});

test('malformed replies, permissions revocation and cancellation do not fall through', async () => {
	for (const failure of [new Error('malformed'), new AiTransportFailure(400)]) {
		let count = 0;
		await assert.rejects(runAiProviderWaterfall({ connectionIds: input.connectionIds, beforeAttempt: async () => {}, attempt: async () => { count++; throw failure; } }), (error) => error === failure);
		assert.equal(count, 1);
	}
	let called = false;
	await assert.rejects(runAiProviderWaterfall({ connectionIds: input.connectionIds, beforeAttempt: async () => { throw new AiTransportFailure(403); }, attempt: async () => { called = true; } }));
	assert.equal(called, false);
	const controller = new AbortController();
	await assert.rejects(runAiProviderWaterfall({ connectionIds: input.connectionIds, signal: controller.signal, beforeAttempt: async () => {}, attempt: async () => { controller.abort(); throw new AiTransportFailure(503); } }));
});

test('all unavailable connections produce a bounded safe trace', async () => {
	await assert.rejects(runAiProviderWaterfall({ connectionIds: input.connectionIds, beforeAttempt: async () => {}, attempt: async () => { throw new AiTransportFailure(503); } }),
		(error: unknown) => error instanceof AiWaterfallFailure && error.attempts.length === 2);
});

test('service validates the whole owned selection before sending and resolves each key only when needed', async () => {
	const resolved: string[] = [];
	const sent: string[] = [];
	const service = createAiCompletionService({
		list: async (owner: string) => { assert.equal(owner, 'owner'); return [{ id: 'first', provider: 'compatible' }, { id: 'second', provider: 'anthropic' }]; },
		resolve: async (owner: string, id: string) => { assert.equal(owner, 'owner'); resolved.push(id); return { id, token: `synthetic-${id}` }; },
		call: async (provider: any, body: any) => { sent.push(provider.token); assert.equal(body.prompt, input.prompt); if (provider.id === 'first') throw new AiTransportFailure(429); return 'summary'; }
	} as any);
	await assert.rejects(service('owner', { ...input, connectionIds: ['first', 'foreign'] }), TypeError);
	assert.deepEqual(sent, []);
	const result = await service('owner', input);
	assert.equal(result.text, 'summary');
	assert.deepEqual(resolved, ['first', 'second']);
	assert.deepEqual(sent, ['synthetic-first', 'synthetic-second']);
	assert.doesNotMatch(JSON.stringify(result), /synthetic/);
});

test('a Claude session token cannot be used as an HTTP endpoint credential', async () => {
	let sent = false;
	const service = createAiCompletionService({ list: async () => [{ id: 'first', provider: 'compatible' }], resolve: async () => ({ token: 'sk-ant-oat-synthetic' }), call: async () => { sent = true; } } as any);
	await assert.rejects(service('owner', { ...input, connectionIds: ['first'] }), TypeError);
	assert.equal(sent, false);
});

const makeRequest = (body: unknown = input, extraHeaders: Record<string, string> = {}) => new Request('https://thingtime.test/api/v1/ai/complete', {
	method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://thingtime.test', ...extraHeaders }, body: JSON.stringify(body)
});
test('completion route requires a full account, same origin, bounded JSON and fail-closed rate limit', async () => {
	let user: any = { id: 'owner', accountKind: 'user' };
	let allowed = true;
	let count = 0;
	const handlers = createAiCompletionHandlers({ getUser: async () => user,
		limit: async (_request: Request, bucket: string, id: string, options: any) => { assert.equal(bucket, 'ai.complete'); assert.equal(id, 'ai-complete:owner'); assert.equal(options.failClosed, true); return { allowed, limit: 20, remaining: 0, resetAt: new Date().toISOString() }; },
		complete: async (id: string, body: unknown) => { assert.equal(id, 'owner'); assert.deepEqual(body, input); count++; return { text: 'ok', connectionId: 'first', attempts: [] }; }
	} as any);
	assert.equal((await handlers.action({ request: makeRequest(input, { Origin: 'https://evil.test' }) })).status, 403);
	assert.equal((await handlers.action({ request: makeRequest(input, { 'Content-Type': 'text/plain' }) })).status, 415);
	for (const invalid of [null, { id: 'owner', temporary: true, accountKind: 'user' }, { id: 'owner', accountKind: 'service' }]) {
		user = invalid; assert.equal((await handlers.action({ request: makeRequest() })).status, 401);
	}
	user = { id: 'owner', accountKind: 'user' };
	assert.equal((await handlers.action({ request: makeRequest({ ...input, token: 'forbidden' }) })).status, 400);
	allowed = false; assert.equal((await handlers.action({ request: makeRequest() })).status, 429);
	assert.equal(count, 0);
	allowed = true;
	const response = await handlers.action({ request: makeRequest() });
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
	assert.equal(count, 1);
});

test('central completion advertises and requires its independent compatible feature version', () => {
	const manifest = thingtimeCapabilityManifest('https://thingtime.test');
	assert.equal(manifest.features['api.ai-complete'].version, AI_COMPLETION_REQUIREMENTS['api.ai-complete']);
	assert.ok(manifest.operations.some((op) => op.path === '/api/v1/ai/complete' && op.methods.includes('POST')));
	assert.equal(capabilitySatisfies('1.1.0', '1.0.0'), true);
	assert.equal(capabilitySatisfies('2.0.0', '1.0.0'), false);
	assert.equal(capabilitySatisfies('', '1.0.0'), false);
});
