import assert from 'node:assert/strict';
import test from 'node:test';

import { createLopuVoiceRealtimeSession, normalizeLopuVoiceEffort, normalizeLopuVoiceSpeed, resolveLopuVoiceRealtimeModel } from './voice';
import { defaultVaultProviderModel, realtimeVaultProviderModels, safeVaultModelId, type LopuProviderEffort, type LopuProviderKind, type LopuProviderSpeed } from './userVaultCore';
import {
	buildPlainCompletionRequest,
	callVaultProviderPlainCompletion,
	extractPlainCompletionText,
	mintVaultProviderRealtimeSession,
	type LopuVaultProviderRecord
} from './vaultProviderClient';
import { LOPU_VAULT_NO_MODEL_REASON, LOPU_VAULT_REALTIME_MODEL_REASON, LOPU_VAULT_REALTIME_UNSUPPORTED_REASON } from './vaultProviders';

// Pure coverage of the voice turn's provider call and the direct-voice
// session (design note §6.1): the request each kind receives, the model rule,
// and that a realtime session never carries the stored key. No network, no
// Mongo — the fetch and the SSRF fence are injected.

const TOKEN = 'write-only-test-token';

const provider = (kind: LopuProviderKind, model: string | null = null): LopuVaultProviderRecord => ({
	id: `provider-${kind}`,
	name: `${kind} test connection`,
	provider: kind,
	endpoint: kind === 'anthropic' ? 'https://api.anthropic.com' : kind === 'google' ? 'https://generativelanguage.googleapis.com/v1beta' : `https://api.${kind}.example/v1`,
	model,
	token: TOKEN
});

const passEndpoint = async (endpoint: string) => ({ endpoint, rewritten: false });

type Captured = { url: string; init: RequestInit | undefined };

const fakeFetch = (responseBody: unknown, status = 200) => {
	const captured: Captured = { url: '', init: undefined };
	const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
		captured.url = String(url);
		captured.init = init;
		return new Response(JSON.stringify(responseBody), { status, headers: { 'Content-Type': 'application/json' } });
	};
	return { captured, fetchImpl };
};

const callAndCapture = async (
	kind: LopuProviderKind,
	selection: { model: string | null; effort: LopuProviderEffort | null; speed: LopuProviderSpeed },
	responseBody: unknown = { choices: [{ message: { content: 'Hello from Lopu' } }] },
	rowModel: string | null = null
) => {
	const { captured, fetchImpl } = fakeFetch(responseBody);
	const text = await callVaultProviderPlainCompletion(provider(kind, rowModel), {
		system: 'Be brief.',
		history: [],
		prompt: 'Hello',
		model: selection.model,
		effort: selection.effort,
		speed: selection.speed,
		fetchImpl,
		assertEndpoint: passEndpoint
	});
	return {
		text,
		url: captured.url,
		headers: captured.init?.headers as Record<string, string>,
		body: JSON.parse(String(captured.init?.body)) as Record<string, any>,
		redirect: captured.init?.redirect
	};
};

test('Anthropic completions apply effort and fast mode to the provider request', async () => {
	// the connection's own model (claude-opus-5) runs the turn
	const request = await callAndCapture('anthropic', { model: null, effort: 'high', speed: 'fast' }, { content: [{ type: 'text', text: 'Hello from Claude' }] }, 'claude-opus-5');
	assert.equal(request.text, 'Hello from Claude');
	assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
	assert.equal(request.headers['x-api-key'], TOKEN);
	assert.equal(request.headers['anthropic-beta'], 'fast-mode-2026-02-01');
	assert.equal(request.body.model, 'claude-opus-5');
	assert.equal(request.body.output_config.effort, 'high');
	assert.equal(request.body.speed, 'fast');
	assert.equal(request.body.system, 'Be brief.');
	// every provider call refuses redirects (the fence after the DNS check)
	assert.equal(request.redirect, 'error');
});

test('Google completions apply the selected thinking level', async () => {
	const request = await callAndCapture(
		'google',
		{ model: 'gemini-3.6-flash', effort: 'minimal', speed: 'normal' },
		{ candidates: [{ content: { parts: [{ text: 'Hello ' }, { text: 'from Gemini' }] } }] }
	);
	assert.equal(request.text, 'Hello from Gemini');
	assert.match(request.url, /models\/gemini-3\.6-flash:generateContent$/);
	assert.equal(request.headers['x-goog-api-key'], TOKEN);
	assert.equal(request.body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
	assert.equal(request.body.contents[0].role, 'user');
});

test('OpenAI-compatible providers receive their native reasoning and speed controls', async (t) => {
	const cases: Array<{ kind: LopuProviderKind; effort: LopuProviderEffort; speed?: LopuProviderSpeed; assertBody: (body: Record<string, any>) => void }> = [
		{
			kind: 'openai',
			effort: 'high',
			speed: 'fast',
			assertBody: (body) => {
				assert.equal(body.reasoning_effort, 'high');
				assert.equal(body.service_tier, 'priority');
				assert.equal(body.max_completion_tokens, 4096);
				assert.equal(body.max_tokens, undefined);
			}
		},
		{ kind: 'openrouter', effort: 'xhigh', assertBody: (body) => assert.equal(body.reasoning.effort, 'xhigh') },
		{ kind: 'mistral', effort: 'high', assertBody: (body) => assert.equal(body.reasoning_effort, 'high') },
		{
			kind: 'deepseek',
			effort: 'none',
			assertBody: (body) => {
				assert.equal(body.reasoning_effort, 'none');
				assert.equal(body.thinking.type, 'disabled');
			}
		},
		{ kind: 'groq', effort: 'medium', assertBody: (body) => assert.equal(body.reasoning_effort, 'medium') },
		{ kind: 'cohere', effort: 'high', assertBody: (body) => assert.equal(body.reasoning_effort, 'high') },
		{
			kind: 'xai',
			effort: 'high',
			assertBody: (body) => {
				assert.equal(body.reasoning_effort, 'high');
				assert.equal(body.max_tokens, 4096);
			}
		}
	];
	for (const item of cases) {
		await t.test(item.kind, async () => {
			const request = await callAndCapture(item.kind, { model: `${item.kind}-model`, effort: item.effort, speed: item.speed || 'normal' });
			assert.equal(request.text, 'Hello from Lopu');
			assert.match(request.url, /\/chat\/completions$/);
			assert.equal(request.headers.Authorization, `Bearer ${TOKEN}`);
			assert.equal(request.body.messages[0].role, 'system');
			item.assertBody(request.body);
		});
	}
});

test('Mistral thinking responses return only their text chunks', async () => {
	const request = await callAndCapture(
		'mistral',
		{ model: 'mistral-medium-3-5', effort: 'high', speed: 'normal' },
		{ choices: [{ message: { content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'private reasoning' }] }, { type: 'text', text: 'Visible answer' }] } }] }
	);
	assert.equal(request.text, 'Visible answer');
	assert.equal(extractPlainCompletionText('openai', { choices: [{ message: { content: 42 } }] }), null);
	assert.equal(extractPlainCompletionText('anthropic', { content: [{ type: 'thinking' }] }), null);
});

test('the model rule: the connection’s own model, else the kind’s first catalog model, else the requested one', async () => {
	// a row saved with a model runs on it whatever the request asks
	const own = await callAndCapture('openai', { model: 'gpt-5.4-mini', effort: null, speed: 'normal' }, undefined, 'gpt-5.5');
	assert.equal(own.body.model, 'gpt-5.5');
	// a template kind without one runs on its first catalog model
	const fallback = await callAndCapture('xai', { model: null, effort: null, speed: 'normal' });
	assert.equal(fallback.body.model, defaultVaultProviderModel('xai'));
	assert.equal(fallback.body.model, 'grok-4.3');
	// a custom host has no catalog: it borrows the requested model …
	const custom = await callAndCapture('compatible', { model: 'my-local-model', effort: null, speed: 'normal' });
	assert.equal(custom.body.model, 'my-local-model');
	// … and with neither the turn stops before dialing
	const { fetchImpl } = fakeFetch({});
	await assert.rejects(
		callVaultProviderPlainCompletion(provider('compatible'), { system: 's', history: [], prompt: 'p', fetchImpl, assertEndpoint: passEndpoint }),
		(error: Error) => error.message === LOPU_VAULT_NO_MODEL_REASON
	);
	// no effort/speed asked → no vendor tuning fields leak into the body
	assert.equal('reasoning_effort' in fallback.body, false);
	assert.equal('service_tier' in own.body, false);
});

test('a rejected or empty provider answer is a user-facing error, never the raw body', async () => {
	const { fetchImpl } = fakeFetch({ error: { message: `bad key ${TOKEN}` } }, 401);
	await assert.rejects(
		callVaultProviderPlainCompletion(provider('openai', 'gpt-5.5'), { system: 's', history: [], prompt: 'p', fetchImpl, assertEndpoint: passEndpoint }),
		(error: Error) => /rejected the request \(401\)/.test(error.message) && !error.message.includes(TOKEN)
	);
	const empty = fakeFetch({ choices: [{ message: { content: '   ' } }] });
	await assert.rejects(
		callVaultProviderPlainCompletion(provider('openai', 'gpt-5.5'), { system: 's', history: [], prompt: 'p', fetchImpl: empty.fetchImpl, assertEndpoint: passEndpoint }),
		/returned no text/
	);
});

test('buildPlainCompletionRequest keeps effort "none" out of Anthropic and Gemini bodies', () => {
	const base = { system: 's', messages: [], model: 'm', maxTokens: 10, effort: 'none' as const, speed: 'normal' as const };
	assert.equal('output_config' in buildPlainCompletionRequest(provider('anthropic'), 'https://api.anthropic.com', base).body, false);
	assert.equal('thinkingConfig' in (buildPlainCompletionRequest(provider('google'), 'https://g.example', base).body.generationConfig as any), false);
});

test('voice tuning normalises: known efforts only, speed is fast or normal, model ids are bounded', () => {
	assert.equal(normalizeLopuVoiceEffort('xhigh'), 'xhigh');
	assert.equal(normalizeLopuVoiceEffort('turbo'), null);
	assert.equal(normalizeLopuVoiceEffort(''), null);
	assert.equal(normalizeLopuVoiceSpeed('fast'), 'fast');
	assert.equal(normalizeLopuVoiceSpeed('warp'), 'normal');
	assert.equal(safeVaultModelId(' openai/gpt-oss-120b '), 'openai/gpt-oss-120b');
	assert.equal(safeVaultModelId('bad model id'), null);
	assert.equal(safeVaultModelId('x'.repeat(201)), null);
	assert.equal(safeVaultModelId(''), null);
});

// ── direct voice ────────────────────────────────────────────────────────────

test('only a kind with realtime models can run direct voice; the model must be one of them', () => {
	assert.deepEqual(
		realtimeVaultProviderModels('xai').map((model) => model.id),
		['grok-voice-latest', 'grok-voice-think-fast-2.0']
	);
	assert.equal(realtimeVaultProviderModels('openai').length, 0);
	assert.throws(() => resolveLopuVoiceRealtimeModel(provider('openai'), null), (error: Error) => error.message === LOPU_VAULT_REALTIME_UNSUPPORTED_REASON);
	assert.throws(() => resolveLopuVoiceRealtimeModel(provider('compatible'), 'grok-voice-latest'), (error: Error) => error.message === LOPU_VAULT_REALTIME_UNSUPPORTED_REASON);
	// default = the kind's first realtime model, the row's own only when that is realtime
	assert.equal(resolveLopuVoiceRealtimeModel(provider('xai'), null).id, 'grok-voice-latest');
	assert.equal(resolveLopuVoiceRealtimeModel(provider('xai', 'grok-4.3'), null).id, 'grok-voice-latest');
	assert.equal(resolveLopuVoiceRealtimeModel(provider('xai', 'grok-voice-think-fast-2.0'), null).id, 'grok-voice-think-fast-2.0');
	assert.equal(resolveLopuVoiceRealtimeModel(provider('xai'), 'grok-voice-think-fast-2.0').id, 'grok-voice-think-fast-2.0');
	// a text model, even a real xAI one, is refused for realtime
	assert.throws(() => resolveLopuVoiceRealtimeModel(provider('xai'), 'grok-4.3'), (error: Error) => error.message === LOPU_VAULT_REALTIME_MODEL_REASON);
});

test('mintVaultProviderRealtimeSession exchanges the stored key for the provider’s short-lived credential', async () => {
	const { captured, fetchImpl } = fakeFetch({ value: 'ephemeral-secret-123', expires_at: 1_800_000_000 });
	const session = await mintVaultProviderRealtimeSession(provider('xai', 'grok-4.3'), { model: 'grok-voice-latest', fetchImpl, assertEndpoint: passEndpoint });
	assert.equal(captured.url, 'https://api.xai.example/v1/realtime/client_secrets');
	assert.equal((captured.init?.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
	assert.deepEqual(JSON.parse(String(captured.init?.body)), { expires_after: { seconds: 300 } });
	assert.equal(captured.init?.redirect, 'error');
	assert.deepEqual(session, {
		provider: 'xai',
		model: 'grok-voice-latest',
		token: 'ephemeral-secret-123',
		expiresAt: 1_800_000_000,
		webSocketUrl: 'wss://api.xai.example/v1/realtime?model=grok-voice-latest'
	});
	assert.equal(JSON.stringify(session).includes(TOKEN), false);
	// a dev-rewritten http origin gets a ws: URL
	const local = fakeFetch({ value: 'local-secret' });
	const rewritten = await mintVaultProviderRealtimeSession(provider('xai'), {
		model: 'grok-voice-latest',
		fetchImpl: local.fetchImpl,
		assertEndpoint: async () => ({ endpoint: 'http://127.0.0.1:18170/v1', rewritten: true })
	});
	assert.equal(rewritten.webSocketUrl, 'ws://127.0.0.1:18170/v1/realtime?model=grok-voice-latest');
	assert.equal(rewritten.expiresAt, null);
});

test('mintVaultProviderRealtimeSession refuses a credential that is (or contains) the stored key, a bad answer, or a text-only kind', async () => {
	for (const value of [TOKEN, `prefix-${TOKEN}`, '', 42, 'x'.repeat(9_000)]) {
		const { fetchImpl } = fakeFetch({ value });
		await assert.rejects(mintVaultProviderRealtimeSession(provider('xai'), { model: 'grok-voice-latest', fetchImpl, assertEndpoint: passEndpoint }), /invalid session credential/);
	}
	const rejected = fakeFetch({ error: 'nope' }, 403);
	await assert.rejects(mintVaultProviderRealtimeSession(provider('xai'), { model: 'grok-voice-latest', fetchImpl: rejected.fetchImpl, assertEndpoint: passEndpoint }), /rejected the session request \(403\)/);
	const untouched = fakeFetch({ value: 'never-called' });
	await assert.rejects(
		mintVaultProviderRealtimeSession(provider('openai'), { model: 'gpt-realtime', fetchImpl: untouched.fetchImpl, assertEndpoint: passEndpoint }),
		(error: Error) => error.message === LOPU_VAULT_REALTIME_UNSUPPORTED_REASON
	);
	assert.equal(untouched.captured.url, '');
	// the fence runs before any request leaves
	const fenced = fakeFetch({ value: 'never-called' });
	await assert.rejects(
		mintVaultProviderRealtimeSession(provider('xai'), {
			model: 'grok-voice-latest',
			fetchImpl: fenced.fetchImpl,
			assertEndpoint: async () => {
				throw new Error('blocked host');
			}
		}),
		/blocked host/
	);
	assert.equal(fenced.captured.url, '');
});

test('createLopuVoiceRealtimeSession resolves the caller’s own connection, validates the tuning, and returns no key', async () => {
	const calls: Array<{ ownerId: string; providerId: unknown }> = [];
	const deps = {
		getProvider: async (ownerId: string, providerId: unknown) => {
			calls.push({ ownerId, providerId });
			return provider('xai');
		},
		mint: async (row: LopuVaultProviderRecord, input: { model: string }) => ({
			provider: row.provider,
			model: input.model,
			token: 'ephemeral-secret',
			expiresAt: null,
			webSocketUrl: `wss://api.xai.example/v1/realtime?model=${input.model}`
		})
	};
	const session = await createLopuVoiceRealtimeSession('user-1', { providerId: 'prov-1', effort: 'high', textResponse: true }, deps);
	assert.deepEqual(calls, [{ ownerId: 'user-1', providerId: 'prov-1' }]);
	assert.deepEqual(session, {
		provider: 'xai',
		model: 'grok-voice-latest',
		token: 'ephemeral-secret',
		expiresAt: null,
		webSocketUrl: 'wss://api.xai.example/v1/realtime?model=grok-voice-latest',
		effort: 'high',
		textResponse: true
	});
	assert.equal(JSON.stringify(session).includes(TOKEN), false);
	const defaults = await createLopuVoiceRealtimeSession('user-1', { providerId: 'prov-1', model: 'grok-voice-think-fast-2.0' }, deps);
	assert.equal(defaults.model, 'grok-voice-think-fast-2.0');
	assert.equal(defaults.effort, 'none');
	assert.equal(defaults.textResponse, false);
	// an effort the voice model does not list is refused before minting
	let minted = 0;
	const countingMint = async () => {
		minted += 1;
		return { provider: 'xai' as const, model: 'm', token: 't', expiresAt: null, webSocketUrl: 'wss://x' };
	};
	await assert.rejects(createLopuVoiceRealtimeSession('user-1', { providerId: 'prov-1', effort: 'xhigh' }, { ...deps, mint: countingMint }), /reasoning level is not available for the selected voice model/);
	assert.equal(minted, 0);
	// a connection that is not the caller's fails before minting, as the vault reports it
	await assert.rejects(
		createLopuVoiceRealtimeSession(
			'user-2',
			{ providerId: 'prov-1' },
			{
				...deps,
				getProvider: async () => {
					throw new Error('Selected AI provider was not found.');
				}
			}
		),
		/Selected AI provider was not found/
	);
});
