import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { MAX_SYNC_JOBS_PER_ACCOUNT, SYNC_JOB_PAGE_SIZE } from './syncJobJournal';
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
