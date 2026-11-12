import assert from 'node:assert/strict';
import test from 'node:test';
import { lopuCredentialPatch, lopuCredentialView } from './lopuCredentialChoice';
import { lopuCredentialBlocks } from './lopuCredentialBlocks';
import type { AiModelPublic, LopuVaultProvider } from './lopuProviderCore';
const models: AiModelPublic[] = [
	{
		id: 'credit-model',
		label: 'Credit model',
		provider: 'openai',
		family: 'test',
		enabled: true,
		available: true,
		isDefault: true,
		efforts: ['high'],
		speeds: ['normal']
	}
];
const providers: LopuVaultProvider[] = [
	{
		id: 'chatgpt-plan-one',
		name: 'My ChatGPT',
		kind: 'compatible',
		model: 'plan-model',
		endpointHost: 'chatgpt.com',
		available: true,
		reason: null,
		realtimeModels: []
	}
];
const value = { model: 'credit-model', effort: 'high', speed: 'normal', providerId: null };
test('credential choices validate availability, keep endpoint and plan model connection-bound, and label billing', () => {
	const own = { ...value, providerId: providers[0].id };
	const view = lopuCredentialView(own, models, providers, 'chat');
	assert.equal(view.endpoint, 'chatgpt.com');
	assert.equal(view.providerModel, 'plan-model');
	assert.match(view.billing, /No automatic fallback/);
	assert.equal(view.hasEfforts, false);
	assert.equal(lopuCredentialPatch('ai.model', 'credit-model', models, providers, own), null);
	assert.deepEqual(lopuCredentialPatch('ai.credential', 'credits', models, providers, own), { providerId: null });
	assert.equal(lopuCredentialPatch('ai.credential', 'unknown', models, providers, value), null);
	assert.equal(lopuCredentialPatch('ai.credential', providers[0].id, models, [{ ...providers[0], available: false }], value), null);
	assert.deepEqual(lopuCredentialPatch('ai.model', 'credit-model', models, providers, value), { model: 'credit-model', effort: null, speed: null });
	assert.equal(lopuCredentialPatch('ai.effort', 'impossible', models, providers, value), null);
	const missing = lopuCredentialView(own, models, [], 'defaults');
	assert.equal(missing.credential, own.providerId);
	assert.equal(missing.credentials[0].disabled, true);
	assert.match(missing.problem, /not available/);
	assert.equal(missing.usesCredits, false);
});
test('every settings control and repeated option is an individually editable ordinary block', () => {
	const walk = (rows: any[]): any[] => rows.flatMap((row) => [row, ...walk(row.children || [])]);
	const blocks = walk(lopuCredentialBlocks);
	assert.ok(blocks.every((row) => ['element', 'condition', 'collection'].includes(row.type)));
	assert.equal(new Set(blocks.map((row) => row.id)).size, blocks.length);
	for (const name of ['credential', 'model', 'effort', 'speed']) {
		assert.ok(blocks.some((row) => row.id === `ai-${name}-label` && row.tag === 'span'));
		assert.ok(blocks.some((row) => row.id === `ai-${name}-select` && row.tag === 'select'));
	}
	assert.ok(blocks.filter((row) => row.type === 'collection').every((row) => row.props.size === 'all' && row.children[0].tag === 'option'));
	assert.ok(!JSON.stringify(lopuCredentialBlocks).includes('chatgpt-plan-one'));
});
