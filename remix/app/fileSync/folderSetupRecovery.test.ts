import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { parseFileSyncConfiguration } from './configuration';
import { pauseSyncJobAdmission } from './syncJobJournal';
import { EMPTY_SETUP_EXECUTION_STORES, recoverableEmptyBackupSetup, setupRecoveryHistoryKey } from './folderSetupRecovery';
import { DEVICE_SYNC_HISTORY_STORE } from './deviceSyncHistoryJournal';
import { syncScopeKey, type SyncScope } from './reconcile';
import type { SavedFileSyncConfiguration } from './configuredPlan';

const scope: SyncScope = { origin: 'https://setup.test', ownerId: 'owner', deviceId: 'device', rootId: 'legacy', dataPlane: 'home' };
async function fixture() {
 const factory = new IDBFactory(), journal = await openSyncJournal(factory, 'setup', IDBKeyRange);
 const jobs = journal.jobs({ scope, currentScope: () => scope });
 const old = { id: scope.rootId, updatedAt: '2026-11-11T00:00:00Z', configuration: parseFileSyncConfiguration({ configurationVersion: 1,
  name: 'Documents', deviceId: scope.deviceId, localRootId: 'grant', remoteFolderId: 'destination', mode: 'two-way', propagateDeletes: false,
  paused: false, network: 'any', chargingOnly: false, excludedPaths: [] }) };
 const admitted = await jobs.admit(old, 'original-job', 300000, undefined, undefined, { previous: null, pendingFolderValidation: true });
 const prior = (await jobs.transition(admitted, 'attention'))!;
 const saved = { ...old, updatedAt: '2026-11-11T00:01:00Z', configuration: { ...old.configuration, mode: 'backup' as const } };
 const recover = (expected = prior, next: SavedFileSyncConfiguration = saved, interval = 300000) => jobs.admit(next, 'must-not-replace-original-id', interval, undefined, undefined,
  { previous: expected, pendingFolderValidation: true, recoverEmptyBackupSetup: true });
 const put = async (store: string, key: IDBValidKey, value: unknown) => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = factory.open('setup', 16); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value, key); tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error); }); }
  finally { db.close(); }
 };
 return { factory, journal, jobs, old, prior, saved, recover, put };
}

test('mode-only empty setup recovery preserves original identity, full prior evidence and cadence through reopen', async () => {
 const f = await fixture();
 try {
  await assert.rejects(f.jobs.admit(f.saved, 'generic'), /different settings/, 'generic unfinished-work guard remains unchanged');
  await f.put('sync-paged-operations', [syncScopeKey({ ...scope, rootId: 'another-config' }), 'prior', 'receipt'], { confirmed: true });
  const next = await f.recover();
  assert.equal(next.id, f.prior.id); assert.equal(next.revision, f.prior.revision + 1);
  assert.equal(next.intervalMs, 300000); assert.equal(next.pendingFolderValidation, true); assert.deepEqual(next.reviewed, f.saved);
  const receipt = await f.jobs.setupRecovery(f.prior.id, f.prior.revision);
  assert.deepEqual(receipt?.previous, f.prior); assert.deepEqual(receipt?.replacement, f.saved); assert.ok(receipt!.at > 0);
  assert.deepEqual((await f.journal.syncActivity({ scope, currentScope: () => scope }).read()).records, [], 'non-executable setup history cannot enter old activity readers');
  assert.equal((await f.jobs.list()).jobs.length, 1, 'history is not another executable job');
  f.journal.close();
  const reopened = await openSyncJournal(f.factory, 'setup', IDBKeyRange);
  try {
   const jobs = reopened.jobs({ scope, currentScope: () => scope });
   assert.deepEqual(await jobs.read(), next); assert.deepEqual(await jobs.setupRecovery(f.prior.id, f.prior.revision), receipt);
   assert.equal(await reopened.jobs({ scope: { ...scope, ownerId: 'other' }, currentScope: () => ({ ...scope, ownerId: 'other' }) }).setupRecovery(f.prior.id, f.prior.revision), null);
  } finally { reopened.close(); }
 } finally { f.journal.close(); }
});

test('changed destination, source, device, settings, revision, cadence and Pause cannot enter the special recovery', async () => {
 const f = await fixture();
 try {
  for (const patch of [{ remoteFolderId: 'other' }, { localRootId: 'other' }, { deviceId: 'other' }, { paused: true }, { propagateDeletes: true },
   { name: 'changed' }, { network: 'wifi' as const }, { excludedPaths: ['private'] }, { mode: 'two-way' as const }]) {
   const saved = { ...f.saved, configuration: { ...f.saved.configuration, ...patch } };
   assert.equal(recoverableEmptyBackupSetup(f.prior, saved, scope, 300000), false);
   await assert.rejects(f.recover(f.prior, saved));
   assert.deepEqual(await f.jobs.read(), f.prior);
  }
  await assert.rejects(f.recover(f.prior, { ...f.saved, updatedAt: f.old.updatedAt }));
  await assert.rejects(f.recover(f.prior, f.saved, 900000));
  for (const patch of [{ ownerId: 'other' }, { origin: 'https://other.test' }, { deviceId: 'other' }, { rootId: 'other' }]) {
   const binding = { ...scope, ...patch }, jobs = f.journal.jobs({ scope: binding, currentScope: () => binding });
   await assert.rejects(jobs.admit(f.saved, 'new', 300000, undefined, undefined, { previous: f.prior, recoverEmptyBackupSetup: true }));
  }
  const paused = await f.jobs.pause(f.prior); assert.ok(paused);
  await assert.rejects(f.recover(paused!)); assert.deepEqual(await f.jobs.read(), paused);
  assert.equal(await f.jobs.setupRecovery(f.prior.id, f.prior.revision), null);
 } finally { f.journal.close(); }
});

test('canonical, archived and orphaned execution/capture/activity records all refuse recovery without dropping evidence', async () => {
 for (const store of EMPTY_SETUP_EXECUTION_STORES) {
  const f = await fixture();
  try {
   await f.put(store, [syncScopeKey(scope), 'old-uncertain', 'receipt'], { confirmed: false });
   await assert.rejects(f.recover(), /different settings/, store);
   assert.deepEqual(await f.jobs.read(), f.prior); assert.equal(await f.jobs.setupRecovery(f.prior.id, f.prior.revision), null);
  } finally { f.journal.close(); }
 }
 for (const store of ['runs', 'checkpoints', 'sync-paged-run-heads']) {
  const f = await fixture();
  try { await f.put(store, syncScopeKey(scope), { uncertain: true }); await assert.rejects(f.recover()); assert.deepEqual(await f.jobs.read(), f.prior); }
  finally { f.journal.close(); }
 }
});

test('concurrent revision and Pause win; stable job identity lets a later explicit Pause stop the recovered admission', async () => {
 for (const pause of [false, true]) {
  const f = await fixture();
  try {
   const winner = pause ? f.jobs.pause(f.prior) : f.jobs.admit(f.old, 'ignored');
   const refused = assert.rejects(f.recover());
   const expected = await winner; await refused; assert.deepEqual(await f.jobs.read(), expected);
   assert.equal(await f.jobs.setupRecovery(f.prior.id, f.prior.revision), null);
  } finally { f.journal.close(); }
 }
 const f = await fixture();
 try {
  const migration = f.recover(), pause = pauseSyncJobAdmission(f.jobs, f.prior.id);
  await migration; await pause; assert.equal((await f.jobs.read())?.state, 'paused');
 } finally { f.journal.close(); }
});

test('a real IDB history constraint error aborts both admission and history even after done was scheduled', async () => {
 const f = await fixture();
 try {
  await f.put(DEVICE_SYNC_HISTORY_STORE, setupRecoveryHistoryKey(syncScopeKey(scope), f.prior.id, f.prior.revision), { immutable: 'prior evidence' });
  await assert.rejects(f.recover(), /Sync journal transaction failed|constraint/i);
  assert.deepEqual(await f.jobs.read(), f.prior);
 } finally { f.journal.close(); }
});
