import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnthropicApiKeyClient, sanitizeAnthropicApiKeyError } from './anthropicApiKey';
import { callVaultProviderCompletion, resolveVaultProviderClientConfig } from '../lopu/vaultProviderClient';
import { AiTransportFailure } from './providerWaterfall';
const record = { id: 'console-connection', name: 'Console', provider: 'anthropic-api-key' as const,
 endpoint: 'https://api.anthropic.com', model: 'claude-synthetic', token: 'synthetic-console-key' };
const passEndpoint = async (endpoint: string) => ({ endpoint, rewritten: false });
const message = { id: 'msg_synthetic', type: 'message', role: 'assistant', model: record.model,
 content: [{ type: 'text', text: 'Console response' }], stop_reason: 'end_turn', stop_sequence: null,
 usage: { input_tokens: 3, output_tokens: 4, cache_read_input_tokens: 2 } };
test('Console factory cannot inherit a key or accept a setup token', () => {
 for (const apiKey of [undefined, '', 'sk-ant-oat-synthetic', ' key', 'key\nvalue']) assert.throws(() => createAnthropicApiKeyClient({ apiKey }), /Console API key/);
});
test('Console Messages preserves exact authentication, history, model and usage and refuses redirects', async () => {
 let calls = 0;
 const result = await callVaultProviderCompletion(record, { system: 'System', history: [{ role: 'assistant', content: 'Previous' }], prompt: 'Hello',
  assertEndpoint: passEndpoint, fetchImpl: async (url, init) => {
   calls++; assert.equal(String(url), 'https://api.anthropic.com/v1/messages');
   const headers = new Headers(init?.headers); assert.equal(headers.get('x-api-key'), record.token);
   assert.equal(headers.get('authorization'), null); assert.ok(headers.get('anthropic-version')); assert.equal(init?.redirect, 'error');
   const body = JSON.parse(String(init?.body)); assert.equal(body.system, 'System'); assert.equal(body.messages.length, 2); assert.equal(body.model, record.model);
   return Response.json(message);
  } });
 assert.equal(calls, 1); assert.deepEqual(result, { text: 'Console response', model: record.model, usage: { inputTokens: 3, outputTokens: 4, cacheReadTokens: 2 } });
});
test('Console failures expose status only without retrying or leaking SDK bodies', async () => {
 let calls = 0;
 await assert.rejects(callVaultProviderCompletion(record, { system: '', history: [], prompt: 'Hello', assertEndpoint: passEndpoint,
  fetchImpl: async () => { calls++; return Response.json({ error: { type: 'authentication_error', message: record.token } }, { status: 401 }); } }),
  error => error instanceof AiTransportFailure && error.status === 401 && !error.message.includes(record.token));
 assert.equal(calls, 1);
});
test('Console keeps endpoint guards and rejects setup tokens before dialing', async () => {
 await assert.rejects(resolveVaultProviderClientConfig({ ...record, endpoint: 'https://127.0.0.1' }), /not enabled/);
 let dialed = false;
 await assert.rejects(callVaultProviderCompletion({ ...record, token: 'sk-ant-oat-synthetic' }, {
  system: '', history: [], prompt: 'Hello', assertEndpoint: async () => { dialed = true; return passEndpoint(record.endpoint); }
 }), /Console API key/); assert.equal(dialed, false);
});

test('Console streaming error status must be a finite HTTP integer; upstream text is never exposed', () => {
 for (const status of ['400', NaN, Infinity, 400.5, 0, -1, 999]) {
  const error = sanitizeAnthropicApiKeyError({ status, message: 'private-body' });
  assert.ok(error instanceof AiTransportFailure);assert.equal(error.status, undefined);assert.doesNotMatch(error.message, /private-body/);
 }
 assert.equal((sanitizeAnthropicApiKeyError({ status: 400, message: 'private-body' }) as AiTransportFailure).status, 400);
});
