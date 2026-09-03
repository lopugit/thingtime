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
type AnthropicPlan = { blocks?: AnthropicBlock[]; stopReason?: 'end_turn' | 'tool_use' | 'max_tokens'; status?: number };
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
const envNames = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'LOPU_CHAT_PROVIDER', 'LOPU_OPENAI_TOOLS', 'LOPU_CLAUDE_MODEL', 'LOPU_OPENAI_MODEL'];
const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));

mock.module(new URL('../settings/prConflictResolverModelWaterfall.ts', import.meta.url).href, {
  exports: {
    getAiPreferredModelWaterfall: async () => {
      waterfallReads += 1;
      return [...waterfall];
    }
  }
});

const { streamLopuChatTurn, LOPU_CHAT_MAX_TOOL_EXECUTIONS, createTtToolTextParser, unwrapEnvelopeContent, wrapBareToolCalls } = await import('./chat.ts');
const { parseAiWorkflowModelOptionId } = await import('../settings/prConflictResolverModelWaterfallCore.ts');

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
  if (call.name === 'delete_thing') return { ok: false, error: 'Refused: deleting needs confirmation' };
  return { ok: true, summary: `${call.name} ok`, data: { echo: call.input } };
};

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
    deps: { runTool: fakeRunTool as any, fallbackPaceMs: 0, testPaceMs: 0 },
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
  toolCalls = [];
  waterfallReads = 0;
  waterfall = ['claude-opus-5:high', 'gpt-5.6-sol:high', 'default'];
  process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
  process.env.ANTHROPIC_BASE_URL = origin;
  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.OPENAI_BASE_URL = `${origin}/v1`;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.LOPU_CHAT_PROVIDER;
  delete process.env.LOPU_OPENAI_TOOLS;
  process.env.LOPU_CLAUDE_MODEL = 'claude-provider-default';
  process.env.LOPU_OPENAI_MODEL = 'openai-provider-default';
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

test('Claude fast mode rides the beta surface and a starved decorated attempt retries bare on the same model', async () => {
  anthropicPlans.push({ blocks: [], stopReason: 'end_turn' }, { blocks: [{ type: 'text', text: 'Bare and quick' }], stopReason: 'end_turn' });

  const { events, outcome } = await collect(turn('hi', 'claude-opus-5:max:fast'));

  assert.equal(meta(events).provider, 'claude');
  assert.equal(text(events), 'Bare and quick');
  assert.equal(outcome.speed, 'fast');
  assert.equal(anthropicRequests.length, 2);
  assert.equal(anthropicRequests[0].surface, 'beta');
  assert.equal(anthropicRequests[0].body.speed, 'fast');
  assert.deepEqual(anthropicRequests[0].body.output_config, { effort: 'max' });
  assert.match(String(anthropicRequests[0].headers['anthropic-beta']), /fast-mode-2026-02-01/);
  assert.equal(anthropicRequests[1].surface, 'stable');
  assert.equal(anthropicRequests[1].body.speed, undefined);
  assert.equal(anthropicRequests[1].body.output_config, undefined);
  assert.equal(anthropicRequests[1].body.model, 'claude-opus-5');
});

test('a provider failing before any output falls through to the other configured provider on its waterfall choice', async () => {
  anthropicPlans.push({ status: 400 });
  openAiPlans.push({ contentChunks: ['OpenAI ', 'stepped in'], finish: 'stop' });

  const { events, outcome } = await collect(turn('hi', 'claude-opus-5:high'));

  assert.equal(meta(events).provider, 'openai');
  assert.equal(meta(events).model, 'gpt-5.6-sol');
  assert.equal(meta(events).effort, 'high');
  assert.equal(text(events), 'OpenAI stepped in');
  assert.equal(outcome.provider, 'openai');
  assert.equal(openAiRequests[0].body.reasoning_effort, 'high');
  assert.equal(waterfallReads, 1);
});

test('OpenAI native tools: per-index argument accumulation, tool messages, and the request shape', async () => {
  const patchInput = { target: 'active', ops: [{ op: 'update', id: 'title', patch: { text: 'Hello!' } }] };
  const patchJson = JSON.stringify(patchInput);
  openAiPlans.push(
    { contentChunks: ['Let me '], toolCalls: [{ id: 'call_1', name: 'patch_page', argumentChunks: [patchJson.slice(0, 9), patchJson.slice(9, 30), patchJson.slice(30)] }], finish: 'tool_calls' },
    { contentChunks: ['Patched!'], finish: 'stop' }
  );

  const { events, outcome } = await collect(turn('change the title', 'gpt-5.6-sol:xhigh:fast'));

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
  assert.equal(first.model, 'gpt-5.6-sol');
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

  const { events, outcome } = await collect(turn('make me a page', 'gpt-5.6-sol'));

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

  const { events, outcome } = await collect(turn('make me a page', 'gpt-5.6-sol'));

  assert.equal(meta(events).provider, 'openai');
  assert.equal(events.find((event) => event.type === 'tool_use')?.name, 'create_page');
  assert.deepEqual(toolCalls.map((call) => call.name), ['create_page']);
  assert.equal(text(events), 'All done 🦄');
  assert.equal(outcome.stopReason, 'end_turn');
  assert.equal(openAiRequests.length, 3);
  assert.equal(openAiRequests[2].body.stream, false);
});

test('the tool budget refuses the overflow, emits an error, and forces a final text hop with tool_choice none', async () => {
  const many: AnthropicBlock[] = Array.from({ length: LOPU_CHAT_MAX_TOOL_EXECUTIONS + 1 }, (_, index) => ({
    type: 'tool_use',
    id: `toolu_${index}`,
    name: 'navigate',
    inputChunks: [JSON.stringify({ path: `/p/${index}` })]
  }));
  anthropicPlans.push({ blocks: many, stopReason: 'tool_use' }, { blocks: [{ type: 'text', text: 'Wrapping up.' }], stopReason: 'end_turn' });

  const { events, outcome } = await collect(turn('go everywhere', 'claude-opus-5'));

  const results = events.filter((event) => event.type === 'tool_result');
  assert.equal(results.length, LOPU_CHAT_MAX_TOOL_EXECUTIONS + 1);
  assert.equal(results.slice(0, LOPU_CHAT_MAX_TOOL_EXECUTIONS).every((event) => event.ok), true);
  assert.equal(results.at(-1).ok, false);
  assert.match(results.at(-1).summary, /at most 24 tools/);
  assert.equal(toolCalls.length, LOPU_CHAT_MAX_TOOL_EXECUTIONS);
  const error = events.find((event) => event.type === 'error');
  assert.match(error.message, /24-tool limit/);
  assert.equal(outcome.stopReason, 'tool_limit');
  assert.equal(text(events), 'Wrapping up.');
  assert.deepEqual(anthropicRequests[1].body.tool_choice, { type: 'none' });
  const toolResults = anthropicRequests[1].body.messages.at(-1).content;
  assert.equal(toolResults.length, LOPU_CHAT_MAX_TOOL_EXECUTIONS + 1);
  assert.equal(toolResults.at(-1).is_error, true);
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
  delete process.env.ANTHROPIC_API_KEY;
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
  // the waterfall's decorated gpt-5.6-sol:high, so it gets its bare retry and
  // then the plain (non-streaming) completion rung before it is given up on
  anthropicPlans.push({ status: 400 });
  openAiPlans.push({ status: 400 }, { status: 400 }, { status: 400 });

  const { events, outcome } = await collect(turn('hello?', 'claude-opus-5'));

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
  const { events, outcome } = await collect(turn('make me a page', 'gpt-5.6-sol:high'));

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
