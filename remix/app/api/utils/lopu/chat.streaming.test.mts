import Anthropic from '@anthropic-ai/sdk';
import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, beforeEach, mock, test } from 'node:test';

// A fake SSE server standing in for BOTH providers. Each request pops one
// plan: Anthropic plans describe content blocks (text / tool_use with the
// input JSON split into input_json_delta frames) and a stop reason; OpenAI
// plans describe content chunks and per-index tool_call argument frames.
// Tools are executed by a fake runner injected through deps — the loop, the
// streaming parsers, the request shapes and the fall-through are real.

type AnthropicBlock = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; inputChunks: string[] };
type AnthropicPlan = { blocks?: AnthropicBlock[]; stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'pause_turn'; status?: number };
type OpenAiToolCall = { id: string; name: string; argumentChunks: string[] };
// `plain` answers a NON-streaming request with a whole chat.completion (an
// OpenAI-compatible endpoint without streaming); `rejectStreaming` refuses a
// `stream: true` request the way the local Codex proxy does (400)
type OpenAiPlan = {
  contentChunks?: string[];
  toolCalls?: OpenAiToolCall[];
  finish?: 'stop' | 'tool_calls' | 'length';
  status?: number;
  plain?: { content: string; toolCalls?: Array<{ id: string; name: string; arguments: string }>; finish?: 'stop' | 'tool_calls' | 'length' };
  rejectStreaming?: boolean;
};
type CapturedRequest = { body: Record<string, any>; headers: IncomingHttpHeaders; surface?: 'beta' | 'stable' };

const anthropicPlans: AnthropicPlan[] = [];
const anthropicRequests: CapturedRequest[] = [];
const openAiPlans: OpenAiPlan[] = [];
const openAiRequests: CapturedRequest[] = [];
// Responses uses its actual SDK SSE parser against this same HTTP fixture.
type ResponsesPlan = { events?: Array<Record<string, unknown>>; status?: number };
const responsesPlans: ResponsesPlan[] = [];
const responsesRequests: CapturedRequest[] = [];
let waterfall: string[] = [];
let waterfallReads = 0;

const sse = (response: ServerResponse, events: Array<Record<string, unknown>>, named: boolean) => {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of events) response.write(named ? `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n` : `data: ${JSON.stringify(event)}\n\n`);
  if (!named) response.write('data: [DONE]\n\n');
  response.end();
};

const sendAnthropic = (response: ServerResponse, plan: AnthropicPlan) => {
  if (plan.status) {
    response.writeHead(plan.status, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'nope' } }));
    return;
  }
  const events: Array<Record<string, unknown>> = [
    {
      type: 'message_start',
      message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'claude-test', stop_reason: null, stop_sequence: null, usage: { input_tokens: 7, output_tokens: 0 } }
    }
  ];
  (plan.blocks || []).forEach((block, index) => {
    if (block.type === 'text') {
      events.push(
        { type: 'content_block_start', index, content_block: { type: 'text', text: '', citations: null } },
        { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } },
        { type: 'content_block_stop', index }
      );
    } else {
      events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
      for (const chunk of block.inputChunks) events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: chunk } });
      events.push({ type: 'content_block_stop', index });
    }
  });
  events.push({ type: 'message_delta', delta: { stop_reason: plan.stopReason || 'end_turn', stop_sequence: null }, usage: { output_tokens: 11 } }, { type: 'message_stop' });
  sse(response, events, true);
};

const sendOpenAi = (response: ServerResponse, plan: OpenAiPlan, model: string, body: Record<string, any>) => {
  if (plan.status) {
    response.writeHead(plan.status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'nope', type: 'invalid_request_error' } }));
    return;
  }
  if (plan.rejectStreaming && body.stream === true) {
    // the local Codex proxy's exact refusal shape (a bare JSON error, no `error.message`)
    response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: true, statusCode: 400, message: 'Streaming is not implemented by this local proxy' }));
    return;
  }
  if (plan.plain) {
    const toolCalls = (plan.plain.toolCalls || []).map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }));
    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        id: 'chatcmpl_plain',
        object: 'chat.completion',
        created: 1,
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: plan.plain.content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: plan.plain.finish || (toolCalls.length ? 'tool_calls' : 'stop') }],
        usage: { prompt_tokens: 7, completion_tokens: 11 }
      })
    );
    return;
  }
  const chunk = (delta: Record<string, unknown>, finish: string | null) => ({
    id: 'chatcmpl_test',
    object: 'chat.completion.chunk',
    created: 1,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }]
  });
  const events: Array<Record<string, unknown>> = [];
  for (const content of plan.contentChunks || []) events.push(chunk({ content }, null));
  (plan.toolCalls || []).forEach((call, index) => {
    events.push(chunk({ tool_calls: [{ index, id: call.id, type: 'function', function: { name: call.name, arguments: '' } }] }, null));
    for (const fragment of call.argumentChunks) events.push(chunk({ tool_calls: [{ index, function: { arguments: fragment } }] }, null));
  });
  events.push(chunk({}, plan.finish || 'stop'));
  events.push({ id: 'chatcmpl_test', object: 'chat.completion.chunk', created: 1, model, choices: [], usage: { prompt_tokens: 5, completion_tokens: 9 } });
  sse(response, events, false);
};

const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  if (pathname.endsWith('/messages')) {
    anthropicRequests.push({ body, headers: request.headers, surface: String(request.headers['anthropic-beta'] || '').includes('fast-mode') ? 'beta' : 'stable' });
    const plan = anthropicPlans.shift();
    if (!plan) {
      response.writeHead(400).end('unexpected Anthropic request');
      return;
    }
    sendAnthropic(response, plan);
    return;
  }
  if (pathname.endsWith('/responses')) {
    responsesRequests.push({ body, headers: request.headers });
    const plan = responsesPlans.shift();
    if (!plan || plan.status) {
      response.writeHead(plan?.status || 400, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: { message: 'Provider refused the request', type: 'invalid_request_error' } }));
    } else sse(response, plan.events || [], true);
    return;
  }
  if (pathname.endsWith('/chat/completions')) {
    openAiRequests.push({ body, headers: request.headers });
    const plan = openAiPlans.shift();
    if (!plan) {
      response.writeHead(400).end('unexpected OpenAI request');
      return;
    }
    sendOpenAi(response, plan, body.model || 'openai-test', body);
    return;
  }
  response.writeHead(404).end('unexpected test route');
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const envNames = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID',
  'LOPU_CHAT_PROVIDER',
  'LOPU_OPENAI_TOOLS',
  'LOPU_CLAUDE_MODEL',
  'LOPU_OPENAI_MODEL',
  'THINGTIME_LOPU_PROVIDER_DEV_REWRITES',
  'THINGTIME_LOPU_PROVIDER_ALLOWED_HOSTS',
  'NODE_ENV',
  'VERCEL'
];
const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));

mock.module(new URL('../settings/prConflictResolverModelWaterfall.ts', import.meta.url).href, {
  exports: {
    getAiPreferredModelWaterfall: async () => {
      waterfallReads += 1;
      return [...waterfall];
    }
  }
});

mock.module(new URL('../ai/claudeOAuth.ts', import.meta.url).href, { exports: {
  claudeOAuthConfigured: () => Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN),
  createClaudeOAuthClient: (options: any = {}) => new Anthropic({ apiKey: null, authToken: options.token || process.env.CLAUDE_CODE_OAUTH_TOKEN, baseURL: process.env.ANTHROPIC_BASE_URL })
} });

const { streamLopuChatTurn, LOPU_FALLBACK_VAULT, createTtToolTextParser, unwrapEnvelopeContent, wrapBareToolCalls } = await import('./chat.ts');
const { parseAiWorkflowModelOptionId } = await import('../settings/prConflictResolverModelWaterfallCore.ts');
const { LOPU_VAULT_HOST_NOT_ALLOWED_REASON } = await import('./vaultProviders.ts');

type ToolCallRecord = { id: string; name: string; input: any };
let toolCalls: ToolCallRecord[] = [];

// The fake executor: records calls and emits the events a real executor
// would (a patch for patch_page, a thing for create_page).
const fakeRunTool = async (call: ToolCallRecord, ctx: any) => {
  toolCalls.push(call);
  if (call.name === 'patch_page') {
    ctx.emit({ type: 'patch', id: call.id, target: call.input?.target ?? 'active', ops: call.input?.ops ?? [], pageId: 'page-1', persisted: true });
    return { ok: true, summary: 'Applied 1/1 op(s)', data: { pageId: 'page-1', persisted: true } };
  }
  if (call.name === 'create_page') {
    ctx.emit({ type: 'thing', id: call.id, kind: 'webpage', thing: { id: 'page-new', thingtime: ['webpage'], crystal: call.input } });
    return { ok: true, summary: `Created page "${call.input?.name}"`, data: { pageId: 'page-new', thing: { id: 'page-new' } } };
  }
  if (call.name === 'delete_thing') {
    // the real executor's contract: an approved key runs, anything else
    // mints a grant, hands the client a confirm event and tells the model to wait
    const id = String(call.input?.id ?? '');
    const key = `delete_thing:${id}`;
    if (ctx.confirmations.consume(key)) return { ok: true, summary: `Deleted ${id}`, data: { id } };
    const grant = await ctx.confirmations.mint({ key, tool: 'delete_thing', summary: `Delete thing ${id}`, subject: { id } });
    ctx.emit({ type: 'confirm', id: call.id, name: 'delete_thing', key, token: grant.token, expiresAt: grant.expiresAt, summary: `Delete thing ${id}`, subject: { id } });
    return { ok: false, needsConfirmation: true, error: 'Refused: deleting needs the user’s confirmation' };
  }
  return { ok: true, summary: `${call.name} ok`, data: { echo: call.input } };
};

const fakeMint = async ({ action }: { action: { key: string } }) => ({ token: `grant-for-${action.key}`, expiresAt: '2099-01-01T00:00:00.000Z' });

const turn = (text: string, choiceId: string | null, extra: Record<string, unknown> = {}) =>
  streamLopuChatTurn({
    viewer: { id: 'user-1', username: 'lopu' },
    chatId: 'lopu-chat-1',
    userMessageId: 'msg-user-1',
    requestId: 'req-1',
    text,
    history: [{ role: 'user', text: 'earlier question' }, { role: 'assistant', text: 'earlier answer' }],
    choice: choiceId ? parseAiWorkflowModelOptionId(choiceId) : null,
    context: { route: '/builder', page: { id: 'page-1', source: 'user', blocks: [{ id: 'title', type: 'text', text: 'Hi' }] } },
    deps: { runTool: fakeRunTool as any, mintConfirmation: fakeMint as any, fallbackPaceMs: 0, testPaceMs: 0 },
    ...extra
  });

const collect = async (generator: ReturnType<typeof turn>) => {
  const events: any[] = [];
  for (;;) {
    const step = await generator.next();
    if (step.done) return { events, outcome: step.value };
    events.push(step.value);
  }
};

const types = (events: any[]) => events.map((event) => event.type);
const text = (events: any[]) => events.filter((event) => event.type === 'delta').map((event) => event.text).join('');
const meta = (events: any[]) => events.find((event) => event.type === 'meta');

beforeEach(() => {
  anthropicPlans.length = 0;
  anthropicRequests.length = 0;
  openAiPlans.length = 0;
  openAiRequests.length = 0;
  responsesPlans.length = 0;
  responsesRequests.length = 0;
  toolCalls = [];
  waterfallReads = 0;
  waterfall = ['claude-opus-5:high', 'gpt-5.5:high', 'default'];
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'anthropic-test-key';
  process.env.ANTHROPIC_BASE_URL = origin;
  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.OPENAI_BASE_URL = `${origin}/v1`;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.LOPU_CHAT_PROVIDER;
  delete process.env.LOPU_OPENAI_TOOLS;
  process.env.LOPU_CLAUDE_MODEL = 'claude-provider-default';
  process.env.LOPU_OPENAI_MODEL = 'openai-provider-default';
  delete process.env.OPENAI_ORG_ID;
  delete process.env.OPENAI_PROJECT_ID;
  delete process.env.THINGTIME_LOPU_PROVIDER_DEV_REWRITES;
  delete process.env.THINGTIME_LOPU_PROVIDER_ALLOWED_HOSTS;
  delete process.env.VERCEL;
  if (originalEnv.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnv.NODE_ENV;
});

after(async () => {
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

const pageInput = { name: 'Hi', blocks: [{ id: 'a', type: 'text', text: 'hello' }], open: true };
const pageJson = JSON.stringify(pageInput);

test('Claude: streams tool input, executes as the viewer, feeds tool_result back and ends with text', async () => {
  anthropicPlans.push(
    {
      blocks: [
        { type: 'text', text: 'Building… ' },
        { type: 'tool_use', id: 'toolu_1', name: 'create_page', inputChunks: [pageJson.slice(0, 12), pageJson.slice(12, 40), pageJson.slice(40)] }
      ],
      stopReason: 'tool_use'
    },
    { blocks: [{ type: 'text', text: 'Done ✨' }], stopReason: 'end_turn' }
  );

  const { events, outcome } = await collect(turn('make me a page', 'claude-opus-5:high'));

  assert.deepEqual(types(events), ['meta', 'delta', 'tool_use_start', 'tool_input_delta', 'tool_input_delta', 'tool_input_delta', 'tool_use', 'thing', 'tool_result', 'delta']);
  assert.equal(meta(events).provider, 'claude');
  assert.equal(meta(events).model, 'claude-opus-5');
  assert.equal(meta(events).effort, 'high');
  assert.equal(meta(events).chatId, 'lopu-chat-1');
  assert.deepEqual(events[6], { type: 'tool_use', id: 'toolu_1', name: 'create_page', input: pageInput });
  assert.equal(events.filter((event) => event.type === 'tool_input_delta').map((event) => event.partial).join(''), pageJson);
  assert.equal(events[8].ok, true);
  assert.equal(events[8].id, 'toolu_1');
  assert.equal(text(events), 'Building… Done ✨');
  assert.deepEqual(toolCalls.map((call) => call.name), ['create_page']);
  assert.equal(outcome.provider, 'claude');
  assert.equal(outcome.stopReason, 'end_turn');
  assert.equal(outcome.text, 'Building… Done ✨');
  assert.ok(outcome.toolCalls[0].links?.some((link) => link.href === '/builder?page=page-new'));
  assert.deepEqual(outcome.toolCalls.map((call) => ({ name: call.name, ok: call.ok, thingId: call.thingId })), [{ name: 'create_page', ok: true, thingId: 'page-new' }]);
  assert.equal(outcome.usage?.outputTokens, 22);

  assert.equal(anthropicRequests.length, 2);
  const first = anthropicRequests[0].body;
  assert.equal(first.model, 'claude-opus-5');
  assert.equal(first.max_tokens, 16000);
  assert.deepEqual(first.output_config, { effort: 'high' });
  assert.deepEqual(first.tool_choice, { type: 'auto' });
  assert.equal(Array.isArray(first.system), true);
  assert.deepEqual(first.system[0].cache_control, { type: 'ephemeral' });
  assert.match(first.system[0].text, /You are Lopu/);
  assert.match(first.system[1].text, /Active builder page/);
  assert.match(first.system[1].text, /title \(text\)/);
  const createPage = first.tools.find((tool: any) => tool.name === 'create_page');
  assert.equal(createPage.eager_input_streaming, true);
  assert.equal(first.tools.find((tool: any) => tool.name === 'search_things').eager_input_streaming, undefined);
  assert.deepEqual(first.messages.map((message: any) => message.role), ['user', 'assistant', 'user']);
  assert.equal(first.messages.at(-1).content, 'make me a page');

  const second = anthropicRequests[1].body;
  assert.deepEqual(second.messages.map((message: any) => message.role), ['user', 'assistant', 'user', 'assistant', 'user']);
  const toolResult = second.messages.at(-1).content[0];
  assert.equal(toolResult.type, 'tool_result');
  assert.equal(toolResult.tool_use_id, 'toolu_1');
  assert.equal(toolResult.is_error, undefined);
  assert.match(toolResult.content, /"ok":true/);
  assert.match(toolResult.content, /page-new/);
  assert.equal(second.messages[3].content.some((block: any) => block.type === 'tool_use' && block.name === 'create_page'), true);
  assert.equal(waterfallReads, 1);
});

test('Claude preserves the selected effort and speed without a bare retry', async () => {
  anthropicPlans.push({ blocks: [{ type: 'text', text: 'Selected settings' }], stopReason: 'end_turn' });
  const { events, outcome } = await collect(turn('hi', 'claude-opus-5:max:fast'));
  assert.equal(meta(events).provider, 'claude'); assert.equal(text(events), 'Selected settings');
  assert.equal(outcome.speed, 'fast'); assert.equal(anthropicRequests.length, 1);
  assert.equal(anthropicRequests[0].body.speed, 'fast');
  assert.deepEqual(anthropicRequests[0].body.output_config, { effort: 'max' });
});

test('an explicit Claude selection never silently falls back to OpenAI', async () => {
  anthropicPlans.push({ status: 400 }, { status: 400 });
  const { events, outcome } = await collect(turn('hi', 'claude-opus-5:high'));
  assert.equal(meta(events).provider, 'fallback');
  assert.equal(outcome.provider, 'fallback');
  assert.equal(openAiRequests.length, 0);
});

test('OpenAI native tools: per-index argument accumulation, tool messages, and the request shape', async () => {
  const patchInput = { target: 'active', ops: [{ op: 'update', id: 'title', patch: { text: 'Hello!' } }] };
  const patchJson = JSON.stringify(patchInput);
  openAiPlans.push(
    { contentChunks: ['Let me '], toolCalls: [{ id: 'call_1', name: 'patch_page', argumentChunks: [patchJson.slice(0, 9), patchJson.slice(9, 30), patchJson.slice(30)] }], finish: 'tool_calls' },
    { contentChunks: ['Patched!'], finish: 'stop' }
  );

  const { events, outcome } = await collect(turn('change the title', 'gpt-5.5:xhigh:fast'));

  assert.deepEqual(types(events), ['meta', 'delta', 'tool_use_start', 'tool_input_delta', 'tool_input_delta', 'tool_input_delta', 'tool_use', 'patch', 'tool_result', 'delta']);
  assert.equal(meta(events).provider, 'openai');
  assert.deepEqual(events[6], { type: 'tool_use', id: 'call_1', name: 'patch_page', input: patchInput });
  assert.equal(events[7].persisted, true);
  assert.equal(events[8].ok, true);
  assert.equal(text(events), 'Let me Patched!');
  assert.equal(outcome.stopReason, 'end_turn');
  assert.equal(outcome.usage?.inputTokens, 10);

  assert.equal(openAiRequests.length, 2);
  const first = openAiRequests[0].body;
  assert.equal(first.model, 'gpt-5.5');
  assert.equal(first.max_completion_tokens, 16000);
  assert.equal(first.max_tokens, undefined);
  assert.equal(first.reasoning_effort, 'xhigh');
  assert.equal(first.service_tier, 'priority');
  assert.equal(first.tool_choice, 'auto');
  assert.equal(first.tools.find((tool: any) => tool.function.name === 'patch_page').type, 'function');
  assert.equal(first.messages[0].role, 'system');
  assert.match(first.messages[0].content, /You are Lopu/);
  assert.doesNotMatch(first.messages[0].content, /tt-tool-result/);
  const second = openAiRequests[1].body;
  const assistant = second.messages.find((message: any) => message.role === 'assistant' && message.tool_calls);
  assert.equal(assistant.content, 'Let me ');
  assert.equal(assistant.tool_calls[0].id, 'call_1');
  assert.equal(assistant.tool_calls[0].function.arguments, patchJson);
  const toolMessage = second.messages.at(-1);
  assert.equal(toolMessage.role, 'tool');
  assert.equal(toolMessage.tool_call_id, 'call_1');
  assert.match(toolMessage.content, /"ok":true/);
});

test('OpenAI text mode: fenced tt-tool blocks become tool calls, text outside streams, results go back as a user message', async () => {
  process.env.LOPU_CHAT_PROVIDER = 'openai';
  process.env.LOPU_OPENAI_TOOLS = 'text';
  openAiPlans.push(
    {
      contentChunks: ['Sure! ', '``', '`tt-', 'tool\n{"name":"create_page","input":{"name":"Hi","blo', 'cks":[{"id":"a","type":"text","text":"x"}]}}\n``', '`', ' Now on the page.'],
      finish: 'stop'
    },
    { contentChunks: ['All done 🦄'], finish: 'stop' }
  );

  const { events, outcome } = await collect(turn('make me a page', 'gpt-5.5'));

  assert.equal(meta(events).provider, 'openai');
  assert.equal(text(events), 'Sure!  Now on the page.All done 🦄');
  const start = events.find((event) => event.type === 'tool_use_start');
  assert.equal(start.name, 'create_page');
  const use = events.find((event) => event.type === 'tool_use');
  assert.deepEqual(use.input, { name: 'Hi', blocks: [{ id: 'a', type: 'text', text: 'x' }] });
  const partial = events.filter((event) => event.type === 'tool_input_delta').map((event) => event.partial).join('');
  assert.match(partial, /^\{"name":"Hi","blocks"/);
  assert.equal(events.find((event) => event.type === 'thing')?.kind, 'webpage');
  assert.equal(events.find((event) => event.type === 'tool_result')?.ok, true);
  assert.deepEqual(toolCalls.map((call) => call.name), ['create_page']);
  assert.equal(outcome.text, 'Sure!  Now on the page.All done 🦄');

  assert.equal(openAiRequests.length, 2);
  assert.equal(openAiRequests[0].body.tools, undefined);
  assert.match(openAiRequests[0].body.messages[0].content, /```tt-tool/);
  const second = openAiRequests[1].body;
  const assistant = second.messages.find((message: any) => message.role === 'assistant' && /tt-tool/.test(String(message.content)));
  assert.ok(assistant, 'the raw fenced reply is echoed back as the assistant turn');
  const results = second.messages.at(-1);
  assert.equal(results.role, 'user');
  assert.match(results.content, /```tt-tool-result/);
  assert.match(results.content, /"name":"create_page"/);
  assert.match(results.content, /page-new/);
  assert.equal(anthropicRequests.length, 0);
});

test('the tt-tool text parser holds back partial fence markers and closes a cut-off fence', () => {
  let count = 0;
  const parser = createTtToolTextParser({ nextId: () => `call_${++count}`, mode: 'execute' });
  const events = [...parser.push('Hello `'), ...parser.push('`` not a fence\n'), ...parser.push('```tt-tool\n{"name":"navigate","input":{"path":"/lopu"')];
  assert.deepEqual(events.filter((event) => event.type === 'text').map((event: any) => event.text).join(''), 'Hello ``` not a fence\n');
  assert.equal(events.some((event) => event.type === 'tool_use_start' && (event as any).name === 'navigate'), true);
  const tail = parser.finish();
  const use = tail.find((event) => event.type === 'tool_use') as any;
  assert.deepEqual(use.input, { path: '/lopu' });
  assert.deepEqual(parser.calls(), [{ id: 'call_1', name: 'navigate', input: { path: '/lopu' } }]);
});

test('unwrapEnvelopeContent peels the envelopes some OpenAI-compatible bridges leave around the reply', () => {
  const fence = '```tt-tool\n{"name":"navigate","input":{"path":"/lopu"}}\n```';
  assert.equal(unwrapEnvelopeContent(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `Hello ${fence}` } }] })), `Hello ${fence}`);
  assert.equal(unwrapEnvelopeContent('{"content":"Hi there"}'), 'Hi there');
  assert.equal(unwrapEnvelopeContent(` ${JSON.stringify({ content: JSON.stringify({ content: 'twice' }) })} `), 'twice');
  // a reply that merely contains or is other JSON is left alone
  assert.equal(unwrapEnvelopeContent('Here is JSON: {"content":"x"}'), 'Here is JSON: {"content":"x"}');
  assert.equal(unwrapEnvelopeContent('{"ok":true}'), '{"ok":true}');
  assert.equal(unwrapEnvelopeContent('{"content":5}'), '{"content":5}');
  assert.equal(unwrapEnvelopeContent('plain text'), 'plain text');
  // the whole reply as a JSON string literal decodes (with or without escapes inside);
  // quotes that do not form one literal stay put
  assert.equal(unwrapEnvelopeContent(JSON.stringify(`Hi ${fence}`)), `Hi ${fence}`);
  assert.equal(unwrapEnvelopeContent('"Hello! What shall we make? ✨"'), 'Hello! What shall we make? ✨');
  assert.equal(unwrapEnvelopeContent('"one" and "two"'), '"one" and "two"');
  assert.equal(unwrapEnvelopeContent('"'), '"');
});

test('wrapBareToolCalls re-fences a reply that is nothing but tool-call JSON', () => {
  const call = { name: 'create_page', input: { name: 'Hero', blocks: [] } };
  assert.equal(wrapBareToolCalls(JSON.stringify(call)), `\`\`\`tt-tool\n${JSON.stringify(call)}\n\`\`\``);
  const two = [call, { name: 'navigate', input: { path: '/lopu' } }];
  assert.equal(wrapBareToolCalls(` ${JSON.stringify(two)} `).split('```tt-tool').length - 1, 2);
  // unknown tools, plain prose, and ordinary JSON are left alone
  assert.equal(wrapBareToolCalls('{"name":"make_coffee","input":{}}'), '{"name":"make_coffee","input":{}}');
  assert.equal(wrapBareToolCalls('Sure! {"name":"navigate","input":{}}'), 'Sure! {"name":"navigate","input":{}}');
  assert.equal(wrapBareToolCalls('{"ok":true}'), '{"ok":true}');
});

test('a plain completion that is a bare tool-call object still runs the tool (text mode)', async () => {
  process.env.LOPU_CHAT_PROVIDER = 'openai';
  process.env.LOPU_OPENAI_TOOLS = 'text';
  openAiPlans.push(
    { rejectStreaming: true },
    { plain: { content: JSON.stringify({ content: JSON.stringify({ name: 'create_page', input: { name: 'Bare', blocks: [{ id: 'a', type: 'text', text: 'x' }] } }) }) } },
    { plain: { content: '{"message":"All done 🦄"}' } }
  );

  const { events, outcome } = await collect(turn('make me a page', 'gpt-5.5'));

  assert.equal(meta(events).provider, 'openai');
  assert.equal(events.find((event) => event.type === 'tool_use')?.name, 'create_page');
  assert.deepEqual(toolCalls.map((call) => call.name), ['create_page']);
  assert.equal(text(events), 'All done 🦄');
  assert.equal(outcome.stopReason, 'end_turn');
  assert.equal(openAiRequests.length, 3);
  assert.equal(openAiRequests[2].body.stream, false);
});

test('a destructive tool stops for the user (confirm → tool_result needsConfirmation → the model is told to wait); a verified grant lets it run and is listed in the live context', async () => {
  anthropicPlans.push(
    { blocks: [{ type: 'tool_use', id: 'toolu_del', name: 'delete_thing', inputChunks: ['{"id":"thing-9","confirmed":true}'] }], stopReason: 'tool_use' },
    { blocks: [{ type: 'text', text: 'Please confirm on the card.' }], stopReason: 'end_turn' }
  );
  const first = await collect(turn('delete thing-9', 'claude-opus-5:high'));
  assert.deepEqual(types(first.events), ['meta', 'tool_use_start', 'tool_input_delta', 'tool_use', 'confirm', 'tool_result', 'delta']);
  const confirm = first.events.find((event) => event.type === 'confirm');
  assert.deepEqual(confirm, {
    type: 'confirm',
    id: 'toolu_del',
    name: 'delete_thing',
    key: 'delete_thing:thing-9',
    token: 'grant-for-delete_thing:thing-9',
    expiresAt: '2099-01-01T00:00:00.000Z',
    summary: 'Delete thing thing-9',
    subject: { id: 'thing-9' }
  });
  const refused = first.events.find((event) => event.type === 'tool_result');
  assert.equal(refused.ok, false);
  assert.equal(refused.needsConfirmation, true);
  assert.equal(first.outcome.toolCalls[0].ok, false);
  // the model reads a refusal (is_error) — never the token
  const fed = anthropicRequests[1].body.messages.at(-1).content[0];
  assert.equal(fed.is_error, true);
  assert.match(fed.content, /confirmation/i);
  assert.doesNotMatch(JSON.stringify(anthropicRequests[1].body), /grant-for-/);
  assert.doesNotMatch(anthropicRequests[0].body.system[1].text, /Approved by the user/);
  assert.match(anthropicRequests[0].body.system[0].text, /## Untrusted content/);

  // the user pressed Confirm: the route verified the grant and hands the
  // approved key over — the executor runs, the live context names the approval
  anthropicPlans.push(
    { blocks: [{ type: 'tool_use', id: 'toolu_del2', name: 'delete_thing', inputChunks: ['{"id":"thing-9"}'] }], stopReason: 'tool_use' },
    { blocks: [{ type: 'text', text: 'Gone.' }], stopReason: 'end_turn' }
  );
  const approved = await collect(
    turn('Confirmed: Delete thing thing-9', 'claude-opus-5:high', {
      approvedConfirmations: [{ key: 'delete_thing:thing-9', tool: 'delete_thing', summary: 'Delete thing thing-9' }]
    })
  );
  assert.deepEqual(types(approved.events), ['meta', 'tool_use_start', 'tool_input_delta', 'tool_use', 'tool_result', 'delta']);
  const ran = approved.events.find((event) => event.type === 'tool_result');
  assert.equal(ran.ok, true);
  assert.equal(ran.needsConfirmation, undefined);
  assert.match(anthropicRequests[2].body.system[1].text, /Approved by the user for THIS reply[\s\S]*- delete_thing: Delete thing thing-9 \(key delete_thing:thing-9\)/);
  assert.equal(text(approved.events), 'Gone.');
});

test('a tool batch beyond the former 24-call cap executes completely', async () => {
 const many: AnthropicBlock[] = Array.from({ length: 30 }, (_, index) => ({ type: 'tool_use', id: `toolu_${index}`, name: 'navigate', inputChunks: [JSON.stringify({ path: `/p/${index}` })] }));
 anthropicPlans.push({ blocks: many, stopReason: 'tool_use' }, { blocks: [{ type: 'text', text: 'Done.' }], stopReason: 'end_turn' });
 const { events, outcome } = await collect(turn('go everywhere', 'claude-opus-5'));
 assert.equal(events.filter(event => event.type === 'tool_result' && event.ok).length, 30);
 assert.equal(toolCalls.length, 30); assert.equal(outcome.stopReason, 'end_turn');
 assert.equal(events.some(event => event.type === 'error'), false);
 assert.deepEqual(anthropicRequests[1].body.tool_choice, { type: 'auto' });
});

test('local execution continues beyond twelve hops and four elapsed minutes', async () => {
 for (let i = 0; i < 16; i++) anthropicPlans.push({ blocks: [{ type: 'tool_use', id: `toolu_${i}`, name: 'navigate', inputChunks: ['{}'] }], stopReason: 'tool_use' });
 anthropicPlans.push({ blocks: [{ type: 'text', text: 'Complete.' }], stopReason: 'end_turn' });
 let clock = 0;
 const { outcome } = await collect(turn('keep going', 'claude-opus-5', { deps: { runTool: fakeRunTool, now: () => clock += 300_000 } }));
 assert.equal(outcome.stopReason, 'end_turn'); assert.equal(toolCalls.length, 16); assert.equal(outcome.hops, 17);
});

test('hosting checkpoints occur after completed tools without forcing a wrap-up or interrupting a write', async () => {
 process.env.VERCEL = '1';
 anthropicPlans.push({ blocks: [{ type: 'tool_use', id: 'toolu_1', name: 'create_page', inputChunks: ['{"name":"Once"}'] }], stopReason: 'tool_use' });
 let clock = 0;
 const { events, outcome } = await collect(turn('build', 'claude-opus-5', { deps: { runTool: fakeRunTool, now: () => clock += 65_000 } }));
 assert.equal(outcome.stopReason, 'checkpoint'); assert.equal(toolCalls.length, 1);
 assert.equal(outcome.toolCalls[0].ok, true); assert.equal(anthropicRequests.length, 1);
 assert.equal(events.some(event => event.type === 'error'), false);
});

test('a provider error after output keeps what streamed, emits a retryable error, and never retries another provider', async () => {
  anthropicPlans.push({ blocks: [{ type: 'tool_use', id: 'toolu_1', name: 'navigate', inputChunks: ['{"path":"/lopu"}'] }], stopReason: 'tool_use' }, { status: 400 });
  openAiPlans.push({ contentChunks: ['should not run'], finish: 'stop' });

  const { events, outcome } = await collect(turn('go', 'claude-opus-5'));

  assert.equal(meta(events).provider, 'claude');
  assert.equal(events.at(-1).type, 'error');
  assert.equal(events.at(-1).retryable, true);
  assert.equal(outcome.stopReason, 'error');
  assert.equal(outcome.toolCalls.length, 1);
  assert.equal(openAiRequests.length, 0);
});

test('LOPU_CHAT_PROVIDER=test drives the scripted provider through the real loop with real tool execution', async () => {
  process.env.LOPU_CHAT_PROVIDER = 'test';

  const { events, outcome } = await collect(turn('build me a page please', null));

  assert.equal(meta(events).provider, 'test');
  assert.equal(meta(events).model, 'test');
  const use = events.find((event) => event.type === 'tool_use');
  // the request context has a page open, so the script patches it
  assert.equal(use.name, 'patch_page');
  assert.equal(use.input.target, 'active');
  assert.ok(events.filter((event) => event.type === 'tool_input_delta').length >= 6);
  assert.equal(events.some((event) => event.type === 'patch'), true);
  assert.equal(events.find((event) => event.type === 'tool_result').ok, true);
  assert.match(text(events), /section/);
  assert.equal(outcome.provider, 'test');
  assert.equal(outcome.stopReason, 'end_turn');
  assert.equal(anthropicRequests.length + openAiRequests.length, 0);
});

test('no provider configured → the honest unconfigured line, never a blank reply', async () => {
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.OPENAI_API_KEY;

  const { events, outcome } = await collect(turn('hello?', null));

  assert.deepEqual(types(events)[0], 'meta');
  assert.equal(meta(events).provider, 'fallback');
  assert.match(text(events), /no AI provider is configured/);
  assert.equal(outcome.provider, 'fallback');
  assert.equal(outcome.stopReason, 'fallback');
  assert.equal(waterfallReads, 0);
});

test('every provider failing before output ends in the daydreaming fallback', async () => {
  // the explicit Claude choice is bare (one attempt); the OpenAI fallback is
  // the waterfall's decorated gpt-5.5:high, so it gets its bare retry and
  // then the plain (non-streaming) completion rung before it is given up on
  anthropicPlans.push({ status: 400 }, { status: 400 });
  openAiPlans.push({ status: 400 }, { status: 400 }, { status: 400 });

  const { events, outcome } = await collect(turn('hello?', null));

  assert.equal(meta(events).provider, 'fallback');
  assert.match(text(events), /daydreaming/);
  assert.equal(outcome.stopReason, 'fallback');
  assert.equal(anthropicRequests.length, 1);
  assert.equal(openAiRequests.length, 3);
  assert.equal(openAiRequests[0].body.reasoning_effort, 'high');
  assert.equal(openAiRequests[1].body.reasoning_effort, undefined);
  assert.equal(openAiRequests[1].body.stream, true);
  assert.equal(openAiRequests[2].body.stream, false);
  assert.equal(openAiRequests[2].body.stream_options, undefined);
});

test('an OpenAI-compatible endpoint that refuses streaming is served by the plain-completion rung (text tools, later hops skip streaming)', async () => {
  process.env.LOPU_CHAT_PROVIDER = 'openai';
  process.env.LOPU_OPENAI_TOOLS = 'text';
  const fence = '```tt-tool\n{"name":"create_page","input":{"name":"Hi","blocks":[{"id":"a","type":"text","text":"x"}]}}\n```';
  openAiPlans.push(
    { rejectStreaming: true },
    { rejectStreaming: true },
    { plain: { content: `Sure! ${fence} Now on the page.` } },
    { plain: { content: 'All done 🦄' } }
  );

  // a decorated choice (effort high) walks the whole ladder: decorated stream
  // → bare stream → plain completion
  const { events, outcome } = await collect(turn('make me a page', 'gpt-5.5:high'));

  assert.equal(meta(events).provider, 'openai');
  assert.equal(text(events), 'Sure!  Now on the page.All done 🦄');
  assert.ok(events.filter((event) => event.type === 'delta').length > 4, 'a plain answer is replayed as several deltas');
  assert.equal(events.find((event) => event.type === 'tool_use')?.name, 'create_page');
  assert.equal(events.find((event) => event.type === 'tool_result')?.ok, true);
  assert.deepEqual(toolCalls.map((call) => call.name), ['create_page']);
  assert.equal(outcome.stopReason, 'end_turn');
  assert.deepEqual(outcome.usage, { inputTokens: 14, outputTokens: 22 });

  // decorated stream → bare stream → plain; the second hop goes straight to plain
  assert.equal(openAiRequests.length, 4);
  assert.equal(openAiRequests[0].body.stream, true);
  assert.equal(openAiRequests[1].body.stream, true);
  assert.equal(openAiRequests[2].body.stream, false);
  assert.equal(openAiRequests[2].body.stream_options, undefined);
  assert.equal(openAiRequests[2].body.max_completion_tokens, 16000);
  assert.equal(openAiRequests[3].body.stream, false);
  assert.match(openAiRequests[3].body.messages.at(-1).content, /```tt-tool-result/);
  assert.equal(anthropicRequests.length, 0);
});

// ── the viewer's own provider (Secure Vault, design note §1.3) ──────────────
//
// The fake server stands in for the user's endpoint: a vault connection saved
// with a public HTTPS origin is rewritten to it through the dev-only
// THINGTIME_LOPU_PROVIDER_DEV_REWRITES table (inert in production builds), so
// the real guard, SDK construction, and request shapes are exercised.

const FAKE_VAULT_ORIGIN = 'https://lopu-fake-provider.invalid';
const vaultRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'prov-0123456789',
  name: 'My own key',
  provider: 'compatible' as const,
  endpoint: `${FAKE_VAULT_ORIGIN}/v1`,
  model: 'my-model',
  token: 'vault-token-xyz',
  effort: null,
  ...overrides
});
const rewriteToFake = (savedOrigin = FAKE_VAULT_ORIGIN) => {
  process.env.THINGTIME_LOPU_PROVIDER_DEV_REWRITES = `${savedOrigin}=${origin}`;
};

test('a vault turn runs on the viewer’s own OpenAI-compatible connection: its key, its model, text tools — never the server keys or org', async () => {
  rewriteToFake();
  process.env.OPENAI_ORG_ID = 'org-server-secret';
  process.env.OPENAI_PROJECT_ID = 'proj-server-secret';
  const fence = '```tt-tool\n{"name":"navigate","input":{"path":"/lopu"}}\n```';
  openAiPlans.push({ contentChunks: ['Hi from your key ', fence], finish: 'stop' }, { contentChunks: ['Done.'], finish: 'stop' });

  const { events, outcome } = await collect(turn('go', 'claude-opus-5:high', { vaultProvider: vaultRecord({ effort: 'high' }) }));

  assert.equal(events[0].type, 'meta');
  assert.equal(meta(events).provider, 'vault');
  assert.equal(meta(events).providerLabel, 'My own key');
  assert.equal(meta(events).model, 'my-model');
  assert.equal(meta(events).effort, 'high');
  assert.equal(meta(events).speed, 'normal');
  assert.equal(meta(events).label, 'My own key · my-model');
  assert.equal(text(events), 'Hi from your key Done.');
  assert.equal(events.find((event) => event.type === 'tool_use')?.name, 'navigate');
  assert.equal(events.find((event) => event.type === 'tool_result')?.ok, true);
  assert.deepEqual(toolCalls.map((call) => call.name), ['navigate']);
  assert.equal(outcome.provider, 'vault');
  assert.equal(outcome.model, 'my-model');
  assert.equal(outcome.effort, 'high');
  assert.equal(outcome.stopReason, 'end_turn');

  assert.equal(openAiRequests.length, 2);
  assert.equal(openAiRequests[0].headers.authorization, 'Bearer vault-token-xyz');
  assert.equal(openAiRequests[0].headers['openai-organization'], undefined);
  assert.equal(openAiRequests[0].headers['openai-project'], undefined);
  assert.equal(openAiRequests[0].body.model, 'my-model');
  assert.equal(openAiRequests[0].body.reasoning_effort, 'high');
  assert.equal(openAiRequests[0].body.max_completion_tokens, 16000);
  // a custom compatible host gets the fenced-text tool protocol, not function tools
  assert.equal(openAiRequests[0].body.tools, undefined);
  assert.match(openAiRequests[0].body.messages[0].content, /```tt-tool/);
  assert.match(openAiRequests[1].body.messages.at(-1).content, /```tt-tool-result/);
  assert.equal(anthropicRequests.length, 0);
  assert.equal(waterfallReads, 0);
});

test('a vault turn on an Anthropic connection sends the vault key to the Messages API with native tools and never the server bearer token', async () => {
  rewriteToFake('https://lopu-fake-anthropic.invalid');
  process.env.ANTHROPIC_AUTH_TOKEN = 'server-bearer-secret';
  anthropicPlans.push({ blocks: [{ type: 'text', text: 'Claude on your key' }], stopReason: 'end_turn' });

  const { events, outcome } = await collect(
    turn('hi', null, { vaultProvider: vaultRecord({ provider: 'anthropic', endpoint: 'https://lopu-fake-anthropic.invalid', model: 'claude-own' }) })
  );

  assert.equal(meta(events).provider, 'vault');
  assert.equal(meta(events).providerLabel, 'My own key');
  assert.equal(meta(events).model, 'claude-own');
  assert.equal(meta(events).effort, null);
  assert.equal(text(events), 'Claude on your key');
  assert.equal(outcome.provider, 'vault');
  assert.equal(outcome.model, 'claude-own');
  assert.equal(anthropicRequests.length, 1);
  assert.equal(anthropicRequests[0].headers['x-api-key'], undefined);
  assert.equal(anthropicRequests[0].headers.authorization, 'Bearer vault-token-xyz');
  assert.notEqual(anthropicRequests[0].headers.authorization, 'Bearer server-bearer-secret');
  assert.equal(anthropicRequests[0].surface, 'stable');
  assert.equal(anthropicRequests[0].body.model, 'claude-own');
  assert.equal(anthropicRequests[0].body.output_config, undefined);
  assert.equal(anthropicRequests[0].body.max_tokens, 16000);
  assert.ok(anthropicRequests[0].body.tools.some((tool: any) => tool.name === 'create_page'), 'native tools ride along');
  assert.equal(anthropicRequests[0].body.system[0].cache_control.type, 'ephemeral');
  assert.equal(openAiRequests.length, 0);
  assert.equal(waterfallReads, 0);
});

test('a vault provider that rejects the key surfaces a friendly error then the canned vault line — the server keys are never a fallback', async () => {
  rewriteToFake();
  openAiPlans.push({ status: 401 }, { status: 401 });

  const { events, outcome } = await collect(turn('hi', 'claude-opus-5:high', { vaultProvider: vaultRecord() }));

  assert.deepEqual(types(events).slice(0, 2), ['meta', 'error']);
  assert.equal(meta(events).provider, 'vault');
  assert.equal(meta(events).providerLabel, 'My own key');
  assert.match(events[1].message, /^My own key rejected the saved key \(HTTP 401\)/);
  assert.doesNotMatch(events[1].message, /vault-token|invalid/);
  assert.equal(events[1].retryable, true);
  assert.equal(text(events), LOPU_FALLBACK_VAULT);
  assert.equal(outcome.provider, 'fallback');
  assert.equal(outcome.stopReason, 'fallback');
  assert.equal(outcome.model, 'my-model');
  assert.match(outcome.error, /rejected the saved key/);
  // the bare stream and then the plain rung, both on the vault endpoint with the vault key
  assert.equal(openAiRequests.length, 2);
  assert.ok(openAiRequests.every((request) => request.headers.authorization === 'Bearer vault-token-xyz'));
  assert.equal(openAiRequests[1].body.stream, false);
  assert.equal(anthropicRequests.length, 0);
  assert.equal(waterfallReads, 0);
});

test('a vault endpoint outside the server allowlist is refused before any request leaves the server', async () => {
  // no rewrite, not a built-in vendor host, not in THINGTIME_LOPU_PROVIDER_ALLOWED_HOSTS
  const { events, outcome } = await collect(turn('hi', null, { vaultProvider: vaultRecord({ endpoint: 'https://evil.example/v1' }) }));

  assert.deepEqual(types(events).slice(0, 2), ['meta', 'error']);
  assert.equal(meta(events).provider, 'vault');
  assert.equal(meta(events).model, 'my-model');
  assert.equal(events[1].message, LOPU_VAULT_HOST_NOT_ALLOWED_REASON);
  assert.equal(text(events), LOPU_FALLBACK_VAULT);
  assert.equal(outcome.provider, 'fallback');
  assert.equal(outcome.error, LOPU_VAULT_HOST_NOT_ALLOWED_REASON);
  assert.equal(openAiRequests.length + anthropicRequests.length, 0);
});

test('the dev rewrite table is inert in production builds, so the same connection is refused there', async () => {
  rewriteToFake();
  process.env.NODE_ENV = 'production';

  const { events } = await collect(turn('hi', null, { vaultProvider: vaultRecord() }));

  assert.equal(events[1].type, 'error');
  assert.equal(events[1].message, LOPU_VAULT_HOST_NOT_ALLOWED_REASON);
  assert.equal(openAiRequests.length, 0);
});

test('a vault turn takes precedence over LOPU_CHAT_PROVIDER=test and is served by the plain rung when the endpoint refuses streaming', async () => {
  process.env.LOPU_CHAT_PROVIDER = 'test';
  rewriteToFake();
  openAiPlans.push({ rejectStreaming: true }, { plain: { content: 'Plain from your key' } });

  const { events, outcome } = await collect(turn('hello', null, { vaultProvider: vaultRecord() }));

  assert.equal(meta(events).provider, 'vault');
  assert.equal(text(events), 'Plain from your key');
  assert.equal(outcome.provider, 'vault');
  assert.equal(outcome.stopReason, 'end_turn');
  assert.equal(openAiRequests.length, 2);
  assert.equal(openAiRequests[0].body.stream, true);
  assert.equal(openAiRequests[1].body.stream, false);
});

test('Both provider transports receive actual image/PDF content and retain it after tool hops', async () => {
  const media = [{name:'photo.png',contentType:'image/png',data:'cGl4ZWxz'}, {name:'file.pdf',contentType:'application/pdf',data:'cGRm'}];
  anthropicPlans.push({blocks:[{type:'tool_use',id:'read',name:'get_thing',inputChunks:['{"id":"one"}']}],stopReason:'tool_use'}, {blocks:[{type:'text',text:'Seen'}]});
  await collect(turn('Inspect', 'claude-opus-5:high', {media}));
  for (const request of anthropicRequests) {
    const content = request.body.messages.find((message:any) => Array.isArray(message.content) && message.content.some((part:any) => part.type === 'image')).content;
    assert.equal(content.find((part:any) => part.type === 'image').source.data, 'cGl4ZWxz');
    assert.equal(content.find((part:any) => part.type === 'document').source.data, 'cGRm');
  }
  openAiPlans.push({contentChunks:['Seen']});
  await collect(turn('Inspect', 'gpt-5.5:high', {media}));
  const content = openAiRequests[0].body.messages.at(-1).content;
  assert.equal(content[1].image_url.url, 'data:image/png;base64,cGl4ZWxz');
  assert.equal(content[2].file.file_data, 'data:application/pdf;base64,cGRm');
});


test('an Anthropic pause_turn resumes the exact assistant content instead of reporting completion', async () => {
 anthropicPlans.push({ blocks: [{ type: 'text', text: 'Still working. ' }], stopReason: 'pause_turn' }, { blocks: [{ type: 'text', text: 'Now complete.' }], stopReason: 'end_turn' });
 const { events, outcome } = await collect(turn('finish it', 'claude-opus-5'));
 assert.equal(outcome.stopReason, 'end_turn'); assert.equal(anthropicRequests.length, 2);
 assert.deepEqual(anthropicRequests[1].body.messages.at(-1), { role: 'assistant', content: [{ type: 'text', text: 'Still working. ', citations: null }] });
 assert.equal(text(events), 'Still working. Now complete.');
});


test('an unexpected tool failure waits for concurrent writes and retains their receipts', async () => {
  anthropicPlans.push({ blocks: [
    { type: 'tool_use', id: 'failure', name: 'create_page', inputChunks: ['{}'] },
    { type: 'tool_use', id: 'success', name: 'create_page', inputChunks: ['{}'] }
  ], stopReason: 'tool_use' });
  let completed = false;
  const runTool = async (call: { id: string }) => {
    if (call.id === 'failure') throw new Error('Unexpected failure');
    await new Promise(resolve => setTimeout(resolve, 20));
    completed = true;
    return { ok: true, summary: 'Saved once', data: { id: 'saved-thing' } };
  };
  const { outcome, events } = await collect(turn('save both', 'claude-opus-5', { deps: { runTool } }));
  assert.equal(completed, true);
  assert.equal(outcome.stopReason, 'error');
  assert.equal(outcome.toolCalls.length, 1);
  assert.equal(outcome.toolCalls[0].summary, 'Saved once');
  assert.ok(events.some(event => event.type === 'tool_result' && event.id === 'success'));
});

test('Claude receives a note only after the active tool completes, without replaying it', async () => {
 anthropicPlans.push({ blocks: [{ type: 'tool_use', id: 'tool-note', name: 'create_page', inputChunks: [pageJson] }], stopReason: 'tool_use' }, { blocks: [{ type: 'text', text: 'Noted.' }], stopReason: 'end_turn' });
 let reads = 0;
 const { outcome } = await collect(turn('build a page', 'claude-opus-5', { readNotes: async () => { assert.equal(toolCalls.length, 1); return reads++ === 0 ? ['Please use the new title.'] : []; } }));
 assert.equal(toolCalls.length, 1); assert.equal(outcome.stopReason, 'end_turn');
 assert.deepEqual(anthropicRequests[1].body.messages.at(-1), { role: 'user', content: 'Please use the new title.' });
});
test('OpenAI includes a note arriving during a text reply in a following hop of the same turn', async () => {
 openAiPlans.push({ contentChunks: ['Finishing the current work.'], finish: 'stop' }, { contentChunks: ['I have the note.'], finish: 'stop' });
 let reads = 0;
 const { outcome } = await collect(turn('work', 'gpt-5.5', { readNotes: async () => reads++ === 0 ? ['An extra detail'] : [] }));
 assert.equal(openAiRequests.length, 2); assert.equal(outcome.stopReason, 'end_turn');
 assert.deepEqual(openAiRequests[1].body.messages.at(-1), { role: 'user', content: 'An extra detail' });
});

const responseFunction = (id = 'call_sol', name = 'get_thing', args = '{"id":"one"}') => ({
  type: 'function_call', id: `item_${id}`, call_id: id, name, arguments: args, status: 'completed'
});
const responseMessage = (value: string) => ({
  type: 'message', id: 'message_sol', role: 'assistant', status: 'completed',
  content: [{ type: 'output_text', text: value, annotations: [] }]
});
const responseTerminal = (output: any[], status = 'completed', reason?: string) => ({
  type: `response.${status}`,
  response: { id: 'response_sol', status, output,
    usage: { input_tokens: 10, output_tokens: 8, input_tokens_details: { cached_tokens: 3 } },
    ...(reason ? { incomplete_details: { reason } } : {}) }
});
const responseCallEvents = (call = responseFunction(), index = 1) => [
  { type: 'response.output_item.added', output_index: index, item: { ...call, arguments: '', status: 'in_progress' } },
  { type: 'response.function_call_arguments.delta', output_index: index, item_id: call.id, delta: call.arguments.slice(0, 6) },
  { type: 'response.function_call_arguments.delta', output_index: index, item_id: call.id, delta: call.arguments.slice(6) },
  { type: 'response.function_call_arguments.done', output_index: index, item_id: call.id, arguments: call.arguments },
  { type: 'response.output_item.done', output_index: index, item: call }
];
const responseTextEvents = (value: string) => [
  { type: 'response.output_text.delta', output_index: 0, item_id: 'message_sol', content_index: 0, delta: value },
  responseTerminal([responseMessage(value)])
];

test('GPT-5.6 Sol Responses preserves High/Fast, tool IDs, encrypted reasoning, media, notes and cache usage across hops', async () => {
  const firstCall = responseFunction('provider_call_one', 'get_thing');
  const secondCall = responseFunction('provider_call_two', 'search_things', '{"query":"page"}');
  const reasoning = { type: 'reasoning', id: 'reasoning_one', summary: [], encrypted_content: 'opaque-reasoning-never-for-the-client' };
  responsesPlans.push({ events: [
    { type: 'response.output_item.added', output_index: 0, item: reasoning },
    { type: 'response.output_text.delta', output_index: 1, item_id: 'message_sol', content_index: 0, delta: 'Checking. ' },
    ...responseCallEvents(firstCall, 2), ...responseCallEvents(secondCall, 3),
    responseTerminal([reasoning, responseMessage('Checking. '), firstCall, secondCall])
  ] }, { events: responseTextEvents('Done.') });
  let noteReads = 0;
  const media = [{ name: 'photo.png', contentType: 'image/png', data: 'cGl4ZWxz' }, { name: 'file.pdf', contentType: 'application/pdf', data: 'cGRm' }];
  const { events, outcome } = await collect(turn('Inspect', 'gpt-5.6-sol:high:fast', {
    media, readNotes: async () => noteReads++ === 0 ? ['Also check the title.'] : []
  }));
  assert.equal(meta(events).model, 'gpt-5.6-sol');
  assert.equal(meta(events).effort, 'high');
  assert.equal(text(events), 'Checking. Done.');
  assert.equal(outcome.stopReason, 'end_turn');
  assert.deepEqual(toolCalls.map(call => [call.id, call.name, call.input]), [
    ['provider_call_one', 'get_thing', { id: 'one' }], ['provider_call_two', 'search_things', { query: 'page' }]
  ]);
  assert.deepEqual(outcome.usage, { inputTokens: 14, outputTokens: 16, cacheReadTokens: 6 });
  assert.equal(openAiRequests.length, 0);
  assert.equal(anthropicRequests.length, 0);
  assert.equal(responsesRequests.length, 2);
  for (const { body } of responsesRequests) {
    assert.equal(body.model, 'gpt-5.6-sol');
    assert.deepEqual(body.reasoning, { effort: 'high' });
    assert.equal(body.service_tier, 'priority');
    assert.equal(body.store, false);
    assert.deepEqual(body.include, ['reasoning.encrypted_content']);
    assert.equal(body.stream, true);
    assert.equal(body.max_output_tokens, 16000);
    assert.equal(body.max_completion_tokens, undefined);
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.tool_choice, 'auto');
    assert.match(body.instructions, /You are Lopu/);
    assert.ok(body.tools.every((tool: any) => tool.type === 'function' && tool.strict === false && !tool.function));
    assert.ok(body.tools.find((tool: any) => tool.name === 'get_thing').parameters);
    const content = body.input.find((item: any) => Array.isArray(item.content) && item.content.some((part: any) => part.type === 'input_image')).content;
    assert.equal(content[1].image_url, 'data:image/png;base64,cGl4ZWxz');
    assert.equal(content[2].file_data, 'data:application/pdf;base64,cGRm');
  }
  const replay = responsesRequests[1].body.input;
  assert.deepEqual(replay.find((item: any) => item.type === 'reasoning'), reasoning);
  assert.deepEqual(replay.filter((item: any) => item.type === 'function_call'), [firstCall, secondCall]);
  const results = replay.filter((item: any) => item.type === 'function_call_output');
  assert.deepEqual(results.map((item: any) => item.call_id), ['provider_call_one', 'provider_call_two']);
  assert.ok(results.every((item: any) => JSON.parse(item.output).ok));
  assert.deepEqual(replay.at(-1), { role: 'user', content: 'Also check the title.' });
  assert.doesNotMatch(JSON.stringify({ events, outcome }), /opaque-reasoning|reasoning_one|cGl4ZWxz|cGRm/);
});

test('GPT-5.6 Sol Responses continues a note received after a plain reply', async () => {
  responsesPlans.push({ events: responseTextEvents('First.') }, { events: responseTextEvents('Noted.') });
  let reads = 0;
  const { outcome } = await collect(turn('work', 'gpt-5.6-sol:high', { readNotes: async () => reads++ === 0 ? ['One more detail.'] : [] }));
  assert.equal(outcome.text, 'First.Noted.');
  assert.deepEqual(responsesRequests[1].body.input.at(-1), { role: 'user', content: 'One more detail.' });
  assert.deepEqual(responsesRequests[1].body.input.at(-2), responseMessage('First.'));
});

test('GPT-5.6 Sol HTTP refusal keeps requested reasoning, never retries a weaker request, and uses neutral guidance', async () => {
  responsesPlans.push({ status: 400 });
  const { events, outcome } = await collect(turn('hi', 'gpt-5.6-sol:high'));
  assert.equal(outcome.stopReason, 'fallback');
  assert.match(text(events), /provider could not process the request/);
  assert.match(text(events), /model selection has been kept/);
  assert.doesNotMatch(text(events), /credential|usage|Admin/);
  assert.deepEqual(responsesRequests[0].body.reasoning, { effort: 'high' });
  assert.equal(responsesRequests.length, 1);
  assert.equal(openAiRequests.length + anthropicRequests.length, 0);
});

for (const failure of ['failed', 'error', 'dropped', 'malformed-arguments', 'unfinished-call']) {
  test(`GPT-5.6 Sol ${failure} stream preserves text without executing/replaying a tool`, async () => {
    const call = responseFunction();
    const terminal = failure === 'failed' ? [{ type: 'response.failed', response: { status: 'failed' } }]
      : failure === 'error' ? [{ type: 'error', code: 'server_error', message: 'Provider failed', param: null }]
      : failure === 'malformed-arguments' ? [responseTerminal([{ ...call, arguments: '{"id":' }])]
      : failure === 'unfinished-call' ? [responseTerminal([{ ...call, status: 'incomplete' }])]
      : [];
    responsesPlans.push({ events: [
      { type: 'response.output_text.delta', delta: 'Kept.' }, ...responseCallEvents(call), ...terminal
    ] });
    const { events, outcome } = await collect(turn('work', 'gpt-5.6-sol:high'));
    assert.equal(outcome.stopReason, 'error');
    assert.equal(outcome.text, 'Kept.');
    assert.equal(events.at(-1).type, 'error');
    assert.equal(toolCalls.length, 0);
    assert.equal(responsesRequests.length, 1);
    assert.equal(openAiRequests.length + anthropicRequests.length, 0);
  });
}

test('GPT-5.6 Sol token exhaustion checkpoints without executing truncated tools', async () => {
  const call = responseFunction();
  responsesPlans.push({ events: [...responseCallEvents(call), responseTerminal([call], 'incomplete', 'max_output_tokens')] });
  const { outcome } = await collect(turn('work', 'gpt-5.6-sol:high'));
  assert.equal(outcome.stopReason, 'max_tokens');
  assert.deepEqual(outcome.usage, { inputTokens: 7, outputTokens: 8, cacheReadTokens: 3 });
  assert.equal(toolCalls.length, 0);
  assert.equal(responsesRequests.length, 1);
});

test('GPT-5.6 Sol cancellation after output prevents buffered calls from executing', async () => {
  const call = responseFunction();
  responsesPlans.push({ events: [{ type: 'response.output_text.delta', delta: 'Starting.' }, ...responseCallEvents(call), responseTerminal([call])] });
  const controller = new AbortController();
  const generator = turn('work', 'gpt-5.6-sol:high', { signal: controller.signal });
  assert.equal((await generator.next()).value.type, 'meta');
  assert.equal((await generator.next()).value.type, 'delta');
  controller.abort();
  const { outcome } = await collect(generator);
  assert.equal(outcome.stopReason, 'aborted');
  assert.equal(toolCalls.length, 0);
  assert.equal(responsesRequests.length, 1);
});

test('GPT-5.6 Sol hosting checkpoint retains the completed receipt and makes no extra provider request', async () => {
  process.env.VERCEL = '1';
  const call = responseFunction('saved_once', 'create_page', '{"name":"Once"}');
  responsesPlans.push({ events: [...responseCallEvents(call), responseTerminal([call])] });
  let clock = 0;
  const { outcome } = await collect(turn('build', 'gpt-5.6-sol:high', { deps: { runTool: fakeRunTool, now: () => clock += 65_000 } }));
  assert.equal(outcome.stopReason, 'checkpoint');
  assert.equal(outcome.toolCalls[0].ok, true);
  assert.equal(toolCalls.length, 1);
  assert.equal(responsesRequests.length, 1);
});

test('GPT-5.6 Sol text-tool endpoint keeps its Chat Completions contract', async () => {
  process.env.LOPU_OPENAI_TOOLS = 'text';
  openAiPlans.push({ contentChunks: ['Compatible text transport.'] });
  const { outcome } = await collect(turn('hello', 'gpt-5.6-sol:high'));
  assert.equal(outcome.text, 'Compatible text transport.');
  assert.equal(responsesRequests.length, 0);
  assert.equal(openAiRequests.length, 1);
  assert.equal(openAiRequests[0].body.reasoning_effort, 'high');
});

test('GPT-5.6 Sol rejects a whole multi-call batch when a later argument is malformed or IDs repeat', async () => {
  for (const duplicate of [false, true]) {
    const first = responseFunction('first', 'create_page', '{"name":"Must not save"}');
    const second = responseFunction(duplicate ? 'first' : 'second', 'create_page', duplicate ? '{}' : '{private-secret-invalid');
    responsesPlans.push({ events: [...responseCallEvents(first), ...responseCallEvents(second, 2), responseTerminal([first, second])] });
    const { outcome } = await collect(turn('work', 'gpt-5.6-sol:high'));
    assert.equal(outcome.stopReason, 'error');
    assert.equal(toolCalls.length, 0);
    assert.doesNotMatch(outcome.error || '', /private-secret/);
  }
  assert.equal(responsesRequests.length, 2);
});

test('GPT-5.6 Sol abort between validated call and tool batch keeps it unexecuted', async () => {
  const call = responseFunction();
  responsesPlans.push({ events: [...responseCallEvents(call), responseTerminal([call])] });
  const controller = new AbortController();
  const generator = turn('work', 'gpt-5.6-sol:high', { signal: controller.signal });
  for (;;) {
    const next = await generator.next();
    assert.equal(next.done, false);
    if (next.value.type === 'tool_use') break;
  }
  controller.abort();
  const { outcome } = await collect(generator);
  assert.equal(outcome.stopReason, 'aborted');
  assert.equal(toolCalls.length, 0);
});

test('GPT-5.6 Sol failure on the next hop retains executed tool receipts without replay', async () => {
  const call = responseFunction('saved_once', 'create_page', '{"name":"Once"}');
  responsesPlans.push({ events: [...responseCallEvents(call), responseTerminal([call])] }, { status: 400 });
  const { outcome, events } = await collect(turn('build', 'gpt-5.6-sol:high'));
  assert.equal(outcome.stopReason, 'error');
  assert.equal(outcome.toolCalls[0].ok, true);
  assert.equal(toolCalls.length, 1);
  assert.equal(responsesRequests.length, 2);
  assert.equal(events.filter(event => event.type === 'tool_result' && event.ok).length, 1);
  assert.equal(openAiRequests.length + anthropicRequests.length, 0);
});

test('GPT-5.6 Sol native vault Responses uses only its own credential, origin and requested effort', async () => {
  rewriteToFake();
  process.env.OPENAI_ORG_ID = 'org-server-secret';
  process.env.OPENAI_PROJECT_ID = 'proj-server-secret';
  responsesPlans.push({ events: responseTextEvents('Your provider.') });
  const { outcome, events } = await collect(turn('hello', 'claude-opus-5:high', {
    vaultProvider: vaultRecord({ provider: 'openai', model: 'gpt-5.6-sol', effort: 'high' })
  }));
  assert.equal(outcome.provider, 'vault');
  assert.equal(outcome.text, 'Your provider.');
  assert.equal(meta(events).effort, 'high');
  assert.equal(responsesRequests.length, 1);
  assert.equal(responsesRequests[0].headers.authorization, 'Bearer vault-token-xyz');
  assert.equal(responsesRequests[0].headers['openai-organization'], undefined);
  assert.equal(responsesRequests[0].headers['openai-project'], undefined);
  assert.deepEqual(responsesRequests[0].body.reasoning, { effort: 'high' });
  assert.equal(openAiRequests.length + anthropicRequests.length, 0);
});

for (const change of ['name', 'call-id', 'item-id', 'duplicate-item-id', 'changed-start']) {
  test(`GPT-5.6 Sol rejects ${change} identity changes before tool execution`, async () => {
    const advertised = responseFunction('visible_read', 'get_thing', '{"id":"one"}');
    const changed = change === 'name' ? { ...advertised, name: 'create_page', arguments: '{"name":"Unexpected write"}' }
      : change === 'call-id' ? { ...advertised, call_id: 'different_call' }
      : change === 'item-id' ? { ...advertised, id: 'different_item' }
      : { ...advertised, call_id: 'different_call', name: 'create_page', arguments: '{}' };
    responsesPlans.push({ events: [
      ...responseCallEvents(advertised),
      ...(change === 'changed-start' ? [{ type: 'response.output_item.added', output_index: 1, item: changed }] : []),
      responseTerminal(change === 'duplicate-item-id' ? [advertised, changed] : [changed])
    ] });
    const { outcome, events } = await collect(turn('read only', 'gpt-5.6-sol:high'));
    assert.equal(outcome.stopReason, 'error');
    assert.equal(events.find(event => event.type === 'tool_use_start').name, 'get_thing');
    assert.equal(events.filter(event => event.type === 'tool_use').length, 0);
    assert.equal(toolCalls.length, 0);
    assert.equal(responsesRequests.length, 1);
  });
}

test('GPT-5.6 Sol rejects a later-hop call ID replay while preserving its first receipt', async () => {
  const first = responseFunction('saved_once', 'create_page', '{"name":"Once"}');
  const replay = { ...first, id: 'another_provider_item' };
  responsesPlans.push(
    { events: [...responseCallEvents(first), responseTerminal([first])] },
    { events: [...responseCallEvents(replay), responseTerminal([replay])] }
  );
  const { outcome, events } = await collect(turn('build once', 'gpt-5.6-sol:high'));
  assert.equal(outcome.stopReason, 'error');
  assert.equal(toolCalls.length, 1);
  assert.equal(outcome.toolCalls.length, 1);
  assert.equal(outcome.toolCalls[0].ok, true);
  assert.equal(events.filter(event => event.type === 'tool_result' && event.ok).length, 1);
  assert.equal(responsesRequests.length, 2);
});
