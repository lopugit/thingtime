import assert from 'node:assert/strict';
import test from 'node:test';
import { supportsRecordingAutomation } from './recordingsCapabilities';
import { apiEndpointDocs, createApiCapabilitiesManifest } from '~/docs/apiDocs';
import { thingtimeCapabilityManifest } from '~/api/utils/capabilities/thingtimeCapabilities';

const origin = 'https://thingtime.test';
test('recording clients negotiate only with their selected origin and compatible versions', () => {
	for (const version of ['1.0.0', '1.0.1', '1.2.0']) {
		assert.equal(supportsRecordingAutomation({ origin, features: { 'api.lopu-recordings': { version } } }, origin), true);
	}
	for (const version of ['0.9.0', '2.0.0', '1.0.0-preview', '', null]) {
		assert.equal(supportsRecordingAutomation({ origin, features: { 'api.lopu-recordings': { version } } }, origin), false);
	}
	assert.equal(supportsRecordingAutomation({ origin, features: {} }, origin), false);
	assert.equal(supportsRecordingAutomation({ origin, features: { 'api.lopu-recordings': '1.0.0' } }, 'https://another.test'), false);
});

test('both registered recording endpoints are explicitly versioned in both manifests', () => {
	const manifest = thingtimeCapabilityManifest(origin);
	assert.equal(supportsRecordingAutomation(manifest, origin), true);
	for (const id of ['lopu-recordings', 'lopu-recordings-run']) {
		const doc = apiEndpointDocs.find((entry) => entry.id === id);
		assert.equal(doc?.contractVersion, '1.0.0');
		assert.equal(doc?.featureVersion, '1.0.0');
		assert.equal(createApiCapabilitiesManifest().features[`api.${id}`], '1.0.0');
		assert.equal(manifest.features[`api.${id}`].version, '1.0.0');
		assert.ok(manifest.operations.some((entry) => entry.feature === `api.${id}` && entry.methods.includes('POST') && entry.methods.includes('GET')));
	}
});
