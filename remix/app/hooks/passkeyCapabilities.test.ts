import assert from 'node:assert/strict';
import test from 'node:test';
import { supportsPasskeyCeremonies } from './passkeyCapabilities';
import { thingtimeCapabilityManifest } from '../api/utils/capabilities/thingtimeCapabilities';
test('passkey client negotiates each operation against the selected origin', () => {
	const origin = 'https://thingtime.com';
	const manifest = thingtimeCapabilityManifest(origin);
	assert.equal(supportsPasskeyCeremonies(manifest, origin, 'login'), true);
	assert.equal(supportsPasskeyCeremonies(manifest, origin, 'registration'), true);
	assert.equal(supportsPasskeyCeremonies(manifest, 'https://dev.thingtime.com', 'login'), false);
	for (const version of ['1.0.9', '2.0.0', '']) {
		manifest.features['api.auth-passkeys-login'].version = version;
		assert.equal(supportsPasskeyCeremonies(manifest, origin, 'login'), false);
	}
	manifest.features['api.auth-passkeys-login'].version = '1.2.3';
	assert.equal(supportsPasskeyCeremonies(manifest, origin, 'login'), true);
});

test('remembered account creation requires both additive1.2 registration contracts',()=>{
 const origin='https://thingtime.com',manifest=thingtimeCapabilityManifest(origin);
 for(const feature of ['api.auth-passkeys-register-options','api.auth-passkeys-register']){
  const saved=manifest.features[feature].version;
  for(const version of ['1.1.9','2.0.0','']){manifest.features[feature].version=version;assert.equal(supportsPasskeyCeremonies(manifest,origin,'registration'),false);}
  manifest.features[feature].version=saved;
 }
 assert.equal(supportsPasskeyCeremonies(manifest,origin,'registration'),true);
});
