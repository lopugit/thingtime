import assert from 'node:assert/strict';
import test from 'node:test';

import { apiEndpointDocs, apiV1DocsRouteKeys, apiV1RouteKeys } from '../../../docs/apiDocs';
import { capabilitySatisfies } from './capabilityContract';
import { THINGTIME_CAPABILITY_MANIFEST_PATH, thingtimeCapabilityManifest } from './thingtimeCapabilities';

test('Thingtime capability manifest is origin scoped and covers the generated API route map', () => {
  const manifest = thingtimeCapabilityManifest('https://preview.example.test/path');
  assert.equal(manifest.origin, 'https://preview.example.test');
  assert.equal(manifest.schemaVersion, 1);
	assert.equal(manifest.features['api.admin-ci-dispatch']?.version, '2.1.0');
  assert.equal(manifest.features['api.admin-ci-control']?.version, '1.0.2');
  assert.equal(manifest.features['api.admin-ci-credentials']?.version, '2.0.0');
  assert.equal(manifest.features['api.admin-ci-feature-stacks']?.version, '1.3.0');
  assert.equal(manifest.features['api.admin-ci-previews']?.version, '1.2.0');
  assert.equal(manifest.features['api.auth-passkeys-register-options']?.version, '1.0.1');
  assert.equal(manifest.features['api.auth-passkeys-login-options']?.version, '1.0.1');
  assert.equal(manifest.features['api.email-config']?.version, '1.0.1');
  assert.equal(manifest.features['api.health-nitro']?.version, '1.1.0');
  assert.equal(manifest.features['api.integration-ci-credentials']?.version, '1.1.0');
  assert.equal(manifest.features['api.integration-ci-progress']?.version, '1.0.0');
  assert.equal(manifest.features['api.things-search']?.version, '1.1.1');
  for (const feature of [
    'api.things',
    'api.things-comment',
    'api.things-feed',
    'api.things-share',
    'api.things-user'
  ]) {
    assert.equal(manifest.features[feature]?.version, '1.1.0', feature);
  }
  assert.equal(manifest.features['api.things-update']?.version, '1.2.0');
  assert.ok(manifest.operations.some((operation) => operation.path === THINGTIME_CAPABILITY_MANIFEST_PATH));
  const operationPaths = new Set(manifest.operations.map((operation) => operation.path));
  for (const route of apiV1RouteKeys) assert.equal(operationPaths.has(`/api/${route}`), true, route);
  for (const route of apiV1DocsRouteKeys) assert.equal(operationPaths.has(`/api/${route}`), true, route);
  for (const doc of apiEndpointDocs) {
    assert.ok(manifest.features[`api.${doc.id}`], doc.id);
		assert.ok(
			manifest.operations.some((operation) => operation.feature === `api.${doc.id}` && operation.path === doc.endpoint),
			doc.endpoint
		);
  }
});

test('capability negotiation accepts compatible updates and rejects missing or breaking versions', () => {
  assert.equal(capabilitySatisfies('1.1.0', '1.1.0'), true);
  assert.equal(capabilitySatisfies('1.4.2', '1.1.0'), true);
  assert.equal(capabilitySatisfies('1.0.9', '1.1.0'), false);
  assert.equal(capabilitySatisfies('2.0.0', '1.1.0'), false);
  assert.equal(capabilitySatisfies('', '1.1.0'), false);
});
