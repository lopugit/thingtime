import assert from 'node:assert/strict';
import test from 'node:test';
import { supportsRecordingAutomation, supportsPersonalRecordingSettings } from './recordingsCapabilities';
import { apiEndpointDocs, createApiCapabilitiesManifest } from '~/docs/apiDocs';
import { thingtimeCapabilityManifest } from '~/api/utils/capabilities/thingtimeCapabilities';

const origin = 'https://thingtime.test';
test('recording clients negotiate only with their selected origin and compatible versions', () => {
	for (const version of ['1.3.0', '1.3.1', '1.4.0']) {
		assert.equal(supportsRecordingAutomation({ origin, features: { 'api.lopu-recordings': { version } } }, origin), true);
	}
	for (const version of ['0.9.0', '1.0.0', '1.1.0', '1.2.0', '1.2.1', '2.0.0', '1.3.0-preview', '', null]) {
		assert.equal(supportsRecordingAutomation({ origin, features: { 'api.lopu-recordings': { version } } }, origin), false);
	}
	assert.equal(supportsRecordingAutomation({ origin, features: {} }, origin), false);
	assert.equal(supportsRecordingAutomation({ origin, features: { 'api.lopu-recordings': '1.0.0' } }, 'https://another.test'), false);
});

test('all registered recording endpoints are explicitly versioned in both manifests', () => {
	const manifest = thingtimeCapabilityManifest(origin);
	assert.equal(supportsRecordingAutomation(manifest, origin), true);
	for (const [id, version] of [['lopu-recordings', '1.4.0'], ['lopu-recordings-run', '1.4.0'], ['lopu-recordings-personal', '1.0.0']]) {
		const doc = apiEndpointDocs.find((entry) => entry.id === id);
		assert.equal(doc?.contractVersion, version);
		assert.equal(doc?.featureVersion, version);
		assert.equal(createApiCapabilitiesManifest().features[`api.${id}`], version);
		assert.equal(manifest.features[`api.${id}`].version, version);
		assert.ok(manifest.operations.some((entry) => entry.feature === `api.${id}` && entry.methods.includes('POST') && entry.methods.includes('GET')));
	}
});

test('personal selection requires both the settings and worker contracts on this origin', () => {
	const manifest = thingtimeCapabilityManifest(origin);
	assert.equal(supportsPersonalRecordingSettings(manifest, origin), true);
	assert.equal(supportsPersonalRecordingSettings(manifest, 'https://elsewhere.test'), false);
	for (const [id, version] of [['api.lopu-recordings', '1.3.0'], ['api.lopu-recordings', '2.0.0'], ['api.lopu-recordings-personal', '0.9.0'], ['api.lopu-recordings-personal', '2.0.0']])
		assert.equal(supportsPersonalRecordingSettings({ ...manifest, features: { ...manifest.features, [id]: { version } } }, origin), false);
	assert.equal(supportsPersonalRecordingSettings({ origin, features: { 'api.lopu-recordings': '1.4.0' } }, origin), false);
});
