import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMobileDeviceResult, supportsMobileDevice, supportsMobileBackgroundPresence, requestMobileDevicePresence, stopMobileBackgroundPresence } from './mobileDeviceBridge';
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
	assert.equal(supportsMobileBackgroundPresence({ ...bridge, devicePairingVersion: '1.0.0' }), false);
	assert.equal(supportsMobileBackgroundPresence({ ...bridge, devicePairingVersion: '1.1.0' }), true);
	assert.equal(supportsMobileBackgroundPresence({ ...bridge, devicePairingVersion: '2.0.0' }), false);
	assert.equal(supportsMobileBackgroundPresence({ ...bridge, platform: 'android', devicePairingVersion: '1.1.0' }), false);
});

test('background presence negotiates the host and stops immediately without crossing an origin', async () => {
	const { nativeBridgeMessageEvent } = await import('../../utils/nativeBridge');
	const messages: Array<{ payload: Record<string, unknown> }> = [];
	const target = Object.assign(new EventTarget(), {
		location: { origin: 'https://example.test' },
		thingtimeNativeBridge: { isNativeWebView: true, platform: 'ios', devicePairingVersion: '1.0.0',
			postMessage: (message: { payload: Record<string, unknown> }) => messages.push(message) }
	});
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
	Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
	const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
	const reply = (index: number) => target.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, {
		detail: { type: 'mobile-device-result', payload: { ...messages[index].payload, state: 'paired', deviceId: 'device' } }
	}));
	try {
		const oldHost = requestMobileDevicePresence('owner', new AbortController().signal);
		await tick();
		assert.equal(messages[0].payload.action, 'status');
		stopMobileBackgroundPresence('owner', target.location.origin);
		assert.equal(messages.length, 1, 'Old hosts receive no unknown command');
		reply(0); await oldHost;
		target.thingtimeNativeBridge.devicePairingVersion = '1.1.0';
		const controller = new AbortController();
		const current = requestMobileDevicePresence('owner', controller.signal);
		const cancelled = assert.rejects(current, { name: 'AbortError' });
		await tick();
		assert.equal(messages[1].payload.action, 'presence');
		assert.equal(messages[1].payload.enabled, true);
		stopMobileBackgroundPresence('owner', target.location.origin);
		assert.equal(messages[2].payload.action, 'presence');
		assert.equal(messages[2].payload.enabled, false, 'Withdrawal bypasses pending request queue');
		assert.equal(messages[2].payload.ownerId, 'owner');
		assert.notEqual(messages[2].payload.requestId, messages[1].payload.requestId);
		controller.abort(); await cancelled;
		const count = messages.length;
		target.location.origin = 'https://other.example.test';
		stopMobileBackgroundPresence('owner', 'https://example.test');
		assert.equal(messages.length, count, 'An old page cannot send its cleanup to another origin');
	} finally {
		if (previous) Object.defineProperty(globalThis, 'window', previous);
		else Reflect.deleteProperty(globalThis, 'window');
	}
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
        const invalidated = assert.rejects(beforeNavigation, { name: 'AbortError' });
        const stale = requestMobileDevice('other-owner', 'pair', new AbortController().signal);
        const rejected = assert.rejects(stale, { name: 'AbortError' });
        await tick(); target.location.origin = 'http://localhost:14901';
        reply(5); await invalidated; await rejected; await tick();
        assert.equal(messages.length, 6, 'No queued request crosses an origin change');
    } finally {
        if (previous) Object.defineProperty(globalThis, 'window', previous);
        else Reflect.deleteProperty(globalThis, 'window');
    }
});

test('legacy native busy refusals never replay status, pair or presence requests', async () => {
 const { requestMobileDevice } = await import('./mobileDeviceBridge');
 const { nativeBridgeMessageEvent } = await import('../../utils/nativeBridge');
 const calls: Record<string, unknown>[] = [];
 const page = Object.assign(new EventTarget(), { location: { origin: 'https://startup.test' }, thingtimeNativeBridge: {
  isNativeWebView: true, platform: 'ios', devicePairingVersion: '1.1.0', postMessage: (message: { payload: Record<string, unknown> }) => {
   calls.push(message.payload);
   queueMicrotask(() => page.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, { detail: { type: 'mobile-device-result', payload: {
    ...message.payload, error: 'Another device request is still running. Try again shortly.' } } })));
  } } });
 const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
 Object.defineProperty(globalThis, 'window', { configurable: true, value: page });
 try {
  for (const action of ['status', 'pair', 'presence'] as const) {
   const before = calls.length;
   await assert.rejects(requestMobileDevice('owner', action, new AbortController().signal), /Another device request/);
   assert.equal(calls.length - before, 1);
  }
  assert.notEqual(calls[0].requestId, calls[1].requestId, 'independent requests retain separate identities');
 } finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
});

test('a native busy refusal releases the renderer queue without cancelling the next pairing', async () => {
 const { requestMobileDevice } = await import('./mobileDeviceBridge');
 const { nativeBridgeMessageEvent } = await import('../../utils/nativeBridge');
 const calls: Record<string, unknown>[] = [];
 const page = Object.assign(new EventTarget(), { location: { origin: 'https://startup.test' }, thingtimeNativeBridge: {
  isNativeWebView: true, platform: 'ios', devicePairingVersion: '1.1.0', postMessage: (message: { payload: Record<string, unknown> }) => {
   calls.push(message.payload);
   queueMicrotask(() => page.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, { detail: { type: 'mobile-device-result', payload: {
    ...message.payload, ...(message.payload.action === 'status' ? { error: 'Another device request is still running. Try again shortly.' } : { state: 'paired', deviceId: 'device' }) } } })));
  } } });
 const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
 Object.defineProperty(globalThis, 'window', { configurable: true, value: page });
 try {
  const cancellation = new AbortController(), status = requestMobileDevice('owner', 'status', cancellation.signal);
  const stopped = assert.rejects(status, /Another device request/);
  const pair = requestMobileDevice('owner', 'pair', new AbortController().signal);
  await new Promise(resolve => setImmediate(resolve)); cancellation.abort(); await stopped;
  assert.equal((await pair).state, 'paired');
  assert.deepEqual(calls.map(row => row.action), ['status', 'pair']);
 } finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
});
