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

test('admin preview dispatch publishes its protected-controller contract version', () => {
	const manifest = createApiCapabilitiesManifest();
	assert.equal(manifest.features['api.admin-ci-previews'], '2.0.0');
});

test('storage-aware health and the corrected email environment gate publish their contract updates', () => {
	const manifest = createApiCapabilitiesManifest();
	assert.equal(manifest.features['api.health-nitro'], '1.1.0');
	assert.equal(manifest.features['api.email-config'], '1.0.1');
});

test('subspace lifecycle + notification type additions publish their contract versions', () => {
	const manifest = createApiCapabilitiesManifest();
	// S1 review fixes: guarded transfer writes (409 on a race — patch), and a
	// delete that keeps private/removed posts author-only, holds the slug and
	// answers { privatePosts } (additive → minor)
	assert.equal(manifest.features['api.subspaces-transfer'], '1.0.1');
	assert.equal(manifest.features['api.subspaces-delete'], '1.1.0');
	assert.equal(manifest.features['api.notifications-list'], '1.1.0');
	assert.equal(manifest.features['api.notifications-settings'], '1.1.0');
});

test('subspace join requests + posting-approval requests publish their contract versions', () => {
	const manifest = createApiCapabilitiesManifest();
	// S2: private join → pending request (join), leave cancels it, list/detail
	// carry viewer.pending/approvalRequested (+ mods' queue counts), members
	// grew pending=1 / approvalRequests=1 + accept / deny / request-approval
	assert.equal(manifest.features['api.subspaces-join'], '1.1.0');
	assert.equal(manifest.features['api.subspaces-leave'], '1.1.0');
	assert.equal(manifest.features['api.subspaces'], '1.1.0');
	assert.equal(manifest.features['api.subspaces-get'], '1.1.0');
	assert.equal(manifest.features['api.subspaces-members'], '1.2.0');
});
