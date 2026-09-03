import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LOPU_PROVIDER_TEMPLATES,
	isBlockedLopuProviderHostname,
	normalizeLopuProviderEndpoint,
	normalizeLopuProviderKind,
	providerModelFor
} from './userVaultCore';

test('provider catalog includes the major hosted AI providers without credentials', () => {
	assert.deepEqual(LOPU_PROVIDER_TEMPLATES.map((item) => item.id), ['openai', 'anthropic', 'google', 'xai', 'openrouter', 'mistral', 'deepseek', 'groq', 'cohere']);
	assert.equal(JSON.stringify(LOPU_PROVIDER_TEMPLATES).toLowerCase().includes('api key'), true);
	assert.equal(LOPU_PROVIDER_TEMPLATES.every((item) => item.models.length > 0), true);
	assert.equal(Object.prototype.hasOwnProperty.call(LOPU_PROVIDER_TEMPLATES[0], 'model'), false);
	assert.equal(providerModelFor('xai', 'grok-voice-latest')?.audioInput, 'realtime');
});

test('provider endpoints are https-only and reject local network targets', () => {
	assert.equal(normalizeLopuProviderEndpoint('https://api.openai.com/v1/'), 'https://api.openai.com/v1');
	assert.equal(normalizeLopuProviderEndpoint('http://api.openai.com/v1'), null);
	assert.equal(normalizeLopuProviderEndpoint('https://localhost:3000/v1'), null);
	assert.equal(normalizeLopuProviderEndpoint('https://127.0.0.1/v1'), null);
	assert.equal(normalizeLopuProviderEndpoint('https://[::ffff:127.0.0.1]/v1'), null);
	assert.equal(normalizeLopuProviderEndpoint('https://[fe80::1]/v1'), null);
	assert.equal(normalizeLopuProviderEndpoint('https://user:pass@example.com/v1'), null);
	assert.equal(isBlockedLopuProviderHostname('10.0.0.1'), true);
	assert.equal(isBlockedLopuProviderHostname('api.anthropic.com'), false);
});

test('only supported provider adapters are accepted', () => {
	assert.equal(normalizeLopuProviderKind('anthropic'), 'anthropic');
	assert.equal(normalizeLopuProviderKind('compatible'), 'compatible');
	assert.equal(normalizeLopuProviderKind('shell'), null);
});
