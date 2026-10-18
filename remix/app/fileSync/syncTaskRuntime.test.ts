import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncTaskRuntime } from './syncTaskRuntime';
import type { SyncScope } from './reconcile';

const scope: SyncScope = { origin: 'https://sync.example', ownerId: 'owner', dataPlane: 'home', deviceId: 'device', rootId: 'connection' };
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

test('unmounting every observer does not stop execution; reopening sees current progress', async () => {
	const tasks = createSyncTaskRuntime(), held = gate(); let signal!: AbortSignal;
	let oldUpdates = 0, newUpdates = 0;
	const unmount = tasks.subscribe(() => oldUpdates++);
	const running = tasks.start(scope, async (current, update) => {
		signal = current; await held.promise;
		update({ progress: { stage: 'transferring', total: 3, confirmed: 2 } });
	});
	unmount(); const detachedUpdates = oldUpdates;
	assert.equal(signal.aborted, false); assert.equal(tasks.read()?.active, true);
	const remount = tasks.subscribe(() => newUpdates++);
	held.resolve(); await running;
	assert.equal(oldUpdates, detachedUpdates); assert.equal(newUpdates, 2);
	assert.equal(tasks.read()?.progress.confirmed, 2); assert.equal(tasks.read()?.active, false); remount();
});

test('only the matching connection can stop the live run and overlapping work is refused', async () => {
	const tasks = createSyncTaskRuntime(); let signal!: AbortSignal;
	const running = tasks.start(scope, async current => {
		signal = current;
		await new Promise((_, reject) => current.addEventListener('abort', () => reject(current.reason), { once: true }));
	});
	await assert.rejects(tasks.start({ ...scope, rootId: 'other' }, async () => {}), /already running/);
	tasks.cancel({ ...scope, ownerId: 'other' }); assert.equal(signal.aborted, false);
	tasks.cancel(scope); await running;
	assert.equal(signal.aborted, true); assert.match(tasks.read()!.progress.message!, /stopped/);
});

test('identity invalidation clears private progress and fences late completion', async () => {
	const tasks = createSyncTaskRuntime(), held = gate();
	const running = tasks.start(scope, async (signal, update) => {
		await held.promise; assert.equal(signal.aborted, true);
		assert.throws(() => update({ progress: { stage: 'complete', total: 5, confirmed: 5 } }));
	});
	tasks.invalidate(); assert.equal(tasks.read(), null);
	await assert.rejects(tasks.start(scope, async () => {}), /already running/);
	held.resolve(); await running; assert.equal(tasks.read(), null);
	await tasks.start({ ...scope, ownerId: 'new-owner' }, async () => {});
	assert.equal(tasks.read()?.scope.ownerId, 'new-owner');
});

test('a pending review survives view detachment and resolves exactly once after reattachment', async () => {
	const tasks = createSyncTaskRuntime(); let finish!: () => void, resolutions = 0;
	const running = tasks.start(scope, async (_signal, update) => {
		await new Promise<void>(resolve => {
			finish = () => { resolutions++; resolve(); };
			update({ legacyReview: { conflicts: [], apply: finish, retain: finish, cancel: finish },
				progress: { stage: 'reviewing', total: 1, confirmed: 0 } });
		});
		update({ progress: { stage: 'complete', total: 1, confirmed: 1 }, legacyReview: undefined });
	});
	const unmount = tasks.subscribe(() => {}); unmount();
	assert.equal(tasks.read()?.progress.stage, 'reviewing'); tasks.read()?.legacyReview?.retain();
	await running; assert.equal(resolutions, 1); assert.equal(tasks.read()?.legacyReview, undefined);
});

test('a failed run releases execution for retry without claiming completion', async () => {
	const tasks = createSyncTaskRuntime();
	await tasks.start(scope, async () => { throw Error('Saved approval was revoked.'); });
	assert.equal(tasks.read()?.active, false); assert.match(tasks.read()!.progress.message!, /revoked/);
	assert.notEqual(tasks.read()?.progress.stage, 'complete');
	await tasks.start(scope, async (_signal, update) => update({ progress: { stage: 'complete', total: 1, confirmed: 1 } }));
	assert.equal(tasks.read()?.progress.stage, 'complete');
});
