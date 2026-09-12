import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, beforeEach, mock, test } from 'node:test';

// generateAiCompletion's `timeoutMs` is the only thing that can bound a
// provider call that has ALREADY started. Its caller (connections feed filters)
// checks a deadline before reserving each call, but that check is powerless
// once `for await` is waiting on the stream: the provider SDKs fall back to
// their own 10-minute default, and the feed classifies INLINE in the
// /api/v1/connections/feed response. So a single stalled stream would hold that
// response open far past the 20s the filter budget claims to bound it to.
//
// These tests run against a real local HTTP server standing in for both
// providers (the musing.streaming.test.mts precedent) so the stall is a genuine
// open socket rather than a stubbed promise. That file pins Date.now to a
// constant for its own determinism, which a wall-clock deadline cannot use —
// hence a separate file on real time, with deliberately short budgets.

type Plan = { text?: string } | 'hang';

const anthropicPlans: Plan[] = [];
const openAiPlans: Plan[] = [];
const anthropicRequests: unknown[] = [];
const openAiRequests: unknown[] = [];
// Stalled responses hold their socket open by design; tracking them is what
// lets server.close() finish instead of hanging the test process at teardown.
const stalled: ServerResponse[] = [];

const sendAnthropic = (response: ServerResponse, plan: Plan) => {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type: string, data: Record<string, unknown>) =>
    response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  event('message_start', {
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
  });
  if (plan === 'hang') {
    // headers and an opening event, then silence — the shape of a provider that
    // accepted the request and never finished answering
    stalled.push(response);
    return;
  }
  if (plan.text) {
    event('content_block_start', { index: 0, content_block: { type: 'text', text: '', citations: null } });
    event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: plan.text } });
    event('content_block_stop', { index: 0 });
  }
  event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
  event('message_stop', {});
  response.end();
};

const sendOpenAi = (response: ServerResponse, plan: Plan, model: string) => {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = (delta: Record<string, string>, finishReason: string | null) =>
    `data: ${JSON.stringify({
      id: 'chatcmpl_test',
      object: 'chat.completion.chunk',
      created: 1,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }]
    })}\n\n`;
  if (plan === 'hang') {
    stalled.push(response);
    return;
  }
  if (plan.text) response.write(chunk({ content: plan.text }, null));
  response.write(chunk({}, 'stop'));
  response.write('data: [DONE]\n\n');
  response.end();
};

const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;

  if (pathname.endsWith('/messages')) {
    anthropicRequests.push(body);
    const plan = anthropicPlans.shift();
    if (!plan) {
      response.writeHead(500).end('unexpected Anthropic request');
      return;
    }
    sendAnthropic(response, plan);
    return;
  }
  if (pathname.endsWith('/chat/completions')) {
    openAiRequests.push(body);
    const plan = openAiPlans.shift();
    if (!plan) {
      response.writeHead(500).end('unexpected OpenAI request');
      return;
    }
    sendOpenAi(response, plan, body.model || 'openai-test');
    return;
  }
  response.writeHead(404).end('unexpected test route');
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const envNames = ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'LOPU_PROVIDER'];
const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));

mock.module(new URL('../settings/prConflictResolverModelWaterfall.ts', import.meta.url).href, {
  exports: { getAiPreferredModelWaterfall: async () => ['default'] }
});

const { generateAiCompletion } = await import('./musing.ts');

beforeEach(() => {
  anthropicPlans.length = 0;
  openAiPlans.length = 0;
  anthropicRequests.length = 0;
  openAiRequests.length = 0;
  process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
  process.env.ANTHROPIC_BASE_URL = origin;
  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.OPENAI_BASE_URL = `${origin}/v1`;
  delete process.env.LOPU_PROVIDER;
});

after(async () => {
  for (const response of stalled) response.destroy();
  stalled.length = 0;
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

const ask = (timeoutMs?: number) =>
  generateAiCompletion({ system: 'classify', user: 'posts', maxTokens: 3000, ...(timeoutMs === undefined ? {} : { timeoutMs }) });

test('a stream that stalls mid-answer is abandoned at the deadline', async () => {
  anthropicPlans.push('hang');

  const startedAt = Date.now();
  const result = await ask(400);
  const elapsed = Date.now() - startedAt;

  assert.equal(result, null, 'an overrun call degrades to null so the caller takes its non-AI fallback');
  // The point of the bound: without it this resolves on the SDK's 10-minute
  // default, not in under a second.
  assert.ok(elapsed < 5000, `expected the deadline to release the call, waited ${elapsed}ms`);
});

test('the deadline is shared by the whole waterfall, not restarted per provider', async () => {
  anthropicPlans.push('hang');
  openAiPlans.push({ text: 'second provider' });

  const startedAt = Date.now();
  const result = await ask(400);
  const elapsed = Date.now() - startedAt;

  assert.equal(result, null);
  assert.equal(anthropicRequests.length, 1);
  assert.equal(
    openAiRequests.length,
    0,
    'falling through to OpenAI after the budget is gone would let a two-provider waterfall serve double its own bound'
  );
  assert.ok(elapsed < 5000, `expected one deadline for the whole call, waited ${elapsed}ms`);
});

test('a provider that answers within the deadline is unaffected', async () => {
  anthropicPlans.push({ text: '[{"id":"ext-post-1","matched":true,"reason":"test"}]' });

  const result = await ask(10_000);

  assert.deepEqual(result, { text: '[{"id":"ext-post-1","matched":true,"reason":"test"}]', source: 'claude' });
  assert.equal(openAiRequests.length, 0, 'a successful first provider still short-circuits the waterfall');
});

test('an ordinary provider failure still falls through to the next provider', async () => {
  // no Anthropic plan queued → the stand-in answers 500, which is a THROWN
  // provider error rather than a deadline overrun; the waterfall must still
  // hand over, or the timeout would have turned a retryable failure terminal
  openAiPlans.push({ text: 'openai answered' });

  const result = await ask(10_000);

  assert.deepEqual(result, { text: 'openai answered', source: 'openai' });
  assert.ok(openAiRequests.length >= 1);
});

test('omitting timeoutMs preserves drain-to-completion', async () => {
  anthropicPlans.push({ text: 'unbounded still works' });

  const result = await ask();

  assert.deepEqual(result, { text: 'unbounded still works', source: 'claude' });
});
