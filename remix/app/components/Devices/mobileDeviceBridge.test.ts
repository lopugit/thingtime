import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMobileDeviceResult, supportsMobileDevice } from './mobileDeviceBridge';
import type { ThingtimeNativeBridge } from '~/utils/nativeBridge';
const expected = { requestId: 'request', ownerId: 'owner', origin: 'https://example.test' };
const result = (payload: Record<string, unknown>) => ({ type: 'mobile-device-result', payload: { ...expected, state: 'paired', deviceId: 'device', ...payload } });
test('mobile pairing requires its explicit native capability and platform', () => {
	const bridge = { isNativeWebView: true, platform: 'ios', version: '1.3.0' } as ThingtimeNativeBridge;
	assert.equal(supportsMobileDevice(bridge), false);
	assert.equal(supportsMobileDevice({ ...bridge, devicePairingVersion: '1.0.0' }), true);
	assert.equal(supportsMobileDevice({ ...bridge, platform: 'android', devicePairingVersion: '1.0.0' }), true);
	assert.equal(supportsMobileDevice({ ...bridge, platform: 'macos', devicePairingVersion: '1.0.0' }), false);
	assert.equal(supportsMobileDevice({ ...bridge, devicePairingVersion: '2.0.0' }), false);
});
test('foreign, stale and wrong-origin native replies cannot change this view', () => {
	for (const field of ['requestId', 'ownerId', 'origin']) assert.equal(parseMobileDeviceResult(result({ [field]: 'other' }), expected), null);
	assert.deepEqual(parseMobileDeviceResult(result({ credential: 'must-not-project', privateKey: 'secret' }), expected), { state: 'paired', deviceId: 'device' });
	assert.throws(() => parseMobileDeviceResult(result({ deviceId: '' }), expected));
	assert.deepEqual(parseMobileDeviceResult(result({ state: 'revoked' }), expected), { state: 'revoked' });
});

test('iOS CryptoKit and the server share an independently signed canonical wire vector', async () => {
	const { readFileSync } = await import('node:fs');
	const { canonicalDevicePairingClaimBytes, verifyDevicePairingClaim } = await import('../../api/utils/devices/deviceAuth');
	const vector = JSON.parse(readFileSync(new URL('../../../../iOS/ThingtimeTests/Fixtures/mobile-pairing-vector.json', import.meta.url), 'utf8'));
	assert.equal(canonicalDevicePairingClaimBytes(vector.claim).toString('base64'), vector.canonicalBase64);
	assert.equal(verifyDevicePairingClaim(vector.claim, Buffer.from(vector.signature, 'base64').toString('base64url')), true);
	assert.equal(verifyDevicePairingClaim({ ...vector.claim, device: { ...vector.claim.device, platform: 'android' } }, Buffer.from(vector.signature, 'base64').toString('base64url')), false);
});
