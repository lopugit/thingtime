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

test('foreground pairing checks serialize with polling; cancellation does not cancel another caller', async () => {
    const { requestMobileDevice } = await import('./mobileDeviceBridge');
    const { nativeBridgeMessageEvent } = await import('../../utils/nativeBridge');
    const messages: Array<{ payload: Record<string, string> }> = [];
    const target = Object.assign(new EventTarget(), {
        location: { origin: 'http://localhost:14900' },
        thingtimeNativeBridge: { isNativeWebView: true, platform: 'ios', devicePairingVersion: '1.0.0',
            postMessage: (message: { payload: Record<string, string> }) => messages.push(message) }
    });
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
    const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
    const reply = (index: number) => target.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, {
        detail: { type: 'mobile-device-result', payload: { ...messages[index].payload, state: 'paired', deviceId: 'device' } }
    }));
    try {
        const first = new AbortController(), queued = new AbortController(), third = new AbortController();
        const a = requestMobileDevice('owner', 'status', first.signal);
        const b = requestMobileDevice('owner', 'pair', queued.signal);
        const cancelled = assert.rejects(b, { name: 'AbortError' });
        const c = requestMobileDevice('owner', 'status', third.signal);
        await tick(); assert.equal(messages.length, 1);
        queued.abort(); await cancelled; assert.equal(messages.length, 1);
        reply(0); assert.equal((await a).state, 'paired'); await tick();
        assert.equal(messages.length, 2); assert.equal(messages[1].payload.action, 'status');
        assert.notEqual(messages[0].payload.requestId, messages[1].payload.requestId);
        reply(1); await c;

        const active = new AbortController(), next = new AbortController();
        const d = requestMobileDevice('owner', 'status', active.signal);
        const stopped = assert.rejects(d, { name: 'AbortError' });
        const e = requestMobileDevice('owner', 'pair', next.signal);
        await tick(); active.abort(); await stopped; await tick();
        assert.equal(messages[3].payload.action, 'suspend');
        assert.equal(messages[3].payload.requestId, messages[2].payload.requestId);
        assert.equal(messages[4].payload.action, 'pair'); reply(4); await e;

        const beforeNavigation = requestMobileDevice('owner', 'status', new AbortController().signal);
        const stale = requestMobileDevice('other-owner', 'pair', new AbortController().signal);
        const rejected = assert.rejects(stale, { name: 'AbortError' });
        await tick(); target.location.origin = 'http://localhost:14901';
        reply(5); await beforeNavigation; await rejected; await tick();
        assert.equal(messages.length, 6, 'No queued request crosses an origin change');
    } finally {
        if (previous) Object.defineProperty(globalThis, 'window', previous);
        else Reflect.deleteProperty(globalThis, 'window');
    }
});
