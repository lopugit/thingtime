import assert from 'node:assert/strict';
import test from 'node:test';

import { callLopuProvider, type DecryptedLopuProvider } from './voice';
import type { LopuProviderEffort, LopuProviderKind, LopuProviderSpeed } from './userVaultCore';

const provider = (kind: LopuProviderKind): DecryptedLopuProvider => ({
	id: `provider-${kind}`,
	name: `${kind} test connection`,
	provider: kind,
	endpoint:
		kind === 'anthropic'
			? 'https://api.anthropic.com'
			: kind === 'google'
			? 'https://generativelanguage.googleapis.com/v1beta'
			: `https://api.${kind}.example/v1`,
	token: 'write-only-test-token'
});

const callAndCapture = async (
	kind: LopuProviderKind,
	selection: { model: string; effort: LopuProviderEffort | null; speed: LopuProviderSpeed },
	responseBody: unknown = { choices: [{ message: { content: 'Hello from Lopu' } }] }
) => {
	let requestUrl = '';
	let requestInit: RequestInit | undefined;
	const text = await callLopuProvider(provider(kind), [], 'Hello', selection, {
		validateEndpoint: async () => {},
		fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
			requestUrl = String(url);
			requestInit = init;
			return new Response(JSON.stringify(responseBody), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}) as typeof fetch
	});
	return {
		text,
		url: requestUrl,
		headers: requestInit?.headers as Record<string, string>,
		body: JSON.parse(String(requestInit?.body)) as Record<string, any>
	};
};

test('Anthropic chat applies effort and fast mode to the provider request', async () => {
	const request = await callAndCapture(
		'anthropic',
		{ model: 'claude-opus-5', effort: 'high', speed: 'fast' },
		{ content: [{ type: 'text', text: 'Hello from Claude' }] }
	);
	assert.equal(request.text, 'Hello from Claude');
	assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
	assert.equal(request.headers['anthropic-beta'], 'fast-mode-2026-02-01');
	assert.equal(request.body.output_config.effort, 'high');
	assert.equal(request.body.speed, 'fast');
});

test('Google chat applies the selected thinking level', async () => {
	const request = await callAndCapture(
		'google',
		{ model: 'gemini-3.6-flash', effort: 'minimal', speed: 'normal' },
		{ candidates: [{ content: { parts: [{ text: 'Hello ' }, { text: 'from Gemini' }] } }] }
	);
	assert.equal(request.text, 'Hello from Gemini');
	assert.match(request.url, /models\/gemini-3\.6-flash:generateContent$/);
	assert.equal(request.body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
});

test('OpenAI-compatible providers receive their native reasoning and speed controls', async (t) => {
	const cases: Array<{
		kind: LopuProviderKind;
		effort: LopuProviderEffort;
		speed?: LopuProviderSpeed;
		assertBody: (body: Record<string, any>) => void;
	}> = [
		{
			kind: 'openai',
			effort: 'high',
			speed: 'fast',
			assertBody: (body) => {
				assert.equal(body.reasoning_effort, 'high');
				assert.equal(body.service_tier, 'priority');
			}
		},
		{
			kind: 'openrouter',
			effort: 'xhigh',
			assertBody: (body) => assert.equal(body.reasoning.effort, 'xhigh')
		},
		{
			kind: 'mistral',
			effort: 'high',
			assertBody: (body) => assert.equal(body.reasoning_effort, 'high')
		},
		{
			kind: 'deepseek',
			effort: 'none',
			assertBody: (body) => {
				assert.equal(body.reasoning_effort, 'none');
				assert.equal(body.thinking.type, 'disabled');
			}
		},
		{
			kind: 'groq',
			effort: 'medium',
			assertBody: (body) => assert.equal(body.reasoning_effort, 'medium')
		},
		{
			kind: 'cohere',
			effort: 'high',
			assertBody: (body) => assert.equal(body.reasoning_effort, 'high')
		}
	];

	for (const item of cases) {
		await t.test(item.kind, async () => {
			const request = await callAndCapture(item.kind, {
				model: `${item.kind}-model`,
				effort: item.effort,
				speed: item.speed || 'normal'
			});
			assert.equal(request.text, 'Hello from Lopu');
			item.assertBody(request.body);
		});
	}
});

test('Mistral thinking responses return only their text chunks', async () => {
	const request = await callAndCapture(
		'mistral',
		{ model: 'mistral-medium-3-5', effort: 'high', speed: 'normal' },
		{
			choices: [
				{
					message: {
						content: [
							{ type: 'thinking', thinking: [{ type: 'text', text: 'private reasoning' }] },
							{ type: 'text', text: 'Visible answer' }
						]
					}
				}
			]
		}
	);
	assert.equal(request.text, 'Visible answer');
});
