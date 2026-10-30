import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeSyncHost, getNativeSyncAdapter } from './nativeSyncHost.client';
import { nativeBridgeMessageEvent, type ThingtimeNativeBridge } from '../utils/nativeBridge';

function fixture() {
	const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const savedFetch = globalThis.fetch;
	const signal = new AbortController();
	let current = true, device = 'device';
	const calls: { target: string; init?: RequestInit }[] = [], native: string[] = [];
	const page = Object.assign(new EventTarget(), { location: { origin: 'https://sync.example' }, thingtimeNativeBridge: undefined as ThingtimeNativeBridge | undefined,
		fetch: (async function (this: unknown, target, init) {
			assert.equal(this, page); calls.push({ target: String(target), init }); return new Response('{}');
		}) as typeof fetch });
	const bridge: ThingtimeNativeBridge = { version: '1.0.0', platform: 'ios', isNativeWebView: true,
		devicePairingVersion: '1.0.0', fileAccessVersion: '1.3.1', fileStagingVersion: '1.2.0', filePublicationVersion: '1.2.0',
		postMessage(message) {
			const payload = message.payload as Record<string, unknown>; native.push(String(payload.action));
			queueMicrotask(() => page.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, { detail: {
				type: message.type === 'mobile-device' ? 'mobile-device-result' : 'mobile-files-result',
				payload: { ...payload, ...(message.type === 'mobile-device' ? { state: 'paired', deviceId: device } : { roots: [] }) }
			} })));
		}
	};
	page.thingtimeNativeBridge = bridge;
	Object.defineProperty(globalThis, 'window', { configurable: true, value: page });
	globalThis.fetch = async () => Response.json({ schemaVersion: 1, origin: page.location.origin, features: { 'api.things': { version: '1.36.0' } } });
	return { page, bridge, signal, native, calls, setDevice: (value: string) => { device = value; }, invalidate: () => { current = false; },
		create: () => createNativeSyncHost({ adapter: getNativeSyncAdapter()!, ownerId: 'owner', deviceId: 'device', signal: signal.signal,
			assertCurrent() { if (!current) throw Error('Account changed'); } }),
		close() { signal.abort(); if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow); else delete (globalThis as { window?: unknown }).window; globalThis.fetch = savedFetch; }
	};
}
test('iOS app-owned host requires saved-approval capability; Android and old iOS keep their existing flow', () => {
	const f = fixture();
	try {
		assert.equal(getNativeSyncAdapter()?.platform, 'ios');
		f.bridge.filePublicationVersion = '1.0.1'; assert.equal(getNativeSyncAdapter(), undefined);
		f.bridge.filePublicationVersion = '1.2.0'; f.bridge.platform = 'android'; assert.equal(getNativeSyncAdapter(), undefined);
	} finally { f.close(); }
});
test('iOS host verifies paired device and pins credentialed calls to owner, data plane and origin', async () => {
	const f = fixture();
	try {
		const host = await f.create(); assert.deepEqual(f.native, ['status']);
		await host.requireCapability('api.things', '1.36.0');
		await host.request('owner', { action: 'list' }, f.signal.signal);
		const init = { credentials: 'include' as const, cache: 'no-store' as const, redirect: 'error' as const,
			headers: { 'X-Thingtime-Expected-Actor': 'owner', 'X-Thingtime-Expected-Data-Plane': 'home' } };
		await host.fetch('https://sync.example/api/v1/things', init);
		assert.equal(f.calls.length, 1); assert.equal(new Headers(f.calls[0].init?.headers).get('X-Thingtime-Expected-Api-Origin'), 'https://sync.example');
		await assert.rejects(host.fetch('https://other.example/api/v1/things', init));
		await assert.rejects(host.fetch('https://sync.example/api/v1/things', { ...init, headers: { ...init.headers, 'X-Thingtime-Expected-Actor': 'other' } }));
		await assert.rejects(host.request('other', { action: 'list' }, f.signal.signal));
		assert.equal(f.calls.length, 1); assert.deepEqual(f.native, ['status', 'list']);
	} finally { f.close(); }
});
for (const changed of ['device', 'account', 'origin', 'bridge', 'abort'] as const) test(`iOS host fences ${changed} changes before another native effect`, async () => {
	const f = fixture();
	try {
		const host = await f.create();
		if (changed === 'device') f.setDevice('different');
		if (changed === 'account') f.invalidate();
		if (changed === 'origin') f.page.location.origin = 'https://other.example';
		if (changed === 'bridge') f.page.thingtimeNativeBridge = { ...f.bridge };
		if (changed === 'abort') f.signal.abort();
		await assert.rejects(host.authorizeDevice('owner', 'device', f.signal.signal));
		assert.equal(f.native.length, changed === 'device' ? 2 : 1);
	} finally { f.close(); }
});
