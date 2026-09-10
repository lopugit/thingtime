import assert from 'node:assert/strict';
import test from 'node:test';
import { apiEndpointDocs, apiV1RouteKeys, createApiCapabilitiesManifest } from '~/docs/apiDocs';
import { thingtimeCapabilityManifest } from '~/api/utils/capabilities/thingtimeCapabilities';
import { capabilitySatisfies } from '~/api/utils/capabilities/capabilityContract';
import { prodCsp } from '../../../scripts/csp.mjs';

test('voice capture is explicitly registered, versioned and advertised on its selected origin', () => {
	const manifest = thingtimeCapabilityManifest('https://thingtime.test');
	assert.equal(manifest.origin, 'https://thingtime.test');
	assert.equal(manifest.features['api.lopu-voice-capture'].version, '1.0.0');
	assert.equal(createApiCapabilitiesManifest().features['api.lopu-voice-capture'], '1.0.0');
	assert.ok(apiV1RouteKeys.includes('v1/lopu/voice/capture'));
	assert.ok(manifest.operations.some(row => row.feature === 'api.lopu-voice-capture' && row.methods.includes('POST')));
	const doc = apiEndpointDocs.find(row => row.id === 'lopu-voice-capture');
	assert.equal(doc?.contractVersion, '1.0.0'); assert.match(doc!.detail, /ownerId/);
	for (const version of ['1.0.0', '1.0.1', '1.2.0']) assert.equal(capabilitySatisfies(version, '1.0.0'), true);
	for (const version of ['', '0.9.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.0.0'), false);
});
test('production permits the supported direct voice host without opening arbitrary WebSockets', () => {
	const connect = prodCsp.split(';').find((part: string) => part.trim().startsWith('connect-src '))!.trim().split(/\s+/).slice(1);
	assert.ok(connect.includes('wss://api.x.ai'));
	assert.equal(connect.includes('wss:'), false); assert.equal(connect.includes('*'), false);
});
