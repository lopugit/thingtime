import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMobileLocationResult, supportsMobileLocation, requestMobileLocation, suspendMobileLocationAuthorization } from './mobileDeviceLocationBridge';
import type { ThingtimeNativeBridge } from '~/utils/nativeBridge';
const expected = { requestId: 'r', ownerId: 'o', origin: 'https://example.test' };
const reply = (extra: Record<string, unknown> = {}) => ({
	type: 'mobile-device-location-result',
	payload: {
		...expected,
		enabled: true,
		authorization: 'always',
		precision: 'precise',
		backgroundAvailable: true,
		collectionMode: 'significant-change',
		...extra
	}
});
test('location collection requires explicit native capability', () => {
	const bridge = { isNativeWebView: true, platform: 'ios', version: '1.0.0' } as ThingtimeNativeBridge;
	assert.equal(supportsMobileLocation(bridge), false);
	assert.equal(supportsMobileLocation({ ...bridge, deviceLocationVersion: '1.0.0' }), false);
	assert.equal(supportsMobileLocation({ ...bridge, deviceLocationVersion: '1.1.0' }), true);
	assert.equal(supportsMobileLocation({ ...bridge, deviceLocationVersion: '2.0.0' }), false);
	assert.equal(supportsMobileLocation({ ...bridge, platform: 'android', deviceLocationVersion: '1.1.0' }), false);
});
test('location results bind operation owner and origin and expose only status', () => {
	for (const key of ['requestId', 'ownerId', 'origin']) assert.equal(parseMobileLocationResult(reply({ [key]: 'other' }), expected), null);
	assert.deepEqual(parseMobileLocationResult(reply({ credential: 'hidden' }), expected), {
		enabled: true,
		authorization: 'always',
		precision: 'precise',
		backgroundAvailable: true,
		collectionMode: 'significant-change'
	});
	assert.throws(() => parseMobileLocationResult(reply({ authorization: 'invented' }), expected));
	assert.throws(() => parseMobileLocationResult(reply({ error: 'Native location unavailable' }), expected));
});
test('unsupported location does not invoke a native action', async () => {
	await assert.rejects(requestMobileLocation('owner', 'enable', new AbortController().signal));
});

test('native location requests serialize, reject stale replies and honor cancellation', async () => {
	const { nativeBridgeMessageEvent } = await import('../../utils/nativeBridge');
	const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
	const target = Object.assign(new EventTarget(), {
		location: { origin: expected.origin },
		thingtimeNativeBridge: {
			version: '1.0.0',
			isNativeWebView: true,
			platform: 'ios',
			deviceLocationVersion: '1.1.0',
			postMessage: (message: { type: string; payload: Record<string, unknown> }) => messages.push(message)
		}
	});
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
	Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
	const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
	try {
		const first = new AbortController(),
			second = new AbortController();
		const a = requestMobileLocation('o', 'status', first.signal),
			b = requestMobileLocation('o', 'enable', second.signal, { collectionId: '00000000-0000-4000-8000-000000000001' });
		await tick();
		assert.equal(messages.length, 1);
		assert.equal(messages[0].payload.action, 'status');
		target.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, { detail: reply({ ...messages[0].payload, requestId: 'stale' }) }));
		await tick();
		assert.equal(messages.length, 1);
		target.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, { detail: reply(messages[0].payload) }));
		await a;
		await tick();
		assert.equal(messages.length, 2);
		assert.equal(messages[1].payload.action, 'enable');
		const rejected = assert.rejects(b, { name: 'AbortError' });
		second.abort();
		await rejected;
		const count = messages.length;
		await assert.rejects(requestMobileLocation('o', 'enable', new AbortController().signal, { collectionId: 'bad' }));
		assert.equal(messages.length, count);
	} finally {
		if (previous) Object.defineProperty(globalThis, 'window', previous);
		else Reflect.deleteProperty(globalThis, 'window');
	}
});


test('authority suspension bypasses a queued status request and keeps owner/origin scope explicit', async () => {
    const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const target = Object.assign(new EventTarget(), { location: { origin: expected.origin }, thingtimeNativeBridge: {
        version: '1.0.0', isNativeWebView: true, platform: 'ios', deviceLocationVersion: '1.1.0',
        postMessage: (message: { type: string; payload: Record<string, unknown> }) => messages.push(message)
    } });
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
    try {
        const controller = new AbortController();
        const pending = requestMobileLocation('old-owner', 'status', controller.signal);
        const rejected = assert.rejects(pending, { name: 'AbortError' });
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(messages.length, 1);
        suspendMobileLocationAuthorization('old-owner', expected.origin);
        assert.equal(messages.length, 2, 'Identity withdrawal must not wait for the status queue');
        assert.equal(messages[1].type, 'mobile-device-location');
        assert.equal(messages[1].payload.action, 'suspend');
        assert.equal(messages[1].payload.ownerId, 'old-owner');
        assert.equal(messages[1].payload.origin, expected.origin);
        suspendMobileLocationAuthorization('old-owner', 'https://other.test');
        assert.equal(messages.length, 2);
        controller.abort(); await rejected;
    } finally {
        if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window');
    }
});
