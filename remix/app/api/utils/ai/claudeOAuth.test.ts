import assert from 'node:assert/strict';
import test from 'node:test';
import { createClaudeOAuthClient, claudeOAuthEnvironment, requireOAuthToken } from './claudeOAuth';
import { claudeOAuthConfigured } from './claudeOAuthCore';
const token = 'sk-ant-oat-test-only';
const usage = { input_tokens: 12, output_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 };

test('OAuth runtime excludes API keys, alternate providers and host secrets', () => {
	assert.equal(claudeOAuthConfigured({ ANTHROPIC_API_KEY: 'old-paid-key', ANTHROPIC_AUTH_TOKEN: 'old-token' }), false);
	assert.equal(claudeOAuthConfigured({ CLAUDE_CODE_OAUTH_TOKEN: token }), true);
	assert.throws(() => requireOAuthToken('sk-ant-api03-rejected'), /API keys are not supported/);
	const env = claudeOAuthEnvironment(token, '/tmp/isolated', 999999);
	assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, token);
	assert.equal(env.HOME, '/tmp/isolated');
	assert.equal(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, '32000');
	for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'OPENAI_API_KEY', 'NODE_OPTIONS'])
		assert.equal(env[name], undefined);
});

test('SDK streaming adapter preserves text, model, effort and usage', async () => {
	const client = createClaudeOAuthClient({
		token,
		run: async function* (request, credential) {
			assert.equal(credential, token);
			assert.equal(request.model, 'claude-opus-5');
			assert.equal(request.output_config?.effort, 'high');
			yield { text: 'Hel' };
			yield { text: 'lo' };
			yield { usage };
		}
	});
	const stream = client.messages.stream({
		model: 'claude-opus-5',
		output_config: { effort: 'high' },
		max_tokens: 100,
		messages: [{ role: 'user', content: 'Hello' }]
	});
	let deltas = '';
	for await (const event of stream) if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') deltas += event.delta.text;
	const result = await stream.finalMessage();
	assert.equal(deltas, 'Hello');
	assert.equal(result.model, 'claude-opus-5');
	assert.deepEqual(result.content, [{ type: 'text', text: 'Hello' }]);
	assert.equal(result.usage.output_tokens, 5);
});

test('tool requests remain host-executed native blocks across split fences', async () => {
	const client = createClaudeOAuthClient({
		token,
		run: async function* () {
			yield { text: 'Building.\n```tt-' };
			yield { text: 'tool\n{"name":"create_page","input":' };
			yield { text: '{"name":"Test"}}\n```' };
			yield { usage };
		}
	});
	const result = await client.messages.create({
		model: 'claude-opus-5',
		max_tokens: 100,
		tools: [{ name: 'create_page', input_schema: { type: 'object' } }],
		messages: [{ role: 'user', content: 'Build' }]
	});
	assert.equal(result.stop_reason, 'tool_use');
	assert.equal(result.content[1].type, 'tool_use');
	assert.deepEqual((result.content[1] as any).input, { name: 'Test' });
});

test('OAuth failure fails the request and never makes an API-key network call', async () => {
	const client = createClaudeOAuthClient({
		token,
		run: async function* () {
			throw new Error('OAuth unavailable');
		}
	});
	await assert.rejects(client.messages.create({ model: 'claude-opus-5', max_tokens: 10, messages: [{ role: 'user', content: 'Hi' }] }));
});

test('streamed tool JSON excludes the outer fence envelope', async () => {
	const client = createClaudeOAuthClient({
		token,
		run: async function* () {
			for (const text of ['Before\n```tt-tool\n', '{"name":"echo","input":', '{"text":"OK","nested":{"x":1}}}', '\n```']) yield { text };
			yield { usage };
		}
	});
	const stream = client.messages.stream({
		model: 'claude-opus-5',
		max_tokens: 100,
		tools: [{ name: 'echo', input_schema: { type: 'object' } }],
		messages: [{ role: 'user', content: 'Use echo' }]
	});
	const result = await stream.finalMessage();
	assert.equal(result.stop_reason, 'tool_use');
	assert.deepEqual((result.content[1] as any).input, { text: 'OK', nested: { x: 1 } });
});

test('tool names split at every character stay intact and truncated calls fail', async () => {
	const make = (text: string) =>
		createClaudeOAuthClient({
			token,
			run: async function* () {
				for (const character of text) yield { text: character };
				yield { usage };
			}
		});
	const request = {
		model: 'claude-opus-5',
		max_tokens: 100,
		tools: [{ name: 'echo', input_schema: { type: 'object' as const } }],
		messages: [{ role: 'user' as const, content: 'Echo' }]
	};
	const result = await make('```tt-tool\n{"name":"echo","input":{"text":"OK"}}\n```').messages.stream(request).finalMessage();
	assert.equal((result.content[1] as any).name, 'echo');
	await assert.rejects(make('```tt-tool\n{"name":"echo","input":{"text":"O').messages.stream(request).finalMessage());
});

test('refusal and token-limit stops remain visible to moderation and tool loops', async () => {
	for (const stopReason of ['refusal', 'max_tokens']) {
		const client = createClaudeOAuthClient({
			token,
			run: async function* () {
				yield { text: 'Result' };
				yield { usage, stopReason };
			}
		});
		const result = await client.messages.create({ model: 'claude-opus-5', max_tokens: 10, messages: [{ role: 'user', content: 'Hi' }] });
		assert.equal(result.stop_reason, stopReason);
		assert.deepEqual(result.usage, usage);
	}
});

test('a complete tool at EOF needs no closing Markdown fence', async () => {
 const client = createClaudeOAuthClient({ token, run: async function* () {
  yield { text: 'Working…\n```tt-tool\n{"name":"echo","input":{"text":"OK"}}' };
  yield { usage };
 } });
 const result = await client.messages.stream({ model: 'claude-opus-5', max_tokens: 100,
  tools: [{ name: 'echo', input_schema: { type: 'object' } }], messages: [{ role: 'user', content: 'Echo' }] }).finalMessage();
 assert.equal(result.stop_reason, 'tool_use');
 assert.deepEqual((result.content[1] as any).input, { text: 'OK' });
});

test('token exhaustion retains partial text and never executes truncated tool arguments', async () => {
 const client = createClaudeOAuthClient({ token, run: async function* () {
  yield { text: 'Here is the plan.\n```tt-tool\n{"name":"echo","input":{"text":"unfinished' };
  yield { usage, stopReason: 'max_tokens' };
 } });
 const result = await client.messages.stream({ model: 'claude-opus-5', max_tokens: 100,
  tools: [{ name: 'echo', input_schema: { type: 'object' } }], messages: [{ role: 'user', content: 'Echo' }] }).finalMessage();
 assert.equal(result.stop_reason, 'max_tokens');
 assert.equal(result.content.some(block => block.type === 'tool_use'), false);
 assert.match((result.content[0] as any).text, /Here is the plan/);
 assert.deepEqual(result.usage, usage);
});
