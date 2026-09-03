import assert from 'node:assert/strict';
import test from 'node:test';

import { apiEndpointDocs, apiRouteCapabilityId, createApiCapabilitiesManifest } from './apiDocs';
import { routeModules } from '../../server/routes/api/[...]';

test('capabilities advertise every documented semantic contract', () => {
	const manifest = createApiCapabilitiesManifest();

	for (const doc of apiEndpointDocs) {
		assert.equal(manifest.features[`api.${doc.id}`], doc.contractVersion, doc.endpoint);
	}
});

test('capabilities advertise every executable API route, including undocumented routes', () => {
	const routeKeys = [...Object.keys(routeModules), 'v1/capabilities'];
	const manifest = createApiCapabilitiesManifest(routeKeys);

	for (const routeKey of routeKeys) {
		assert.match(manifest.features[apiRouteCapabilityId(routeKey)] || '', /^\d+\.\d+\.\d+$/, routeKey);
	}
});

test('account-hint privacy contracts publish their patch-level capability updates', () => {
	const manifest = createApiCapabilitiesManifest();

	assert.equal(manifest.features['api.auth-account-hints'], '1.0.1');
	assert.equal(manifest.features['api.auth-account-hints-resolve'], '1.0.1');
});

test('capabilities publish the non-secret data authority used by a bundle', () => {
	const manifest = createApiCapabilitiesManifest([], {
		schemaVersion: 1,
		id: 'development',
		kind: 'development',
		federationId: 'development',
		authorityOrigin: 'https://dev.thingtime.com'
	});
	assert.equal(manifest.features['api.capabilities'], '1.1.0');
	assert.deepEqual(manifest.dataEnvironment, {
		schemaVersion: 1,
		id: 'development',
		kind: 'development',
		federationId: 'development',
		authorityOrigin: 'https://dev.thingtime.com'
	});
});

test('the storage census and ciControl workbench allowlist publish their minor capability updates', () => {
	const manifest = createApiCapabilitiesManifest();
	assert.equal(manifest.features['api.admin-migrations'], '1.1.0');
	assert.equal(manifest.features['api.mongodb-raw-results'], '1.1.0');
});

test('the Lopu family publishes its minor capability updates (own providers, verified keys)', () => {
	const manifest = createApiCapabilitiesManifest();
	assert.equal(manifest.features['api.ai-models'], '1.2.0');
	assert.equal(manifest.features['api.admin-ai-models'], '1.1.0');
	assert.equal(manifest.features['api.settings-lopu-chat-defaults'], '1.1.0');
	// 1.1.1 / 1.0.1: the chat write buckets fail closed on a limiter outage
	assert.equal(manifest.features['api.lopu-chats'], '1.1.1');
	assert.equal(manifest.features['api.lopu-chats-update'], '1.1.1');
	assert.equal(manifest.features['api.lopu-chats-delete'], '1.0.1');
	// 1.2.0: server-verified confirmations (confirmations[] in, confirm event +
	// tool_result.needsConfirmation out) and the JSON-only fence (415)
	assert.equal(manifest.features['api.lopu-chats-reply'], '1.2.0');
	// 1.0.1: JSON-only fence (415) + full accounts only (403 for a guest session)
	assert.equal(manifest.features['api.lopu-vault'], '1.0.1');
	assert.equal(manifest.features['api.lopu-voice-reply'], '1.0.1');
});
