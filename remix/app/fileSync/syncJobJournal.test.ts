import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { MAX_SYNC_JOBS_PER_ACCOUNT, SYNC_JOB_PAGE_SIZE, pauseSyncJobAdmission, syncJobCanPause, syncJobDue } from './syncJobJournal';
import { newFileSyncConfiguration } from './configuration';
import type { SyncScope } from './reconcile';
const scope: SyncScope = { origin: 'https://sync.example', ownerId: 'owner', dataPlane: 'home', deviceId: 'device', rootId: 'connection' };
const saved = (binding = scope) => ({ id: binding.rootId, updatedAt: '2026-10-19T00:00:00.000Z', configuration: {
 ...newFileSyncConfiguration({ name: 'Documents', deviceId: binding.deviceId, localRootId: 'grant', remoteFolderId: 'cloud' }), paused: false } });
const open = (factory = new IDBFactory()) => openSyncJournal(factory, 'jobs', IDBKeyRange);
const jobsFor = (journal: Awaited<ReturnType<typeof open>>, binding = scope) => journal.jobs({ scope: binding, currentScope: () => binding });

test('explicit admission survives reopen with stable unfinished identity and fences stale completion', async () => {
 const factory = new IDBFactory(); let journal = await open(factory), jobs = jobsFor(journal);
 assert.equal(await jobs.read(), null); assert.deepEqual((await jobs.list()).jobs, []);
 const admitted = await jobs.admit(saved(), 'job-1'); journal.close(); journal = await open(factory); jobs = jobsFor(journal);
 assert.deepEqual(await jobs.read(), admitted);
 const resumed = await jobs.transition(admitted, 'runnable'); assert.equal(resumed?.id, admitted.id);
 assert.equal(await jobs.transition(admitted, 'complete'), null);
 assert.equal((await jobs.admit(saved(), 'ignored-new-id')).id, admitted.id); journal.close();
});

test('Stop and attention survive reopen and only explicit retry can reactivate them', async () => {
 for (const state of ['paused', 'attention'] as const) {
  const factory = new IDBFactory(); let journal = await open(factory), jobs = jobsFor(journal);
  const admitted = await jobs.admit(saved(), 'job-1'), stopped = await jobs.transition(admitted, state);
  journal.close(); journal = await open(factory); jobs = jobsFor(journal);
  assert.deepEqual(await jobs.read(), stopped); assert.equal(await jobs.transition(admitted, 'runnable'), null);
  assert.equal(await jobs.transition(stopped!, 'runnable'), null);
  assert.equal((await jobs.admit(saved(), 'not-a-new-job')).state, 'runnable'); journal.close();
 }
});

test('completed jobs never replay and a fresh explicit run gets a new identity', async () => {
 const journal = await open(), jobs = jobsFor(journal), admitted = await jobs.admit(saved(), 'job-1');
 const complete = await jobs.transition(admitted, 'complete');
 assert.equal(await jobs.transition(complete!, 'runnable'), null); assert.equal(await jobs.transition(admitted, 'paused'), null);
 assert.equal((await jobs.admit(saved(), 'job-2')).id, 'job-2'); journal.close();
});

test('changed settings cannot replace unfinished work; explicit reapproval can refresh its revision', async () => {
 const journal = await open(), jobs = jobsFor(journal), original = saved(), admitted = await jobs.admit(original, 'job');
 await assert.rejects(jobs.admit({ ...original, configuration: { ...original.configuration, propagateDeletes: true } }, 'new'), /different settings/);
 const retry = await jobs.admit({ ...original, updatedAt: '2026-10-19T01:00:00.000Z' }, 'new');
 assert.equal(retry.id, admitted.id); assert.notEqual(retry.reviewed.updatedAt, admitted.reviewed.updatedAt); journal.close();
});

test('bounded discovery excludes other accounts; transitions reject other origins, devices and roots', async () => {
 const journal = await open(), jobs = jobsFor(journal);
 for (let i = 0; i < SYNC_JOB_PAGE_SIZE + 3; i++) {
  const binding = { ...scope, rootId: 'connection-' + String(i).padStart(3, '0') }; await jobsFor(journal, binding).admit(saved(binding), 'job-' + i);
 }
 const other = { ...scope, ownerId: 'other' }; await jobsFor(journal, other).admit(saved(other), 'other-job');
 const first = await jobs.list(); assert.equal(first.jobs.length, SYNC_JOB_PAGE_SIZE); assert.ok(first.next);
 const last = await jobs.list(first.next); assert.equal(last.jobs.length, 3); assert.equal(last.next, undefined);
 assert.equal(new Set([...first.jobs, ...last.jobs].map(job => job.key)).size, SYNC_JOB_PAGE_SIZE + 3);
 const admitted = await jobs.admit(saved(), 'job');
 for (const patch of [{ origin: 'https://other.example' }, { deviceId: 'other' }, { ownerId: 'other' }, { rootId: 'other' }])
  await assert.rejects(jobsFor(journal, { ...scope, ...patch }).transition(admitted, 'complete'), /scope changed/);
 journal.close();
});

test('identity changes and cancellation fence admission and discovery', async () => {
 const journal = await open(); let current = scope; const controller = new AbortController();
 const jobs = journal.jobs({ scope, currentScope: () => current, signal: controller.signal });
 await jobs.admit(saved(), 'job'); current = { ...scope, ownerId: 'other' };
 assert.throws(() => jobs.list(), /account or root changed/); current = scope; controller.abort();
 assert.throws(() => jobs.read(), { name: 'AbortError' }); journal.close();
});

test('concurrent admissions enforce the account cap without blocking existing connections', async () => {
 const journal = await open();
 const results = await Promise.allSettled(Array.from({ length: MAX_SYNC_JOBS_PER_ACCOUNT + 1 }, (_, i) => {
  const binding = { ...scope, rootId: 'connection-' + i }; return jobsFor(journal, binding).admit(saved(binding), 'job-' + i);
 }));
 assert.equal(results.filter(result => result.status === 'fulfilled').length, MAX_SYNC_JOBS_PER_ACCOUNT);
 assert.equal(results.filter(result => result.status === 'rejected').length, 1);
 const binding = { ...scope, rootId: 'connection-0' }; assert.equal((await jobsFor(journal, binding).admit(saved(binding), 'new')).id, 'job-0'); journal.close();
});

test('version-10 upgrade preserves existing records and admits no jobs', async () => {
 const factory = new IDBFactory();
 const old = await new Promise<IDBDatabase>((resolve, reject) => {
  const request = factory.open('jobs', 10); request.onupgradeneeded = () => request.result.createObjectStore('checkpoints');
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
 });
 await new Promise<void>((resolve, reject) => { const tx = old.transaction('checkpoints', 'readwrite'); tx.objectStore('checkpoints').put('retained', 'marker'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
 old.close(); const journal = await open(factory); assert.deepEqual((await jobsFor(journal).list()).jobs, []); journal.close();
 const db = await new Promise<IDBDatabase>(resolve => { const request = factory.open('jobs'); request.onsuccess = () => resolve(request.result); });
 const marker = await new Promise(resolve => { const request = db.transaction('checkpoints').objectStore('checkpoints').get('marker'); request.onsuccess = () => resolve(request.result); });
 assert.equal(marker, 'retained'); db.close();
});

test('automatic cycles keep their interval across restart and rotate identity only when due', async () => {
 const factory = new IDBFactory(); let journal = await open(factory), jobs = jobsFor(journal);
 const first = await jobs.admit(saved(), 'cycle-1', 60_000);
 const scheduled = await jobs.finish(first, 100_000); assert.equal(scheduled?.nextRunAt, 160_000);
 journal.close(); journal = await open(factory); jobs = jobsFor(journal);
 assert.deepEqual(await jobs.read(), scheduled);
 assert.equal(await jobs.begin(scheduled!, 159_999, 'too-early'), null);
 const second = await jobs.begin(scheduled!, 160_000, 'cycle-2'); assert.equal(second?.id, 'cycle-2'); assert.equal(second?.nextRunAt, undefined);
 assert.equal(await jobs.begin(scheduled!, 999_999, 'duplicate'), null);
 const recovered = await jobs.begin(second!, 160_001, 'ignored'); assert.equal(recovered?.id, second?.id);
 const next = await jobs.finish(recovered!, 500_000); assert.equal(next?.nextRunAt, 560_000); journal.close();
});

test('idle Stop fences due discovery; explicit start after a completed cycle may review new settings', async () => {
 const journal = await open(), jobs = jobsFor(journal), first = await jobs.admit(saved(), 'cycle-1', 300_000);
 const due = await jobs.finish(first, 0), paused = await jobs.pause(due!);
 assert.equal(paused?.state, 'paused'); assert.equal(await jobs.begin(due!, 400_000, 'no'), null);
 assert.equal(await jobs.begin(paused!, 400_000, 'no'), null);
 const changed = { ...saved(), configuration: { ...saved().configuration, name: 'Updated' } };
 const next = await jobs.admit(changed, 'cycle-2', 900_000); assert.equal(next.id, 'cycle-2'); assert.equal(next.intervalMs, 900_000);
 assert.equal(await jobs.finish(first, 500_000), null); journal.close();
});

test('one-shot work never opts into recurring scans and invalid intervals fail before admission', async () => {
 const journal = await open(), jobs = jobsFor(journal);
 for (const interval of [0, -1, 1, 59_999, NaN, Infinity, 86_400_001]) await assert.rejects(jobs.admit(saved(), 'bad', interval), /Invalid saved sync job/);
 assert.equal(await jobs.read(), null);
 const once = await jobs.admit(saved(), 'once'), completed = await jobs.finish(once, 100);
 assert.equal(completed?.state, 'complete'); assert.equal(await jobs.begin(completed!, 1_000_000, 'no'), null);
 const auto = await jobs.admit(saved(), 'auto', 60_000), scheduled = await jobs.finish(auto, 200);
 const manual = await jobs.admit(saved(), 'manual'); assert.equal(manual.intervalMs, 60_000); assert.notEqual(manual.id, scheduled?.id);
 const stopped = await jobs.pause(manual); assert.ok(stopped);
 const retry = await jobs.admit(saved(), 'retry'); assert.equal(retry.intervalMs, undefined); journal.close();
});

test('failed automatic approval parks the schedule without losing its completed-cycle marker', async () => {
 const journal = await open(), jobs = jobsFor(journal), first = await jobs.admit(saved(), 'cycle', 60_000);
 const due = await jobs.finish(first, 0), attention = await jobs.attention(due!);
 assert.equal(attention?.state, 'attention'); assert.equal(attention?.nextRunAt, due?.nextRunAt);
 assert.equal(await jobs.begin(attention!, 100_000, 'no'), null);
 assert.equal((await jobs.admit(saved(), 'explicit', 60_000)).id, 'explicit'); journal.close();
});

test('Stop racing completion also pauses the newly scheduled run without stopping a newer cycle', async () => {
 const journal = await open(), jobs = jobsFor(journal), first = await jobs.admit(saved(), 'cycle-1', 60_000);
 let race = true;
 await pauseSyncJobAdmission({ read: jobs.read, pause: async current => {
  if (race) { race = false; await jobs.finish(current, 100); }
  return jobs.pause(current);
 } }, first.id);
 const paused = await jobs.read(); assert.equal(paused?.state, 'paused'); assert.equal(paused?.nextRunAt, 60_100);
 const next = await jobs.admit(saved(), 'cycle-2', 60_000);
 await pauseSyncJobAdmission(jobs, first.id); assert.deepEqual(await jobs.read(), next); journal.close();
});

test('Stop reports persistence failure and bounds competing revisions', async () => {
 const journal = await open(), jobs = jobsFor(journal), first = await jobs.admit(saved(), 'cycle', 60_000);
 await assert.rejects(pauseSyncJobAdmission({ read: jobs.read, pause: async () => { throw Error('quota'); } }, first.id), /quota/);
 let attempts = 0;
 await assert.rejects(pauseSyncJobAdmission({ read: jobs.read, pause: async () => { attempts++; return null; } }, first.id), /changed while stopping/);
 assert.equal(attempts, 3); assert.deepEqual(await jobs.read(), first); journal.close();
});

test('native backup capture identity survives lifecycle/offline retry, but Stop and new settings fence it', async () => {
 const factory = new IDBFactory(); let journal = await open(factory), jobs = jobsFor(journal);
 const configuration = { ...saved(), configuration: { ...saved().configuration, mode: 'backup' as const, propagateDeletes: false } };
 const captureId = crypto.randomUUID(), admitted = await jobs.admit(configuration, 'backup');
 const indexing = (await jobs.capture(admitted, captureId))!; assert.equal(indexing.nativeCaptureId, captureId);
 assert.equal(await jobs.capture(admitted, crypto.randomUUID()), null); journal.close();
 journal = await open(factory); jobs = jobsFor(journal);
 const offline = (await jobs.read())!; assert.equal(offline.state, 'runnable');
 const eligible = (await jobs.begin(offline, Date.now(), 'ignored'))!; assert.equal(eligible.nativeCaptureId, captureId);
 const stopped = (await jobs.pause(eligible))!; assert.equal(await jobs.begin(stopped, Date.now(), 'ignored'), null);
 assert.equal(stopped.nativeCaptureId, captureId);
 const retry = await jobs.admit(configuration, 'ignored'); assert.equal(retry.nativeCaptureId, captureId);
 const cleared = (await jobs.capture(retry, null))!; assert.equal(cleared.nativeCaptureId, undefined);
 const again = (await jobs.capture(cleared, captureId))!;
 const changed = await jobs.admit({ ...configuration, updatedAt: '2026-10-19T01:00:00.000Z' }, 'ignored'); assert.equal(changed.nativeCaptureId, undefined);
 assert.equal(await jobs.finish(again, Date.now()), null);
 const finished = (await jobs.finish(changed, Date.now()))!; assert.equal(finished.nativeCaptureId, undefined); journal.close();
});

test('native helper restart gets one durable automatic generation retry without consuming transport reconnect attempts', async () => {
 const factory = new IDBFactory(); let journal = await open(factory), jobs = jobsFor(journal);
 const configuration = { ...saved(), configuration: { ...saved().configuration, mode: 'backup' as const, propagateDeletes: false } };
 let job = (await jobs.capture(await jobs.admit(configuration, 'backup'), crypto.randomUUID()))!;
 const first = crypto.randomUUID(), restarted = crypto.randomUUID();
 job = (await jobs.observeCapture(job, first))!;
 for (let n = 0; n < 3; n++) { job = (await jobs.begin(job, Date.now(), 'ignored'))!; assert.equal(job.nativeCaptureRestarts, 0); }
 journal.close(); journal = await open(factory); jobs = jobsFor(journal); job = (await jobs.read())!;
 job = (await jobs.observeCapture(job, restarted))!; assert.equal(job.nativeCaptureRestarts, 1);
 const same = (await jobs.observeCapture(job, restarted))!; assert.equal(same.nativeCaptureRestarts, 1);
 await assert.rejects(jobs.observeCapture(same, crypto.randomUUID()), /repeatedly interrupted/);
 await jobs.attention(same); job = await jobs.admit(configuration, 'ignored'); assert.equal(job.nativeCaptureRestarts, 0);
 assert.equal((await jobs.observeCapture(job, crypto.randomUUID()))?.nativeCaptureRestarts, 1); journal.close();
});


test('legacy one-shot attention can be explicitly stopped before applying new ignore settings', async () => {
 const factory = new IDBFactory(); let journal = await open(factory), jobs = jobsFor(journal);
 const original = saved();
 const attention = (await jobs.attention(await jobs.admit(original, 'legacy-once')))!;
 assert.equal(attention.intervalMs, undefined);
 journal.close(); journal = await open(factory); jobs = jobsFor(journal);
 const recovered = (await jobs.read())!;
 assert.equal(syncJobCanPause(recovered), true, 'the UI must expose Stop even without an automatic interval');
 const updated = { ...original, configuration: { ...original.configuration, configurationVersion: 2 as const, ignoreRules: 'node_modules/' } };
 await assert.rejects(jobs.admit(updated, 'automatic', 300_000), /different settings/);
 assert.deepEqual(await jobs.read(), recovered, 'failed start must preserve the earlier job');
 await pauseSyncJobAdmission(jobs, recovered.id);
 assert.equal((await jobs.read())?.state, 'paused');
 assert.equal(syncJobCanPause(await jobs.read()), false);
 const replacement = await jobs.admit(updated, 'automatic', 300_000);
 assert.equal(replacement.id, 'automatic');
 assert.equal(replacement.reviewed.configuration.ignoreRules, 'node_modules/');
 assert.equal(replacement.intervalMs, 300_000);
 assert.equal(await jobs.finish(recovered, Date.now()), null, 'old callbacks cannot finish the replacement');
 journal.close();
});

test('retrying automatic attention preserves its interval and sealed capture; explicit Stop still disables repetition', async () => {
 const factory = new IDBFactory(); let journal = await open(factory), jobs = jobsFor(journal);
 const configuration = { ...saved(), configuration: { ...saved().configuration, mode: 'backup' as const, propagateDeletes: false } };
 const captureId = crypto.randomUUID(), generation = crypto.randomUUID();
 let job = (await jobs.capture(await jobs.admit(configuration, 'automatic', 300_000), captureId))!;
 job = (await jobs.observeCapture(job, generation))!;
 await jobs.attention(job); journal.close(); journal = await open(factory); jobs = jobsFor(journal);
 const retry = await jobs.admit(configuration, 'unused');
 assert.equal(retry.id, job.id); assert.equal(retry.intervalMs, 300_000);
 assert.equal(retry.nativeCaptureId, captureId); assert.equal(retry.nativeCaptureGeneration, generation);
 const finished = (await jobs.finish(retry, 100))!;
 assert.equal(finished.state, 'scheduled'); assert.equal(finished.nextRunAt, 300_100);
 await jobs.pause(finished);
 assert.equal((await jobs.admit(configuration, 'explicit-one-shot')).intervalMs, undefined);
 journal.close();
});


test('transient retry deadlines survive restart, reject noisy early wakes, and preserve explicit Stop/newer-attempt CAS', async () => {
 const factory = new IDBFactory(); let journal = await open(factory), jobs = jobsFor(journal);
 const first = await jobs.admit(saved(), 'original', 60_000);
 assert.equal(syncJobDue(first, 100), true, 'legacy jobs without a deadline stay compatible');
 const deferred = (await jobs.defer(first, 100, 120_000))!;
 assert.equal(deferred.retryAt, 120_100); assert.equal(deferred.id, first.id);
 journal.close(); journal = await open(factory); jobs = jobsFor(journal);
 const restored = (await jobs.read())!; assert.equal(restored.retryAt, deferred.retryAt);
 for (const wake of ['online', 'pageshow', 'job-event']) {
  assert.equal(syncJobDue(restored, 120_099), false, wake);
  assert.equal(await jobs.begin(restored, 120_099, 'unrelated'), null, wake);
 }
 const resumed = (await jobs.begin(restored, 120_100, 'unrelated'))!;
 assert.equal(resumed.id, first.id); assert.equal(resumed.retryAt, undefined);
 assert.equal(await jobs.defer(restored, 120_101), null, 'late failure cannot defer a newer attempt');
 const stopped = (await jobs.pause(resumed))!;
 assert.equal(await jobs.defer(resumed, 120_102), null, 'late failure cannot overwrite Stop');
 assert.equal((await jobs.read())!.state, 'paused');
 const manual = await jobs.admit(saved(), 'ignored');
 assert.equal(manual.id, first.id); assert.equal(manual.retryAt, undefined, 'explicit retry deliberately clears delay');
 assert.equal(await jobs.defer(stopped, 120_103), null);
 await assert.rejects(jobs.defer(manual, 0, Infinity), /deadline/);
 const bounded = (await jobs.defer(manual, 100, 999999999))!; assert.equal(bounded.retryAt, 300_100);
 journal.close();
});
