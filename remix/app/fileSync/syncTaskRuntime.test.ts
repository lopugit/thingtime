import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncTaskRuntime } from './syncTaskRuntime';
import type { SyncScope } from './reconcile';
import { SyncConditionsWait } from './foregroundSyncContext';
import { NativeInventoryRetryWait } from './nativeInventory';
import { SyncConnectionWait, isSyncConnectionFailure } from './syncConnectionWait';

const scope: SyncScope = { origin: 'https://sync.example', ownerId: 'owner', dataPlane: 'home', deviceId: 'device', rootId: 'connection' };
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

test('temporary condition and reconnect waits remain resumable without an error status', async () => {
	for (const error of [new SyncConditionsWait('offline'), new NativeInventoryRetryWait('Reconnecting'), new SyncConnectionWait('Connection lost')]) {
		const tasks = createSyncTaskRuntime();
		await tasks.start(scope, async () => { throw error; });
		assert.equal(tasks.read()?.waiting, true);
		assert.equal(tasks.read()?.status, 'paused');
		assert.equal(tasks.read()?.active, false);
		assert.equal(tasks.read()?.progress.message, error.message);
		await tasks.start(scope, async (_signal, update) => update({ progress: { stage: 'complete', total: 1, confirmed: 1 } }));
		assert.equal(tasks.read()?.waiting, undefined);
		assert.equal(tasks.read()?.status, 'complete');
	}
});

test('connection loss can retry without treating rejected permissions or changed data as a transport failure', () => {
	for (const error of [new TypeError('Failed to fetch'), new TypeError('Load failed'), new Error('Network request failed'), new DOMException('Request expired', 'TimeoutError')])
		assert.equal(isSyncConnectionFailure(error), true);
	for (const error of [new Error('Cloud sync request failed (403)'), new Error('Source file changed.'), new TypeError('Invalid response'), new Error('Network access denied'), 'offline'])
		assert.equal(isSyncConnectionFailure(error), false);
});

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

test('user Stop aborts immediately while persistence settles; identity invalidation never saves a user pause', async () => {
 const tasks = createSyncTaskRuntime(), held = gate(); let signal!: AbortSignal, saves = 0;
 const running = tasks.start(scope, async current => {
  signal = current; await new Promise((_, reject) => current.addEventListener('abort', () => reject(current.reason), { once: true }));
 }, async () => { saves++; await held.promise; });
 const stopped = tasks.cancel(scope); assert.equal(saves, 1); assert.equal(signal.aborted, true);
 assert.equal(tasks.read()?.stopping, true);
 held.resolve(); await stopped; await running; assert.equal(signal.aborted, true);
 const next = tasks.start(scope, async current => {
  await new Promise((_, reject) => current.addEventListener('abort', () => reject(current.reason), { once: true }));
 }, async () => { saves++; });
 tasks.invalidate(); await next; assert.equal(saves, 1);
});

test('failed pause persistence still stops live work and is surfaced to the caller', async () => {
 const tasks = createSyncTaskRuntime();
 const running = tasks.start(scope, async current => {
  await new Promise((_, reject) => current.addEventListener('abort', () => reject(current.reason), { once: true }));
 }, async () => { throw Error('Disk unavailable'); });
 await assert.rejects(tasks.cancel(scope), /Disk unavailable/); await running;
 assert.equal(tasks.read()?.active, false);
});

test('pause synchronously fences late discovery, aborts before delayed disk, deduplicates cleanup and retains counters', async () => {
 const tasks = createSyncTaskRuntime(), disk = gate(), aborted = gate(); let signal!: AbortSignal, saves = 0, finished = false;
 const running = tasks.start(scope, async (current, update) => {
  signal = current; update({ progress: { stage: 'transferring', total: 12, confirmed: 7 } });
  await new Promise<void>(resolve => current.addEventListener('abort', () => { aborted.resolve(); resolve(); }, { once: true }));
  assert.throws(() => update({ progress: { stage: 'transferring', total: 12, confirmed: 8 } }));
 }, async () => { saves++; await disk.promise; });
 void running.then(() => { finished = true; });
 const first = tasks.cancel(scope), duplicate = tasks.cancel(scope);
 assert.equal(signal.aborted, true); assert.equal(saves, 1);
 assert.equal(tasks.isPaused(scope), true); assert.equal(tasks.read()?.stopping, true);
 await aborted.promise; await Promise.resolve();
 assert.equal(finished, false); assert.equal(tasks.read()?.progress.confirmed, 7);
 let restarted = 0;
 await tasks.start(scope, async () => { restarted++; }, undefined, { automatic: true });
 assert.equal(restarted, 0);
 disk.resolve(); await Promise.all([first, duplicate, running]);
 assert.equal(tasks.read()?.stopping, false); assert.equal(tasks.read()?.active, false);
 await tasks.start(scope, async () => { restarted++; }, undefined, { automatic: true });
 assert.equal(restarted, 0);
 await tasks.start(scope, async () => { restarted++; });
 assert.equal(restarted, 1); assert.equal(tasks.isPaused(scope), false);
});

test('failed durable pause blocks automatic retry until explicit resume, without blocking other scoped jobs', async () => {
 const tasks = createSyncTaskRuntime();
 const running = tasks.start(scope, async signal => new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })), async () => { throw Error('Disk unavailable'); });
 await assert.rejects(tasks.cancel(scope), /Disk unavailable/); await running;
 assert.match(tasks.read()?.progress.message ?? '', /Disk unavailable/);
 let runs = 0;
 await tasks.start(scope, async () => { runs++; }, undefined, { automatic: true });
 assert.equal(runs, 0);
 const other = { ...scope, rootId: 'other' };
 await tasks.start(other, async () => { runs++; }, undefined, { automatic: true });
 assert.equal(runs, 1); assert.equal(tasks.isPaused(scope), true); assert.equal(tasks.isPaused(other), false);
 await tasks.start(scope, async () => { runs++; }); assert.equal(runs, 2);
});

test('idle pause blocks a stale discovery atomically and scope includes owner, origin and connection', async () => {
 const tasks = createSyncTaskRuntime(); await tasks.cancel(scope);
 let runs = 0;
 await tasks.start(scope, async () => { runs++; }, undefined, { automatic: true });
 for (const other of [{ ...scope, ownerId: 'other' }, { ...scope, rootId: 'other' }, { ...scope, origin: 'https://other.example' }])
  await tasks.start(other, async () => { runs++; }, undefined, { automatic: true });
 assert.equal(runs, 3); assert.equal(tasks.isPaused(scope), true);
});

test('progress bursts keep read latest, bound notifications and immediately flush terminal state', async () => {
 const tasks = createSyncTaskRuntime(), held = gate(); let update!: Parameters<Parameters<typeof tasks.start>[1]>[1]; let notifications = 0;
 tasks.subscribe(() => notifications++);
 const running = tasks.start(scope, async (_signal, publish) => { update = publish; await held.promise; });
 update({ progress: { stage: 'transferring', total: 1000, confirmed: 0 } });
 const started = notifications;
 for (let i = 1; i <= 500; i++) update({ progress: { stage: 'transferring', total: 1000, confirmed: i } });
 assert.equal(tasks.read()?.progress.confirmed, 500); assert.equal(notifications, started);
 await new Promise(resolve => setTimeout(resolve, 120));
 assert.equal(notifications, started + 1);
 for (let i = 501; i <= 999; i++) update({ progress: { stage: 'transferring', total: 1000, confirmed: i } });
 update({ progress: { stage: 'complete', total: 1000, confirmed: 1000 } });
 assert.equal(tasks.read()?.progress.confirmed, 1000); assert.equal(notifications, started + 2);
 held.resolve(); await running; const finished = notifications;
 await new Promise(resolve => setTimeout(resolve, 120)); assert.equal(notifications, finished);
 assert.equal(tasks.read()?.status, 'complete');
});

test('runtime pause retains the admitted cycle through completion CAS and journal reload', async () => {
 const { IDBFactory, IDBKeyRange } = await import('fake-indexeddb');
 const { openSyncJournal } = await import('./journal.client');
 const { pauseSyncJobAdmission, syncJobDue } = await import('./syncJobJournal');
 const { newFileSyncConfiguration } = await import('./configuration');
 const indexedDB = new IDBFactory(), name = 'runtime-pause-reload';
 const journal = await openSyncJournal(indexedDB, name, IDBKeyRange);
 const jobs = journal.jobs({ scope, currentScope: () => scope });
 const saved = { id: scope.rootId, updatedAt: '2026-10-21T00:00:00.000Z', configuration: { ...newFileSyncConfiguration({ name: 'Test', deviceId: scope.deviceId, localRootId: 'grant', remoteFolderId: 'cloud' }), paused: false } };
 const admitted = await jobs.admit(saved, 'existing-cycle', 60_000);
 const tasks = createSyncTaskRuntime(), disk = gate();
 const running = tasks.start(scope, async signal => new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })), async () => {
  await disk.promise;
  let completionRaced = false;
  await pauseSyncJobAdmission({ read: jobs.read, pause: async current => {
   if (!completionRaced) { completionRaced = true; await jobs.finish(current, 100); }
   return jobs.pause(current);
  } }, admitted.id);
 });
 const paused = tasks.cancel(scope);
 disk.resolve(); await Promise.all([paused, running]);
 journal.close();
 const reopened = await openSyncJournal(indexedDB, name, IDBKeyRange);
 try {
  const recoveredJobs = reopened.jobs({ scope, currentScope: () => scope }), recovered = await recoveredJobs.read();
  assert.equal(recovered?.id, admitted.id); assert.equal(recovered?.state, 'paused');
  assert.equal(recovered?.nextRunAt, 60_100); assert.equal(syncJobDue(recovered!, 100_000), false);
  assert.equal(await recoveredJobs.begin(recovered!, 100_000, 'late-discovery'), null);
 } finally { reopened.close(); }
});
