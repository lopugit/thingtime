import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { newFileSyncConfiguration } from './configuration';
import { setDesktopSyncScheduled } from './desktopSyncWindow.client';
import { openSyncJournal } from './journal.client';
import { enrollNativeFolderSync, nativeSyncTasks, pauseNativeSyncJob, startNativeSyncTask } from './nativeSyncTasks.client';
import type { SyncScope } from './reconcile';

test('explicit native enrollment proves exact saved settings, private destination and separate write consent before queueing once', async () => {
 const scope: SyncScope = { origin: 'https://sync.example', ownerId: 'owner', deviceId: 'device', dataPlane: 'home', rootId: 'config' };
 const rootId = '00000000-0000-4000-8000-000000000001', remoteFolderId = 'cloud-root';
 const saved = { id: scope.rootId, updatedAt: '2026-10-20T00:00:00.000Z', configuration: {
  ...newFileSyncConfiguration({ name: 'Fixture', deviceId: scope.deviceId, localRootId: rootId, remoteFolderId }), paused: false
 } };
 const queuedScope = { ...scope, rootId: 'queued-config' };
 const queuedConfig = { ...saved, id: queuedScope.rootId };
 const calls: string[] = [];
 let changed = false, refuse = false, refuseCancellation = false, rejectWriteCheck = false;
 let onScanCancel: (() => Promise<void>) | undefined;
 let waitForApproval: (() => Promise<void>) | undefined;
 const strictCapture = '00000000-0000-4000-8000-000000000002';
 const legacyCapture = '00000000-0000-4000-8000-000000000003';
 let current = saved;
 let failLegacyCancel = false;
 const legacyRequests: unknown[] = [];
 const bridge = {
  platform: 'darwin',
  folderSyncTaskVersion: '1.0.0',
  setFolderSyncActive: async () => {},
  folderSyncRequest: async (request: { action: string; captureId?: string; capturePolicy?: string; rootId?: string; excludedPaths?: string[]; approval?: { configurationRevision: string } }) => {
   calls.push(request.action);
   if (request.action === 'scan-cancel') {
    if (request.captureId === legacyCapture) {
     assert.equal(request.capturePolicy, 'backup-supported');
     assert.equal(request.rootId, rootId);
     assert.deepEqual(request.excludedPaths, ['old-excluded']);
     legacyRequests.push(request.captureId);
     if (failLegacyCancel) throw Error('Native scanner cancellation was not confirmed');
    } else {
     assert.equal(request.captureId, strictCapture);
     if (refuseCancellation) throw Error('Native scanner cancellation was not confirmed');
     await onScanCancel?.();
    }
   }
   if (request.action === 'write-check' && rejectWriteCheck) throw Error('No current native write approval');
   if (request.action === 'write-approve') {
    assert.equal(request.approval?.configurationRevision, saved.updatedAt);
    if (refuse) throw Error('Native approval declined');
    await waitForApproval?.();
   }
   return { ...request, ...(request.action === 'scan-cancel' ? { cancelled: true, complete: false, excludedPaths: request.excludedPaths ?? [] } : {}), origin: scope.origin, roots: [{ id: rootId, name: 'Fixture', publicationVersion: '1.2.0' }],
    conditions: { network: 'wifi', charging: true }, writeApproval: request.approval,
    capabilities: { fileAccessVersion: '1.18.0', fileStagingVersion: '1.2.0', filePublicationVersion: '1.2.0', fileResourceLimitsVersion: '1.1.0' },
    apiCapabilities: { schemaVersion: 1, origin: scope.origin, features: { 'api.things': { version: '1.36.0' }, 'api.files': { version: '1.2.0' }, 'api.devices-sync-control': { version: '1.6.0' } } }
   };
  }
 };
 const globals = {
  window: Object.assign(new EventTarget(), {
   location: { origin: scope.origin }, thingtimeDesktop: bridge,
   fetch: async (target: URL, options: RequestInit) => {
    const headers = new Headers(options.headers);
    assert.equal(headers.get('X-Thingtime-Expected-Actor'), scope.ownerId);
    assert.equal(headers.get('X-Thingtime-Expected-Data-Plane'), 'home');
    if (target.pathname === '/api/v1/things') {
     const value = target.searchParams.get('id') === queuedScope.rootId ? queuedConfig : current;
     calls.push('private-read');
     return Response.json({ thing: { id: value.id, updatedAt: changed ? '2026-10-20T00:01:00.000Z' : value.updatedAt,
      crystal: value.configuration, acl: ['tt:user'], thingtime: ['file-sync'], author: { id: scope.ownerId } } });
    }
    assert.equal(target.pathname, '/api/v1/files');
    assert.equal(target.searchParams.get('folderId'), remoteFolderId);
    calls.push('folder-read');
    return Response.json({ ok: true, folder: { id: remoteFolderId, revision: 'revision', name: 'Fixture', folderId: null } });
   }
  }),
  navigator: { locks: { request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run() } },
  indexedDB: new IDBFactory(), IDBKeyRange
 };
 const priorGlobals = Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
 for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
 let journal: Awaited<ReturnType<typeof openSyncJournal>> | undefined;
 try {
  journal = await openSyncJournal();
  const jobs = journal.jobs({ scope, currentScope: () => scope });
  changed = true;
  await assert.rejects(enrollNativeFolderSync(saved, scope, 0), /changed/);
  assert.equal(await jobs.read(), null);
  assert.ok(!calls.includes('write-approve'));
  changed = false; refuse = true;
  await assert.rejects(enrollNativeFolderSync(saved, scope, 0), /folder access could not be verified/i);
  assert.equal(await jobs.read(), null);
  refuse = false;
  const enrolled = await enrollNativeFolderSync(saved, scope, 0);
  assert.deepEqual(await jobs.read(), enrolled);
  assert.equal(enrolled.state, 'runnable');
  assert.equal(enrolled.intervalMs, 300_000);
  assert.deepEqual(calls.slice(-7), ['context', 'private-read', 'list', 'folder-read', 'list', 'write-approve', 'private-read']);
  assert.deepEqual(await enrollNativeFolderSync(saved, scope, 0), enrolled);
  assert.equal(calls.filter(call => call === 'write-approve').length, 2);

  const captured = (await jobs.strictCapture(enrolled, strictCapture))!;
  const needsReview = (await jobs.attention(captured))!;
  refuseCancellation = true;
  await assert.rejects(enrollNativeFolderSync(saved, scope, 0, undefined, undefined,
   { recoverSavedIntent: true, respectPause: true }), /could not be verified/i);
  assert.deepEqual(await jobs.read(), needsReview, 'a lost scanner confirmation leaves the saved capture intact');
  refuseCancellation = false;
  const recovered = await enrollNativeFolderSync(saved, scope, 0, undefined, undefined,
   { recoverSavedIntent: true, respectPause: true });
  assert.equal(recovered.id, enrolled.id, 'resume retains the existing work identity');
  assert.equal(recovered.strictCaptureId, undefined);
  assert.equal(recovered.state, 'runnable');
  assert.equal(calls.filter(call => call === 'scan-cancel').length, 2);
  assert.deepEqual(await enrollNativeFolderSync(saved, scope, 0, undefined, undefined,
   { recoverSavedIntent: true, respectPause: true }), recovered, 'already enabled exact work is idempotent');
  assert.equal((await jobs.read())?.id, recovered.id);

  const otherScope = { ...scope, rootId: 'other-config' };
  let finishTransfer!: () => void;
  const transfer = nativeSyncTasks.start(otherScope, () => new Promise<void>(resolve => { finishTransfer = resolve; }));
  const beforeBusy = calls.length;
  try {
   const queued = await enrollNativeFolderSync(queuedConfig, queuedScope, 0);
   assert.equal(queued.pendingFolderValidation, true);
   assert.equal(queued.state, 'runnable');
   assert.equal(calls.length, beforeBusy, 'another runner does not block durable admission or trigger any native call');
   const reopened = await openSyncJournal();
   try {
    assert.deepEqual(await reopened.jobs({ scope: queuedScope, currentScope: () => queuedScope }).read(), queued);
   } finally { reopened.close(); }
  } finally { finishTransfer(); await transfer; }

  const queuedJobs = journal.jobs({ scope: queuedScope, currentScope: () => queuedScope });
  const queued = (await queuedJobs.read())!;
  const beforeWriteApproval = calls.filter(action => action === 'write-approve').length;
  rejectWriteCheck = true;
  await startNativeSyncTask(queuedConfig, queuedScope, 0, queued);
  assert.equal((await queuedJobs.read())?.failureReason, 'write-approval');
  assert.equal((await queuedJobs.read())?.state, 'attention');
  assert.equal(calls.filter(action => action === 'write-approve').length, beforeWriteApproval, 'background preflight never opens an approval prompt');
  assert.deepEqual(calls.slice(-5), ['list', 'private-read', 'folder-read', 'list', 'write-check']);

  // A durable setup intent can outlive a failed background preflight. The
  // queue must resume the identical saved job without a new operation ID or
  // an approval dialog, while retaining the worker's later validation gate.
  rejectWriteCheck = false;
  const attention = (await queuedJobs.read())!;
  const callsBeforeResume = calls.length;
  const resumedQueue = await enrollNativeFolderSync(queuedConfig, queuedScope, 0, undefined, undefined, { queue: true, respectPause: true });
  assert.equal(resumedQueue.id, attention.id);
  assert.equal(resumedQueue.state, 'runnable');
  assert.equal(resumedQueue.pendingFolderValidation, true);
  assert.equal(calls.length, callsBeforeResume, 'queued recovery does not use native consent or perform an effect');
  const admittedQueue = (await queuedJobs.begin(resumedQueue, Date.now(), crypto.randomUUID()))!;
  const scheduledQueue = (await queuedJobs.finish(admittedQueue, Date.now()))!;
  const scheduledAttention = (await queuedJobs.attention(scheduledQueue))!;
  await assert.rejects(enrollNativeFolderSync(queuedConfig, queuedScope, 0, undefined, undefined, { queue: true, respectPause: true }), /saved work/);
  await assert.rejects(enrollNativeFolderSync(queuedConfig, queuedScope, 0, undefined, undefined,
   { recoverSavedIntent: true, respectPause: true }), /saved work/);
  assert.equal((await queuedJobs.read())?.id, scheduledAttention.id,
   'a later scheduled attempt cannot be silently given a new operation ID by queued recovery');

  const paused = (await jobs.pause(recovered))!;
  let enteredApproval!: () => void, finishApproval!: () => void;
  const entered = new Promise<void>(resolve => { enteredApproval = resolve; });
  waitForApproval = () => new Promise<void>(resolve => { finishApproval = resolve; enteredApproval(); });
  const enrollment = enrollNativeFolderSync(saved, scope, 0);
  void enrollment.catch(() => {});
  try {
   await entered;
   await startNativeSyncTask(recovered.reviewed, scope, 0, recovered);
   assert.equal(nativeSyncTasks.read()?.active, false, 'automatic discovery cannot start during the native approval');
   await assert.rejects(startNativeSyncTask(saved, scope, 0), /waiting for device approval/);
   await pauseNativeSyncJob(scope, 0);
   await assert.rejects(enrollment, /setup was paused/);
   assert.deepEqual(await jobs.read(), paused, 'Stop during a pending consent cannot rearm a paused job');
  } finally { finishApproval?.(); waitForApproval = undefined; }

  current = { ...saved, updatedAt: '2026-10-20T00:03:00.000Z', configuration: { ...saved.configuration, mode: 'backup', excludedPaths: ['old-excluded'] } };
  const backup = await enrollNativeFolderSync(current, scope, 0);
  const backupPaused = (await jobs.pause((await jobs.capture(backup, legacyCapture))!))!;
  current = { ...current, updatedAt: '2026-10-20T00:04:00.000Z', configuration: { ...current.configuration, excludedPaths: ['new-excluded'] } };
  failLegacyCancel = true;
  await assert.rejects(enrollNativeFolderSync(current, scope, 0), /could not be verified/i);
  assert.deepEqual(await jobs.read(), backupPaused, 'failed native cleanup leaves the old job and pause intact');
  failLegacyCancel = false;
  const edited = await enrollNativeFolderSync(current, scope, 0);
  assert.equal(edited.reviewed.updatedAt, current.updatedAt);
  assert.equal(edited.nativeCaptureId, undefined);
  assert.deepEqual(legacyRequests, [legacyCapture, legacyCapture]);

  const nativePhotosBusyScope = { ...scope, rootId: 'native-photos-busy-folder' };
  const beforeNativeOnly = calls.length;
  assert.notEqual(nativeSyncTasks.read()?.active, true);
  const queuedDuringNativePhotos = await enrollNativeFolderSync({ ...current, id: nativePhotosBusyScope.rootId }, nativePhotosBusyScope, 0, undefined, undefined, { queue: true });
  assert.equal(queuedDuringNativePhotos.pendingFolderValidation, true);
  assert.equal(calls.length, beforeNativeOnly, 'an external native photo task does not need the ordinary bridge lane');

  const fencedScope = { ...scope, rootId: 'paused-before-admission' };
  const fencedConfig = { ...current, id: fencedScope.rootId };
  await pauseNativeSyncJob(fencedScope, 0, async () => fencedConfig);
  const persistedPause = await journal.jobs({ scope: fencedScope, currentScope: () => fencedScope }).read();
  assert.equal(persistedPause?.folderSetupPaused, true);
  assert.equal(persistedPause?.state, 'paused');
  nativeSyncTasks.resumeScope(fencedScope); // Simulate process loss of the live pause barrier.
  await assert.rejects(enrollNativeFolderSync(fencedConfig, fencedScope, 0, undefined, undefined, { queue: true, respectPause: true }), /saved work/);
  await assert.rejects(enrollNativeFolderSync(fencedConfig, fencedScope, 0, undefined, undefined,
   { recoverSavedIntent: true, respectPause: true }), /changed|saved work/);
  assert.deepEqual(await journal.jobs({ scope: fencedScope, currentScope: () => fencedScope }).read(), persistedPause);

  const retained = (await jobs.attention((await jobs.strictCapture(edited, strictCapture))!))!;
  const stale = { ...current, updatedAt: '2026-10-20T00:03:00.000Z' };
  const beforeStale = calls.length;
  await assert.rejects(enrollNativeFolderSync(stale, scope, 0, undefined, undefined,
   { recoverSavedIntent: true, respectPause: true }), /changed/);
  assert.deepEqual(await jobs.read(), retained);
  assert.equal(calls.filter(action => action === 'scan-cancel').length, 4, 'changed saved revision cannot cancel a retained scanner');
  assert.ok(calls.length > beforeStale, 'the exact private config was re-read');
  onScanCancel = async () => { assert.deepEqual(await jobs.pause(retained), { ...retained, state: 'paused', revision: retained.revision + 1 }); };
  try {
   await assert.rejects(enrollNativeFolderSync(current, scope, 0, undefined, undefined,
    { recoverSavedIntent: true, respectPause: true }), /changed while retiring|setup was paused/);
   const raced = (await jobs.read())!;
   assert.equal(raced.id, retained.id);
   assert.equal(raced.state, 'paused');
   assert.equal(raced.strictCaptureId, strictCapture, 'a Pause racing native cleanup keeps the original capture marker and receipts');
  } finally { onScanCancel = undefined; }
 } finally {
  nativeSyncTasks.invalidate();
  await setDesktopSyncScheduled(false, bridge as never);
  journal?.close();
  for (const [name, descriptor] of priorGlobals) {
   if (descriptor) Object.defineProperty(globalThis, name, descriptor);
   else Reflect.deleteProperty(globalThis, name);
  }
 }
});
