import assert from 'node:assert/strict';
import test from 'node:test';
import { startMobileDeviceIdentity } from './mobileDeviceIdentity';
import { nativeBridgeReadyEvent } from '../../utils/nativeBridge';
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
	const window = new EventTarget();
	const document = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
	const listeners = new Set<() => void>();
	let current = true, supported = true, withdrawals = 0;
	const requests: Array<{ signal: AbortSignal; resolve(): void; reject(): void }> = [];
	const identity = startMobileDeviceIdentity({
		window, document, current: () => current, supported: () => supported,
		subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
		verify: (signal) => new Promise<void>((resolve, reject) => requests.push({ signal, resolve, reject: () => reject(new Error('unavailable')) })),
		withdraw: () => { withdrawals++; }
	});
	return { window, document, requests, identity, withdrawals: () => withdrawals,
		current(value: boolean) { current = value; for (const listener of listeners) listener(); },
		supported(value: boolean) { supported = value; } };
}
test('identity withdrawal and same-account read-only revalidation run without an optional activity factory', async () => {
	const f = fixture();
	try {
		await settle(); assert.equal(f.requests.length, 1);
		f.requests[0].resolve(); await settle();
		f.current(false); assert.equal(f.withdrawals(), 1);
		f.current(false); assert.equal(f.withdrawals(), 1);
		f.current(true); await settle(); assert.equal(f.requests.length, 2, 'Relogin rechecks existing opt-in even when polling was never started');
		f.requests[1].resolve(); await settle();
		assert.equal(f.withdrawals(), 1);
	} finally { f.identity.stop(); }
});
test('ordinary visibility hiding aborts a status wait without withdrawing background location', async () => {
	const f = fixture();
	try {
		await settle();
		f.document.visibilityState = 'hidden'; f.document.dispatchEvent(new Event('visibilitychange'));
		assert.equal(f.requests[0].signal.aborted, true); assert.equal(f.withdrawals(), 0);
		f.requests[0].resolve(); await settle();
		f.document.visibilityState = 'visible'; f.document.dispatchEvent(new Event('visibilitychange'));
		for (const name of ['focus', 'pageshow', 'online', nativeBridgeReadyEvent]) f.window.dispatchEvent(new Event(name));
		assert.equal(f.requests.length, 2, 'Coalesce foreground/readiness events while verification is pending');
		f.requests[1].resolve(); await settle(); assert.equal(f.withdrawals(), 0);
	} finally { f.identity.stop(); }
});
test('logout/origin boundaries fence old completions and unmount removes every old callback', async () => {
	const f = fixture(); await settle();
	f.current(false); assert.equal(f.requests[0].signal.aborted, true); assert.equal(f.withdrawals(), 1);
	f.current(true); assert.equal(f.requests.length, 2);
	f.requests[0].resolve(); await settle();
	assert.equal(f.requests.length, 2, 'Old status cannot replace the newer identity verification');
	f.identity.stop(); f.identity.stop();
	assert.equal(f.requests[1].signal.aborted, true); assert.equal(f.withdrawals(), 2);
	f.requests[1].resolve(); f.current(true);
	for (const name of ['focus', 'pageshow', 'online', nativeBridgeReadyEvent]) f.window.dispatchEvent(new Event(name));
	await settle(); assert.equal(f.requests.length, 2); assert.equal(f.withdrawals(), 2);
});
test('StrictMode discarded mount never verifies and late capability readiness retries once', async () => {
	const discarded = fixture(); discarded.identity.stop(); await settle();
	assert.equal(discarded.requests.length, 0); assert.equal(discarded.withdrawals(), 1);
	const f = fixture(); f.supported(false);
	try {
		await settle(); assert.equal(f.requests.length, 0);
		f.supported(true); f.window.dispatchEvent(new Event(nativeBridgeReadyEvent));
		assert.equal(f.requests.length, 1); f.requests[0].reject(); await settle();
		assert.equal(f.requests.length, 1, 'No polling/retry loop belongs to identity verification');
		f.window.dispatchEvent(new Event('online')); assert.equal(f.requests.length, 2);
		f.requests[1].resolve(); await settle();
	} finally { f.identity.stop(); }
});
