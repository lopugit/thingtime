import assert from 'node:assert/strict';
import test from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { createAnthropicApiKeyClient, sanitizeAnthropicApiKeyError } from './anthropicApiKey';
import { callVaultProviderCompletion, resolveVaultProviderClientConfig } from '../lopu/vaultProviderClient';
import { AiTransportFailure, canFallbackAiProvider } from './providerWaterfall';
import { friendlyVaultProviderError } from '../lopu/vaultProviders';
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

const sdkFailure = (status: number, type: string, message: string, details?: object) =>
 Anthropic.APIError.generate(status, { type: 'error', error: { type, message, details }, request_id: 'private-request-id' }, 'private-formatted-message', new Headers({ 'request-id': 'private-header-id' }));

test('Console classifies known structured failures into fixed diagnostics without changing status or fallback policy', () => {
 const cases = [
  [400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.', undefined, 'billing'],
  [402, 'billing_error', 'private-billing-body', undefined, 'billing'],
  [400, 'invalid_request_error', 'You have reached your specified workspace API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.', undefined, 'spend_limit'],
  [429, 'rate_limit_error', 'private-spend-body', { error_code: 'enforced_spend_limit_reached' }, 'spend_limit'],
  [404, 'not_found_error', 'model: claude-haiku-4-5', undefined, 'model_access'],
  [403, 'permission_error', 'Your organization does not have access to model claude-haiku-4-5.', undefined, 'model_access'],
  [400, 'invalid_request_error', 'adaptive thinking is not supported on this model', undefined, 'unsupported_parameter'],
  [400, 'invalid_request_error', 'output_config.effort: Extra inputs are not permitted', undefined, 'unsupported_parameter']
 ] as const;
 for (const [status, type, message, details, reason] of cases) {
  const error = sanitizeAnthropicApiKeyError(sdkFailure(status, type, message, details));
  assert.ok(error instanceof AiTransportFailure); assert.equal(error.status, status); assert.equal(error.reason, reason);
  assert.equal(canFallbackAiProvider(error), canFallbackAiProvider(new AiTransportFailure(status)));
  const userMessage = friendlyVaultProviderError('Console', 'claude-haiku-4-5', error);
  assert.match(userMessage, new RegExp(`HTTP ${status}`));
  assert.doesNotMatch(JSON.stringify({ error, userMessage, stack: error.stack }), /private-|2026-12-01|Your organization|adaptive thinking/);
  assert.match(userMessage, /billing or credit|spending limit|model is unavailable|unsupported request parameter/);
 }
});

test('Console diagnostic matching rejects prefixes, suffixes, echoed requests and incompatible status/type pairs', () => {
 const known = 'adaptive thinking is not supported on this model';
 for (const [status, type, message] of [
  [400, 'invalid_request_error', `private-request: ${known}`],
  [400, 'invalid_request_error', `${known} private-secret`],
  [400, 'invalid_request_error', 'You have reached your specified API usage limits but this is a quoted request.'],
  [400, 'invalid_request_error', 'model: claude-haiku-4-5'],
  [401, 'authentication_error', known],
  [400, 'permission_error', known],
  [403, 'permission_error', 'This request mentions model access and credit balance.'],
  [500, 'api_error', known]
 ] as const) {
  const error = sanitizeAnthropicApiKeyError(sdkFailure(status, type, message));
  assert.ok(error instanceof AiTransportFailure); assert.equal(error.status, status); assert.equal(error.reason, undefined);
  assert.equal(error.message, new AiTransportFailure(status).message);
  assert.doesNotMatch(JSON.stringify({ error, stack: error.stack }), /private-|quoted request|adaptive thinking/);
 }
 const forged = sanitizeAnthropicApiKeyError({ status: 400, error: { type: 'error', error: { type: 'invalid_request_error', message: known } }, message: known });
 assert.ok(forged instanceof AiTransportFailure); assert.equal(forged.reason, undefined);
});
