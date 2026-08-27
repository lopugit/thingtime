import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, beforeEach, mock, test } from 'node:test';

type ProviderPlan = { text?: string };
type CapturedRequest = {
	body: Record<string, any>;
	headers: IncomingHttpHeaders;
	surface?: 'beta' | 'stable';
};

const anthropicPlans: ProviderPlan[] = [];
const anthropicRequests: CapturedRequest[] = [];
const openAiPlans: ProviderPlan[] = [];
const openAiRequests: CapturedRequest[] = [];
let waterfall: string[] = [];
let waterfallReads = 0;

const sendAnthropicStream = (response: ServerResponse, plan: ProviderPlan) => {
	const messageStart = {
		type: 'message_start',
		message: {
			id: 'msg_test',
			type: 'message',
			role: 'assistant',
			content: [],
			model: 'claude-test',
			stop_reason: null,
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 0 }
		}
	};
	const events = [messageStart];
	if (plan.text) {
		events.push(
			{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: null } },
			{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: plan.text } },
			{ type: 'content_block_stop', index: 0 }
		);
	}
	events.push(
		{
			type: 'message_delta',
			delta: { stop_reason: 'end_turn', stop_sequence: null },
			usage: { output_tokens: plan.text ? 1 : 0 }
		},
		{ type: 'message_stop' }
	);

	response.writeHead(200, { 'content-type': 'text/event-stream' });
	for (const event of events) {
		response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
	}
	response.end();
};

const sendOpenAiStream = (response: ServerResponse, plan: ProviderPlan, model: string) => {
	const chunk = (delta: Record<string, string>, finishReason: string | null) => ({
		id: 'chatcmpl_test',
		object: 'chat.completion.chunk',
		created: 1,
		model,
		choices: [{ index: 0, delta, finish_reason: finishReason }]
	});

	response.writeHead(200, { 'content-type': 'text/event-stream' });
	if (plan.text) response.write(`data: ${JSON.stringify(chunk({ content: plan.text }, null))}\n\n`);
	response.write(`data: ${JSON.stringify(chunk({}, 'stop'))}\n\n`);
	response.write('data: [DONE]\n\n');
	response.end();
};

const server = createServer(async (request, response) => {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(Buffer.from(chunk));
	const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
	const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;

	if (pathname.endsWith('/messages')) {
		anthropicRequests.push({
			body,
			headers: request.headers,
			surface: String(request.headers['anthropic-beta'] || '').includes('fast-mode') ? 'beta' : 'stable'
		});
		const plan = anthropicPlans.shift();
		if (!plan) {
			response.writeHead(500).end('unexpected Anthropic request');
			return;
		}
		sendAnthropicStream(response, plan);
		return;
	}

	if (pathname.endsWith('/chat/completions')) {
		openAiRequests.push({ body, headers: request.headers });
		const plan = openAiPlans.shift();
		if (!plan) {
			response.writeHead(500).end('unexpected OpenAI request');
			return;
		}
		sendOpenAiStream(response, plan, body.model || 'openai-test');
		return;
	}

	response.writeHead(404).end('unexpected test route');
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const envNames = [
	'ANTHROPIC_API_KEY',
	'ANTHROPIC_BASE_URL',
	'OPENAI_API_KEY',
	'OPENAI_BASE_URL',
	'LOPU_PROVIDER',
	'LOPU_CLAUDE_MODEL',
	'LOPU_OPENAI_MODEL'
];
const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
const originalDateNow = Date.now;

mock.module(new URL('../settings/prConflictResolverModelWaterfall.ts', import.meta.url).href, {
	exports: {
		getAiPreferredModelWaterfall: async () => {
			waterfallReads += 1;
			return [...waterfall];
		}
	}
});

const { streamLopuMusing } = await import('./musing.ts');

beforeEach(() => {
	anthropicPlans.length = 0;
	anthropicRequests.length = 0;
	openAiPlans.length = 0;
	openAiRequests.length = 0;
	waterfallReads = 0;
	waterfall = ['claude-opus-5:max:fast', 'gpt-5.6-sol:max:fast', 'default'];
	Date.now = () => 1;
	process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
	process.env.ANTHROPIC_BASE_URL = origin;
	process.env.OPENAI_API_KEY = 'openai-test-key';
	process.env.OPENAI_BASE_URL = `${origin}/v1`;
	delete process.env.LOPU_PROVIDER;
	process.env.LOPU_CLAUDE_MODEL = 'claude-provider-default';
	process.env.LOPU_OPENAI_MODEL = 'openai-provider-default';
});

after(async () => {
	Date.now = originalDateNow;
	for (const [name, value] of Object.entries(originalEnv)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	await new Promise<void>((resolve, reject) =>
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		})
	);
});

const collect = async () => {
	const events = [];
	for await (const event of streamLopuMusing({ city: 'Melbourne' })) events.push(event);
	return events;
};

const sources = (events) => events.filter((event) => event.type === 'meta').map((event) => event.source);
const text = (events) =>
	events
		.filter((event) => event.type === 'delta')
		.map((event) => event.text)
		.join('');

test('a starved decorated Claude stream retries bare on the same model', async () => {
	anthropicPlans.push({}, { text: 'Claude stayed preferred' });

	const events = await collect();

	assert.deepEqual(sources(events), ['claude']);
	assert.equal(text(events), 'Claude stayed preferred');
	assert.equal(anthropicRequests.length, 2);
	assert.equal(anthropicRequests[0].surface, 'beta');
	assert.equal(anthropicRequests[0].body.model, 'claude-opus-5');
	assert.deepEqual(anthropicRequests[0].body.output_config, { effort: 'max' });
	assert.equal(anthropicRequests[0].body.speed, 'fast');
	assert.match(String(anthropicRequests[0].headers['anthropic-beta']), /fast-mode-2026-02-01/);
	assert.equal(anthropicRequests[1].surface, 'stable');
	assert.equal(anthropicRequests[1].body.model, 'claude-opus-5');
	assert.equal(anthropicRequests[1].body.output_config, undefined);
	assert.equal(anthropicRequests[0].body.max_tokens, 4096);
	assert.equal(anthropicRequests[1].body.max_tokens, 4096);
	assert.equal(openAiRequests.length, 0);
	assert.equal(waterfallReads, 1);
});

test('two starved Claude attempts fall through without emitting a blank Claude meta event', async () => {
	anthropicPlans.push({}, {});
	openAiPlans.push({ text: 'OpenAI fallback' });

	const events = await collect();

	assert.deepEqual(sources(events), ['openai']);
	assert.equal(text(events), 'OpenAI fallback');
	assert.equal(anthropicRequests.length + openAiRequests.length, 3);
	assert.equal(waterfallReads, 1);
});

test('a decorated Claude stream that yields text is never retried', async () => {
	anthropicPlans.push({ text: 'One attempt' });

	const events = await collect();

	assert.deepEqual(sources(events), ['claude']);
	assert.equal(text(events), 'One attempt');
	assert.equal(anthropicRequests.length, 1);
	assert.equal(openAiRequests.length, 0);
});

test('a starved decorated OpenAI stream retries without effort or priority', async () => {
	process.env.LOPU_PROVIDER = 'openai';
	openAiPlans.push({}, { text: 'OpenAI stayed preferred' });

	const events = await collect();

	assert.deepEqual(sources(events), ['openai']);
	assert.equal(text(events), 'OpenAI stayed preferred');
	assert.equal(openAiRequests.length, 2);
	assert.equal(openAiRequests[0].body.model, 'gpt-5.6-sol');
	assert.equal(openAiRequests[0].body.reasoning_effort, 'max');
	assert.equal(openAiRequests[0].body.service_tier, 'priority');
	assert.equal(openAiRequests[1].body.model, 'gpt-5.6-sol');
	assert.equal(openAiRequests[1].body.reasoning_effort, undefined);
	assert.equal(openAiRequests[1].body.service_tier, undefined);
	assert.equal(openAiRequests[0].body.max_completion_tokens, 4096);
	assert.equal(openAiRequests[1].body.max_completion_tokens, 4096);
	assert.equal(anthropicRequests.length, 0);
	assert.equal(waterfallReads, 1);
});

test('all starved provider attempts end in the canned fallback, never a blank musing', async () => {
	anthropicPlans.push({}, {});
	openAiPlans.push({}, {});

	const events = await collect();

	assert.deepEqual(sources(events), ['fallback']);
	assert.ok(text(events).trim().length > 0);
	assert.equal(events.at(-1)?.type, 'done');
	assert.equal(waterfallReads, 1);
});
