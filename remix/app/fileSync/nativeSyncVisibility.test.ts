import test from 'node:test';
import assert from 'node:assert/strict';
import { watchNativeSyncVisibility, NATIVE_SYNC_FOREGROUND_WAIT } from './nativeSyncVisibility';
import { trackNativeUploadBackground } from './nativeUploadBackground';
import { createSyncTaskRuntime } from './syncTaskRuntime';

class Page extends EventTarget {
	visibilityState: DocumentVisibilityState = 'visible';
	hide() { this.visibilityState = 'hidden'; this.dispatchEvent(new Event('visibilitychange')); }
}
test('leaving the app preserves admission, aborts live work and exposes foreground recovery', async () => {
	const tasks = createSyncTaskRuntime(), page = new Page(); let pauses = 0;
	const scope = { origin: 'https://sync.example', ownerId: 'owner', dataPlane: 'home' as const, deviceId: 'device', rootId: 'connection' };
	const run = tasks.start(scope, async signal => {
		const visibility = watchNativeSyncVisibility(signal, message => tasks.suspend(message), page);
		try { await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }
		finally { visibility.dispose(); }
	}, async () => { pauses++; });
	page.hide(); await run;
	assert.equal(pauses, 0); assert.equal(tasks.read()?.active, false);
	assert.equal(tasks.read()?.progress.message, NATIVE_SYNC_FOREGROUND_WAIT);
});
test('only an accepted current-file lease survives hiding; disposal immediately fences the next effect', () => {
	const page = new Page(), controller = new AbortController(); let pauses = 0;
	const lease = trackNativeUploadBackground(controller.signal);
	const visibility = watchNativeSyncVisibility(controller.signal, () => { pauses++; controller.abort(); }, page);
	lease.set(true); page.hide(); visibility.check(); assert.equal(controller.signal.aborted, false);
	lease.dispose(); assert.equal(controller.signal.aborted, true); assert.equal(pauses, 1);
	assert.throws(() => visibility.check()); lease.set(true); assert.equal(pauses, 1); visibility.dispose();
});
test('hidden startup fails closed and disposed observers do not affect a later run', () => {
	const page = new Page(); page.hide();
	const controller = new AbortController();
	const visibility = watchNativeSyncVisibility(controller.signal, () => controller.abort(), page);
	assert.throws(() => visibility.check()); visibility.dispose();
	const next = new AbortController(), later = watchNativeSyncVisibility(next.signal, () => next.abort(), page);
	later.dispose(); page.hide(); assert.equal(next.signal.aborted, false);
});
