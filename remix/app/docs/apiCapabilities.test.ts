import assert from 'node:assert/strict';
import test from 'node:test';

import { apiEndpointDocs, apiRouteCapabilityId, createApiCapabilitiesManifest } from './apiDocs';
import { routeModules } from '../../server/routes/api/[...]';
import { thingtimeCapabilityManifest } from '../api/utils/capabilities/thingtimeCapabilities';

test('capabilities advertise every documented semantic contract', () => {
	const manifest = createApiCapabilitiesManifest();

	for (const doc of apiEndpointDocs) {
		assert.equal(manifest.features[`api.${doc.id}`], doc.contractVersion, doc.endpoint);
	}
});

test('both capability manifests advertise the bounded upload v2 contract', () => {
	assert.equal(createApiCapabilitiesManifest().features['api.network-probe-upload'], '2.0.0');
	const manifest = thingtimeCapabilityManifest('https://thingtime.test');
	assert.equal(manifest.features['api.network-probe-upload'].version, '2.0.0');
	assert.ok(manifest.operations.some((operation) => operation.feature === 'api.network-probe-upload' && operation.path === '/api/v1/network-probe/upload' && operation.methods.includes('POST')));
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

test('notification contracts publish the history filters and the system family as compatible minors', () => {
	const manifest = createApiCapabilitiesManifest();

	assert.equal(manifest.features['api.notifications-list'], '1.2.0');
	assert.equal(manifest.features['api.notifications-settings'], '1.2.0');
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

test('persistent attachment content and resized previews advertise their additive contract', () => {
	assert.equal(createApiCapabilitiesManifest().features['api.attachment-content'], '1.1.0');
});
