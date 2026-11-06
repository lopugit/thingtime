import assert from 'node:assert/strict';
import test from 'node:test';
import { startMobileDevicePresence } from './mobileDevicePresence';
import { nativeBridgeReadyEvent, type ThingtimeNativeBridge } from '../../utils/nativeBridge';
import type { MobileDeviceStatus } from './mobileDeviceBridge';
function fixture() {
	const window = new EventTarget();
	const document = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
	let current = true;
	let bridge: ThingtimeNativeBridge | undefined = {
		version: '1.0.0',
		platform: 'ios',
		isNativeWebView: true,
		devicePairingVersion: '1.0.0',
		postMessage() {}
	};
	const timers = new Map<() => void, number>();
	const requests: Array<{ signal: AbortSignal; resolve(value: MobileDeviceStatus): void; reject(error: Error): void }> = [];
	const presence = startMobileDevicePresence({
		window,
		document,
		current: () => current,
		bridge: () => bridge,
		request: (signal) =>
			new Promise((resolve, reject) => {
				requests.push({ signal, resolve, reject });
			}),
		schedule: (callback, delay) => {
			timers.set(callback, delay);
			return () => {
				timers.delete(callback);
			};
		}
	});
	const fire = () => {
		const callback = timers.keys().next().value!;
		assert.ok(callback);
		timers.delete(callback);
		callback();
	};
	return {
		window,
		document,
		requests,
		timers,
		presence,
		fire,
		setCurrent: (value: boolean) => {
			current = value;
		},
		setBridge: (value: typeof bridge) => {
			bridge = value;
		}
	};
}
const settle = async () => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};
test('presence recurs independently of route/setup/sync, without overlapping lifecycle requests', async () => {
	const f = fixture();
	try {
		f.fire();
		assert.equal(f.requests.length, 1);
		for (const name of ['focus', 'pageshow', 'online', nativeBridgeReadyEvent]) f.window.dispatchEvent(new Event(name));
		assert.equal(f.requests.length, 1);
		f.requests[0].resolve({ state: 'paired', deviceId: 'saved-device' });
		await settle();
		assert.deepEqual([...f.timers.values()], [30_000]);
		f.fire();
		assert.equal(f.requests.length, 2);
		f.requests[1].resolve({ state: 'paired', deviceId: 'saved-device' });
		await settle();
		f.window.dispatchEvent(new Event('online'));
		assert.equal(f.requests.length, 3);
		assert.equal(f.timers.size, 0);
	} finally {
		f.presence.stop();
	}
});
test('hidden, changed-account/origin and stopped lifecycles abort pending work and reject stale completion', async () => {
	const f = fixture();
	try {
		f.fire();
		f.document.visibilityState = 'hidden';
		f.document.dispatchEvent(new Event('visibilitychange'));
		assert.equal(f.requests[0].signal.aborted, true);
		assert.equal(f.timers.size, 0);
		f.document.visibilityState = 'visible';
		f.document.dispatchEvent(new Event('visibilitychange'));
		assert.equal(f.requests.length, 2);
		f.requests[0].resolve({ state: 'paired', deviceId: 'old' });
		await settle();
		assert.equal(f.timers.size, 0);
		f.setCurrent(false);
		f.presence.refresh();
		assert.equal(f.requests[1].signal.aborted, true);
		f.requests[1].resolve({ state: 'paired', deviceId: 'old' });
		await settle();
		f.window.dispatchEvent(new Event('online'));
		assert.equal(f.requests.length, 2);
		assert.equal(f.timers.size, 0);
	} finally {
		f.presence.stop();
	}
});
test('late bridge readiness starts presence; failures back off, and revoked status never creates a pairing', async () => {
	const f = fixture();
	try {
		const bridge = { version: '1.0.0', platform: 'ios' as const, isNativeWebView: true as const, devicePairingVersion: '1.0.0', postMessage() {} };
		f.setBridge(undefined);
		f.fire();
		assert.equal(f.requests.length, 0);
		f.setBridge(bridge);
		f.window.dispatchEvent(new Event(nativeBridgeReadyEvent));
		assert.equal(f.requests.length, 1);
		for (const [index, delay] of [30_000, 60_000, 120_000, 120_000].entries()) {
			f.requests[index].reject(new Error('offline'));
			await settle();
			assert.deepEqual([...f.timers.values()], [delay]);
			f.fire();
		}
		f.requests[4].resolve({ state: 'revoked' });
		await settle();
		assert.deepEqual([...f.timers.values()], [30_000]);
		f.presence.stop();
		assert.equal(f.timers.size, 0);
		f.window.dispatchEvent(new Event('online'));
		assert.equal(f.requests.length, 5);
	} finally {
		f.presence.stop();
	}
});
test('cleanup before deferred startup prevents StrictMode duplicate native checks', () => {
	const f = fixture();
	f.presence.stop();
	assert.equal(f.timers.size, 0);
	f.window.dispatchEvent(new Event('pageshow'));
	assert.equal(f.requests.length, 0);
});
