import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AI_MODEL_CHECK_MAX_OUTPUT_TOKENS,
	AI_MODEL_CHECK_PROMPT,
	describeAiModelCheckFailure,
	lowestAiModelCheckEffort,
	parseAiModelCheckInput,
	summarizeAiModelCheckReply,
	type AiModelCheckOutcome
} from './modelCheckCore';
import { callCatalogModelCheck, createAiModelCheckService, type AiModelCheckDependencies, type AiModelCheckServiceResult } from './modelCheck';
// @ts-ignore Node executes this TypeScript route through the repo's tsx test loader.
import { createAiModelCheckHandlers } from '../../../routes/api/v1/ai/models/check/_check.tsx';

// ——— core ————————————————————————————————————————————————————————————————

test('the check body is exactly one model or providerId', () => {
	assert.deepEqual(parseAiModelCheckInput({ model: 'claude-opus-5' }), { model: 'claude-opus-5' });
	assert.deepEqual(parseAiModelCheckInput({ providerId: ' vault-1 ' }), { providerId: 'vault-1' });
	assert.deepEqual(parseAiModelCheckInput({ model: null, providerId: 'chatgpt-plan-abc' }), { providerId: 'chatgpt-plan-abc' });
	for (const bad of [null, [], 'x', {}, { model: 'a', providerId: 'b' }, { model: 'default' }, { model: '' }, { model: 'has space' }, { model: 'x'.repeat(161) }, { providerId: 42 }, { model: 'a', prompt: 'say hi' }, { model: 'a', effort: 'max' }])
		assert.throws(() => parseAiModelCheckInput(bad), TypeError, JSON.stringify(bad));
});

test('the check runs at the cheapest effort and echoes one short line', () => {
	assert.equal(lowestAiModelCheckEffort(['low', 'medium', 'high']), 'low');
	assert.equal(lowestAiModelCheckEffort([]), null);
	assert.equal(lowestAiModelCheckEffort(undefined), null);
	assert.equal(summarizeAiModelCheckReply('  Y\n\n'), 'Y');
	assert.equal(summarizeAiModelCheckReply(null), '');
	assert.equal(summarizeAiModelCheckReply('Yes '.repeat(40)).length, 40);
});

test('failure reasons are fixed-form and never echo a provider body', () => {
	const secret = Object.assign(new Error('sk-secret-123 leaked body'), { status: 401 });
	assert.match(describeAiModelCheckFailure('GPT-5', secret), /rejected the server key for GPT-5 \(HTTP 401\)/);
	assert.doesNotMatch(describeAiModelCheckFailure('GPT-5', secret), /secret/);
	assert.match(describeAiModelCheckFailure('GPT-5', { status: 404 }), /not available/);
	assert.match(describeAiModelCheckFailure('GPT-5', { code: 'model_not_available' }), /not available/);
	assert.match(describeAiModelCheckFailure('GPT-5', { status: 429 }), /HTTP 429/);
	assert.match(describeAiModelCheckFailure('GPT-5', { status: 503 }), /HTTP 503/);
	assert.match(describeAiModelCheckFailure('GPT-5', null, { timedOut: true }), /within 60 s/);
	assert.equal(describeAiModelCheckFailure('GPT-5', new Error('raw provider text')), 'GPT-5 did not answer the check.');
});

// ——— the service ——————————————————————————————————————————————————————————

const model = (id: string, overrides: Record<string, unknown> = {}) => ({
	id,
	label: id.toUpperCase(),
	provider: 'anthropic' as const,
	efforts: ['low', 'medium', 'high'],
	speeds: ['normal', 'fast'],
	family: 'claude',
	enabled: true,
	available: true,
	verified: null,
	isDefault: false,
	...overrides
});

const catalog = (models: any[]) => async () => ({ ok: true as const, models, defaults: { model: models[0]?.id ?? null, effort: 'high', speed: 'normal' }, providers: {} } as any);

const harness = (overrides: Partial<AiModelCheckDependencies> = {}) => {
	const calls = { access: [] as any[], debit: [] as any[], catalog: [] as any[], vault: [] as any[], plan: [] as any[], released: 0, refreshed: [] as any[] };
	let clock = 1_000;
	const deps: AiModelCheckDependencies = {
		listModels: catalog([model('claude-opus-5'), model('gpt-5', { provider: 'openai', family: 'openai', efforts: ['minimal', 'low', 'high'] })]),
		assertAccess: async (_user, input) => {
			calls.access.push(input);
			return { ok: true, billing: input.billing, settings: {} as any, verified: true, account: null, release: async () => { calls.released += 1; } } as any;
		},
		debit: async (_userId, input) => {
			calls.debit.push(input);
			return { ok: true, usageId: 'u', costMicros: 7, debitedMicros: 7, balanceMicros: 100, priced: true, estimated: false };
		},
		providerMode: () => 'auto',
		providerConfigured: () => true,
		refreshUnavailable: async (provider, error) => {
			calls.refreshed.push([provider, error]);
			return null;
		},
		callCatalog: async (choice) => {
			calls.catalog.push(choice);
			clock += 250;
			return { text: 'Y', model: choice.model, usage: { inputTokens: 20, outputTokens: 1 } };
		},
		vaultConfigured: () => true,
		resolveVault: async (_owner, id) => ({ id, name: 'My Groq', provider: 'groq', endpoint: 'https://api.groq.com/openai/v1', model: 'llama', token: 'tok' } as any),
		callVault: async (provider) => {
			calls.vault.push(provider.id);
			return { text: 'Yes', model: provider.model, usage: { inputTokens: 9, outputTokens: 1 } };
		},
		resolvePlan: async (_request, ownerId, providerId) => ({ provider: { id: providerId, name: 'ChatGPT plan', provider: 'openai', endpoint: 'x', model: 'gpt-5', token: 't', authMode: 'chatgpt-plan' } as any, admission: Object.freeze({ ownerId, providerId }) }),
		callPlan: async (provider) => {
			calls.plan.push(provider.id);
			return { text: 'Y', model: provider.model, usage: null };
		},
		now: () => clock,
		randomId: () => 'fixed',
		log: () => {},
		...overrides
	};
	return { check: createAiModelCheckService(deps), calls };
};

const request = new Request('https://thingtime.test/api/v1/ai/models/check', { method: 'POST' });

const liveOutcome = (result: AiModelCheckServiceResult) => {
	assert.ok(result.kind === 'outcome' && result.outcome.live === true, JSON.stringify(result));
	return (result as Extract<AiModelCheckServiceResult, { kind: 'outcome' }>).outcome as Extract<AiModelCheckOutcome, { live: true }>;
};
const deadOutcome = (result: AiModelCheckServiceResult) => {
	assert.ok(result.kind === 'outcome' && result.outcome.live === false, JSON.stringify(result));
	return (result as Extract<AiModelCheckServiceResult, { kind: 'outcome' }>).outcome as Extract<AiModelCheckOutcome, { live: false }>;
};
const viewer = { id: 'user-1' };

test('a catalog model is checked once on its own provider at its cheapest effort and accounted', async () => {
	const { check, calls } = harness();
	const outcome = liveOutcome(await check(request, viewer, { model: 'gpt-5' }));
	assert.equal(outcome.reply, 'Y');
	assert.equal(outcome.provider, 'openai');
	assert.equal(outcome.billing, 'thingtime');
	assert.equal(outcome.costMicros, 7);
	assert.equal(outcome.latencyMs, 250);
	assert.equal(calls.catalog.length, 1);
	assert.equal(calls.catalog[0].model, 'gpt-5');
	assert.equal(calls.catalog[0].effort, 'minimal');
	assert.equal(calls.catalog[0].speed, 'normal');
	assert.deepEqual(calls.access, [{ billing: 'thingtime', reserve: true, ownedPlan: null }]);
	assert.equal(calls.released, 1);
	assert.equal(calls.debit.length, 1);
	assert.equal(calls.debit[0].surface, 'model-check');
	assert.equal(calls.debit[0].requestId, 'model-check-fixed');
	assert.deepEqual(calls.debit[0].usage, { inputTokens: 20, outputTokens: 1 });
});

test('a failing model is a red result with a safe reason, no debit and no fallback', async () => {
	const { check, calls } = harness({
		callCatalog: async () => {
			throw Object.assign(new Error('provider body with sk-leak'), { status: 401 });
		}
	});
	const outcome = deadOutcome(await check(request, viewer, { model: 'claude-opus-5' }));
	assert.match(outcome.error, /HTTP 401/);
	assert.doesNotMatch(outcome.error, /leak/);
	assert.equal(calls.debit.length, 0);
	assert.equal(calls.released, 1);
	assert.equal(calls.refreshed.length, 1);
	assert.equal(calls.refreshed[0][0], 'anthropic');
	assert.equal(calls.vault.length + calls.plan.length, 0);
});

test('a check that outlives its deadline reports a timeout', async () => {
	const { check } = harness({
		timeoutMs: 20,
		callCatalog: (_choice, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }))
	});
	assert.match(deadOutcome(await check(request, viewer, { model: 'claude-opus-5' })).error, /within 60 s/);
});

test('the caller cancelling propagates instead of reading as a dead model', async () => {
	const abort = new AbortController();
	const { check, calls } = harness({
		callCatalog: (_choice, signal) =>
			new Promise((_resolve, reject) => {
				signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
				abort.abort();
			})
	});
	await assert.rejects(check(request, viewer, { model: 'claude-opus-5' }, abort.signal), /aborted/);
	assert.equal(calls.released, 1);
});

test('unavailable and unknown catalog models never reach a provider', async () => {
	const { check, calls } = harness({ listModels: catalog([model('claude-opus-5', { available: false, verified: false })]) });
	assert.match(deadOutcome(await check(request, viewer, { model: 'claude-opus-5' })).error, /key invalid/);
	const unknown = await check(request, viewer, { model: 'nope' });
	assert.deepEqual(unknown.kind === 'invalid' && unknown.status, 404);
	assert.equal(calls.catalog.length, 0);
	assert.equal(calls.access.length, 0);
});

test('the access gate refuses before any provider call', async () => {
	const refusal = { ok: false, status: 402, code: 'LOPU_NO_CREDITS', error: 'No credits', balanceMicros: 0 } as const;
	const { check, calls } = harness({ assertAccess: async () => refusal as any });
	const result = await check(request, viewer, { model: 'claude-opus-5' });
	assert.deepEqual(result, { kind: 'refused', refusal });
	assert.equal(calls.catalog.length, 0);
	assert.equal(calls.debit.length, 0);
});

test('test mode answers deterministically without a key and prices the test row', async () => {
	const { check, calls } = harness({ providerMode: () => 'test' });
	const result = await check(request, viewer, { model: 'claude-opus-5' });
	assert.ok(result.kind === 'outcome' && result.outcome.live && result.outcome.provider === 'test');
	assert.equal(calls.catalog.length, 0);
	assert.equal(calls.debit[0].pricingModel, 'test-model');
});

test('a vault connection is checked on the caller\'s own provider and billed byo', async () => {
	const { check, calls } = harness();
	const result = await check(request, viewer, { providerId: 'vault-1' });
	assert.ok(result.kind === 'outcome' && result.outcome.live && result.outcome.billing === 'byo' && result.outcome.reply === 'Yes');
	assert.deepEqual(calls.vault, ['vault-1']);
	assert.equal(calls.catalog.length, 0);
	assert.deepEqual(calls.access, [{ billing: 'byo', reserve: true, ownedPlan: null }]);
	assert.equal(calls.debit[0].providerLabel, 'My Groq');
});

test('a foreign vault id is a 404 and a provider failure reads like the chat\'s error', async () => {
	const foreign = harness({ resolveVault: async () => { throw new Error('not yours'); } });
	const missing = await foreign.check(request, viewer, { providerId: 'someone-else' });
	assert.ok(missing.kind === 'invalid' && missing.status === 404);
	assert.equal(foreign.calls.access.length, 0);

	const failing = harness({ callVault: async () => { throw Object.assign(new Error('x'), { status: 429 }); } });
	assert.match(deadOutcome(await failing.check(request, viewer, { providerId: 'vault-1' })).error, /My Groq is rate-limiting/);
});

test('an owned ChatGPT plan connection is admitted with its plan grant', async () => {
	const { check, calls } = harness();
	const result = await check(request, viewer, { providerId: 'chatgpt-plan-abc' });
	assert.ok(result.kind === 'outcome' && result.outcome.live);
	assert.deepEqual(calls.plan, ['chatgpt-plan-abc']);
	assert.deepEqual(calls.access[0].ownedPlan, { ownerId: 'user-1', providerId: 'chatgpt-plan-abc' });

	const lost = harness({ resolvePlan: async () => { throw new Error('runtime unavailable'); } });
	assert.match(deadOutcome(await lost.check(request, viewer, { providerId: 'chatgpt-plan-abc' })).error, /Reconnect/);
	assert.equal(lost.calls.access.length, 0);
});

// ——— the production catalog call ——————————————————————————————————————————

test('Claude checks send only the tiny prompt, no tools, on the cheapest effort', async () => {
	let seen: any = null;
	const anthropic = () => ({ messages: { create: async (body: any) => { seen = body; return { model: body.model, content: [{ type: 'text', text: 'Y' }], usage: { input_tokens: 18, output_tokens: 1 } }; } } }) as any;
	const result = await callCatalogModelCheck({ id: 'claude-opus-5:low', model: 'claude-opus-5', label: 'Claude Opus 5', provider: 'anthropic', effort: 'low', speed: 'normal' }, new AbortController().signal, { anthropic });
	assert.equal(result.text, 'Y');
	assert.deepEqual(seen.messages, [{ role: 'user', content: AI_MODEL_CHECK_PROMPT }]);
	assert.equal(seen.max_tokens, AI_MODEL_CHECK_MAX_OUTPUT_TOKENS);
	assert.equal(seen.tools, undefined);
	assert.deepEqual(seen.output_config, { effort: 'low' });
	assert.deepEqual(result.usage, { inputTokens: 18, outputTokens: 1 });
});

test('OpenAI checks use chat completions with max_completion_tokens, never max_tokens', async () => {
	let seen: any = null;
	const openai = () => ({ chat: { completions: { create: async (body: any) => { seen = body; return { model: body.model, choices: [{ message: { content: 'Y' } }], usage: { prompt_tokens: 20, completion_tokens: 1 } }; } } } }) as any;
	const result = await callCatalogModelCheck({ id: 'gpt-4o-mini', model: 'gpt-4o-mini', label: 'GPT-4o mini', provider: 'openai', effort: null, speed: 'normal' }, new AbortController().signal, { openai });
	assert.equal(result.text, 'Y');
	assert.equal(seen.max_tokens, undefined);
	assert.equal(seen.max_completion_tokens, AI_MODEL_CHECK_MAX_OUTPUT_TOKENS);
	assert.equal(seen.tools, undefined);
	assert.equal(seen.reasoning_effort, undefined);
	assert.equal(seen.messages.at(-1).content, AI_MODEL_CHECK_PROMPT);
});

// ——— the route —————————————————————————————————————————————————————————————

const allowed = { allowed: true, limit: 200, remaining: 199, resetAt: new Date(Date.now() + 60_000).toISOString() };
const post = (body: unknown, headers: Record<string, string> = {}) =>
	new Request('https://thingtime.test/api/v1/ai/models/check', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: 'https://thingtime.test', 'Sec-Fetch-Site': 'same-origin', ...headers },
		body: JSON.stringify(body)
	});

const routeHarness = (overrides: Record<string, unknown> = {}) => {
	const seen: any[] = [];
	const handlers = createAiModelCheckHandlers({
		getUser: async () => ({ id: 'user-1', temporary: false, accountKind: 'user' }) as any,
		limit: async () => allowed as any,
		check: async (_request: Request, _user: unknown, target: unknown) => {
			seen.push(target);
			return { kind: 'outcome', outcome: { ok: true, live: true, target, model: 'm', provider: 'claude', billing: 'thingtime', reply: 'Y', latencyMs: 1, costMicros: 0, checkedAt: 'now' } } as any;
		},
		log: () => {},
		...overrides
	});
	return { handlers, seen };
};

test('the route checks one target and answers private, no-store JSON', async () => {
	const { handlers, seen } = routeHarness();
	const response = await handlers.action({ request: post({ model: 'claude-opus-5' }) });
	assert.equal(response.status, 200);
	assert.match(response.headers.get('Cache-Control') || '', /no-store/);
	const body = await response.json();
	assert.equal(body.live, true);
	assert.deepEqual(seen, [{ model: 'claude-opus-5' }]);
});

test('the route refuses cross-origin, non-JSON, anonymous, bad bodies and rate-limited callers before checking', async () => {
	const { handlers, seen } = routeHarness();
	assert.equal((await handlers.action({ request: post({ model: 'a' }, { Origin: 'https://evil.test', 'Sec-Fetch-Site': 'cross-site' }) })).status, 403);
	assert.equal((await handlers.action({ request: post({ model: 'a' }, { 'Content-Type': 'text/plain' }) })).status, 415);
	assert.equal((await handlers.action({ request: post({ model: 'a', providerId: 'b' }) })).status, 400);
	assert.equal((await handlers.action({ request: new Request('https://thingtime.test/api/v1/ai/models/check', { method: 'GET' }) })).status, 405);
	assert.equal((await handlers.loader()).status, 405);
	const anonymous = routeHarness({ getUser: async () => null });
	assert.equal((await anonymous.handlers.action({ request: post({ model: 'a' }) })).status, 401);
	const guest = routeHarness({ getUser: async () => ({ id: 'g', temporary: true, accountKind: 'user' }) });
	assert.equal((await guest.handlers.action({ request: post({ model: 'a' }) })).status, 401);
	const limited = routeHarness({ limit: async () => ({ allowed: false, limit: 200, remaining: 0, resetAt: new Date(Date.now() + 30_000).toISOString() }) });
	const response = await limited.handlers.action({ request: post({ model: 'a' }) });
	assert.equal(response.status, 429);
	assert.ok(Number(response.headers.get('Retry-After')) > 0);
	assert.deepEqual(seen, []);
	assert.equal(limited.seen.length + anonymous.seen.length + guest.seen.length, 0);
});

test('the route maps access refusals and invalid targets to their statuses', async () => {
	const refused = routeHarness({ check: async () => ({ kind: 'refused', refusal: { ok: false, status: 429, code: 'LOPU_TURN_IN_FLIGHT', error: 'busy' } }) });
	const busy = await refused.handlers.action({ request: post({ model: 'a' }) });
	assert.equal(busy.status, 429);
	assert.equal(busy.headers.get('Retry-After'), '5');
	assert.equal((await busy.json()).code, 'LOPU_TURN_IN_FLIGHT');
	const invalid = routeHarness({ check: async () => ({ kind: 'invalid', status: 404, error: 'Unknown model' }) });
	assert.equal((await invalid.handlers.action({ request: post({ model: 'a' }) })).status, 404);
	const broken = routeHarness({ check: async () => { throw new Error('boom'); } });
	const failed = await broken.handlers.action({ request: post({ model: 'a' }) });
	assert.equal(failed.status, 502);
	assert.doesNotMatch(JSON.stringify(await failed.json()), /boom/);
});
