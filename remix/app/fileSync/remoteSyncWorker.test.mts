import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal as openRealSyncJournal } from './journal.client';
import { newFileSyncConfiguration } from './configuration';

const scope = { ownerId: 'owner', deviceId: 'device', origin: 'https://sync.test', dataPlane: 'home', rootId: 'connection' };
let historyFactory: IDBFactory | undefined;
let delayedEnrollment: ((signal: AbortSignal) => Promise<void>) | undefined;
let delayedHistory: ((signal: AbortSignal) => Promise<unknown>) | undefined;
let snapshot: any = null, paused: any = null, started: any = null, nativeAbort: AbortController | undefined, pausedRevision: string | undefined;
const host: any = { origin: () => scope.origin, assertCurrent() {}, authorizeDevice: async () => {}, requireCapability: async () => {},
	capabilities: { platform: 'macos', fileAccessVersion: '1.16.0' }, request: async () => ({ roots: [{ id: 'local', name: 'Documents' }] }) };
const configuration = { ...newFileSyncConfiguration({ name: 'Documents', deviceId: 'device', localRootId: 'local', remoteFolderId: 'cloud' }), paused: false };
const saved = { id: 'connection', updatedAt: '2026-10-23T00:00:00.000Z', crystal: configuration, author: { id: 'owner' }, acl: ['tt:user'], thingtime: ['file-sync'] };
host.fetch = async () => Response.json({ thing: saved });
const adapter: any = { platform: 'macos', bridge: { nodeGetStatus: async () => ({ pairingStatus: 'paired', deviceIds: ['device'] }) } };
await (mock as any).module(new URL('./nativeSyncTasks.client.ts', import.meta.url).href, { namedExports: {
	nativeSyncTasks: { read: () => snapshot },
	startNativeSyncTask: (value: any, binding: any, _generation: number, _resume: any, interval: any) => {
		started = { value, binding, interval }; snapshot = { scope: binding, active: true, progress: { stage: 'checking', confirmed: 0, total: 0 } };
		return new Promise(() => {});
	},
	enrollNativeFolderSync: async (value: any, binding: any, _generation: number, interval: number, signal: AbortSignal, options: { queue?: boolean; respectPause?: boolean; recoverSavedIntent?: true }) => {
		started = { value, binding, interval, options };
		if (delayedEnrollment) await delayedEnrollment(signal);
		return { reviewed: value, intervalMs: interval, pendingFolderValidation: options.queue };
	},
	pauseNativeSyncJob: async (binding: any, _generation: number, readSaved: () => Promise<{ updatedAt: string }>) => {
		paused = binding; nativeAbort?.abort(); snapshot = null;
		pausedRevision = (await readSaved()).updatedAt;
	}
} });
await (mock as any).module(new URL('./nativeSyncHost.client.ts', import.meta.url).href, { namedExports: {
	getNativeSyncAdapter: () => adapter, isNativeSyncAdapterCurrent: () => true, createNativeSyncHost: async () => host
} });
await (mock as any).module(new URL('./desktopSyncWindow.client.ts', import.meta.url).href, { namedExports: { holdDesktopSyncWindow: async () => async () => {} } });
await (mock as any).module(new URL('./journal.client.ts', import.meta.url).href, { namedExports: {
	openSyncJournal: async () => historyFactory ? openRealSyncJournal(historyFactory, 'worker-history', IDBKeyRange) : ({ close() {}, jobs: () => ({ list: async () => ({ jobs: [], next: null }) }),
		deviceHistory: ({ signal }: { signal: AbortSignal }) => ({ read: () => delayedHistory?.(signal) }) })
} });
const { executeRemoteSyncCommand, startRemoteSyncWorker } = await import('./remoteSyncWorker.client');
const context: any = { ...scope, host, generation: 0, signal: new AbortController().signal, check() {}, scope: (rootId: string) => ({ ...scope, rootId }) };
const session: any = { host, roots: [{ id: 'local', name: 'Documents' }], rootsReady: true };

test('remote start returns before the device transfer finishes and checks saved revision', async () => {
	snapshot = null; started = null;
	await assert.rejects(executeRemoteSyncCommand({ action: 'start', connectionId: 'connection', expectedUpdatedAt: '2026-10-22T00:00:00Z' }, context, session), /connection changed/);
	assert.equal(started, null);
	const result = await executeRemoteSyncCommand({ action: 'start', connectionId: 'connection', expectedUpdatedAt: saved.updatedAt, intervalMs: 300000 }, context, session);
	assert.deepEqual(result, { accepted: true, folderEnrollmentVersion: '1.0.0', connectionId: saved.id,
		expectedUpdatedAt: saved.updatedAt, intervalMs: 300000, pendingFolderValidation: false });
	assert.deepEqual(started.binding, scope);
	assert.equal(started.interval, 300000);
	assert.equal(snapshot, null, 'scheduled admission does not require a running transfer');
	const immediate = await executeRemoteSyncCommand({ action: 'start', connectionId: 'connection', expectedUpdatedAt: saved.updatedAt }, context, session);
	assert.deepEqual(immediate, { accepted: true });
	assert.equal(snapshot.active, true);
});

test('remote enrollment recovery queues the exact folder revision without native consent', async () => {
	snapshot = null; started = null;
	const command = { action: 'start', connectionId: saved.id, expectedUpdatedAt: saved.updatedAt, intervalMs: 300_000, queueOnly: true } as const;
	assert.deepEqual(await executeRemoteSyncCommand(command, context, session), {
		accepted: true, folderEnrollmentVersion: '1.0.0', connectionId: saved.id,
		expectedUpdatedAt: saved.updatedAt, intervalMs: command.intervalMs, pendingFolderValidation: true,
	});
	assert.deepEqual(started.binding, scope);
	assert.deepEqual(started.options, { queue: true, respectPause: true });
	assert.equal(snapshot, null);
	const photos = { ...saved, crystal: { ...configuration, sourceKind: 'photos', mode: 'backup' } };
	const photoContext = { ...context, host: { ...host, fetch: async () => Response.json({ thing: photos }) } };
	started = null;
	await assert.rejects(executeRemoteSyncCommand(command, photoContext, session), /requires a saved folder sync config/);
	assert.equal(started, null);
});

test('advertised worker accepts the separate saved-intent command with current server and exact revision', async () => {
 snapshot = null; started = null;
 const status: any = await executeRemoteSyncCommand({ action: 'status' }, context, session);
 assert.equal(status.folderEnrollmentVersion, '1.0.0');
 assert.equal(status.folderEnrollmentRecoveryVersion, '1.0.0');
 const command = { action: 'start', connectionId: saved.id, expectedUpdatedAt: saved.updatedAt, intervalMs: 300_000, recoverSavedIntent: true } as const;
 const result: any = await executeRemoteSyncCommand(command, context, session);
 assert.equal(result.accepted, true);
 assert.deepEqual(started.options, { queue: undefined, respectPause: true, recoverSavedIntent: true });
 assert.equal(snapshot, null);
 const old = { ...context, host: { ...host, requireCapability: async (feature: string, minimum: string) => {
  if (feature === 'api.devices-sync-control' && minimum === '1.6.0') throw Error('Old selected origin');
 } } };
 started = null;
 await assert.rejects(executeRemoteSyncCommand(command, old, session), /Old selected origin/);
 assert.equal(started, null);
});

test('owner-private status marks only a retained strict capture for guarded recovery', async () => {
 historyFactory = new IDBFactory(); snapshot = null;
 try {
  const journal = await openRealSyncJournal(historyFactory, 'worker-history', IDBKeyRange);
  try {
   const jobs = journal.jobs({ scope, currentScope: () => scope });
   const admitted = await jobs.admit({ id: saved.id, updatedAt: saved.updatedAt, configuration }, '00000000-0000-4000-8000-000000000001', 300_000);
   const attention = await jobs.attention((await jobs.strictCapture(admitted, '00000000-0000-4000-8000-000000000002'))!);
   assert.equal(attention?.id, admitted.id);
   const status: any = await executeRemoteSyncCommand({ action: 'status' }, context, session);
   assert.equal(status.folderEnrollmentRecoveryVersion, '1.0.0');
   assert.deepEqual(status.jobs.map((job: any) => [job.connectionId, job.strictCapturePending]), [['connection', true]]);
  } finally { journal.close(); }
 } finally { historyFactory = undefined; }
});

test('recovery cannot borrow another device scope', async () => {
	snapshot = null;
	await assert.rejects(executeRemoteSyncCommand({ action: 'folders', request: { action: 'trash-inspect', rootId: 'local',
		trash: { scope: { ...scope, deviceId: 'foreign' } } as any } }, context, session), /different account or device/);
});

test('status pages retain every approved folder without a browser-only root limit', async () => {
	snapshot = null;
	const roots = Array.from({ length: 97 }, (_, index) => ({ id: `root-${String(index).padStart(3, '0')}`, name: `Folder ${index}` }));
	const all: string[] = [];
	let cursor: string | undefined;
	do {
		const page: any = await executeRemoteSyncCommand({ action: 'status', ...(cursor ? { cursor } : {}) }, context, { ...session, roots });
		assert.ok(page.roots.length <= 32);
		all.push(...page.roots.map((root: any) => root.id));
		cursor = page.nextCursor;
	} while (cursor);
	assert.deepEqual(all, roots.map(root => root.id));
});

test('a conflict finish cannot approve choices changed since the browser displayed them', async () => {
	let finished = false;
	const controller = { getSnapshot: () => ({ page: { progress: { revision: 8 } } }), finish: async () => { finished = true; } };
	snapshot = { scope, active: true, progress: { stage: 'reviewing', confirmed: 0, total: 1 }, pagedReview: controller };
	const status: any = await executeRemoteSyncCommand({ action: 'status' }, context, session);
	await assert.rejects(executeRemoteSyncCommand({ action: 'review', connectionId: 'connection', reviewId: status.task.review.id,
		operation: 'finish', resolution: 'resolve', revision: 7 }, context, session), /choices changed/);
	assert.equal(finished, false);
});

test('remote Pause acknowledges through an independent transport after aborting its borrowed native host', async () => {
	nativeAbort = new AbortController(); paused = null;
	const activeHost = { ...host, assertCurrent: () => nativeAbort!.signal.throwIfAborted(),
		fetch: async () => { nativeAbort!.signal.throwIfAborted(); throw Error('A borrowed task transport must not carry mailbox requests.'); } };
	snapshot = { scope, active: true, host: activeHost, progress: { stage: 'transferring', confirmed: 0, total: 1 } };
	const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const completed: any[] = [];
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: scope.origin }, fetch: async (url: URL, init: any) => {
		const target = new URL(url);
		if (target.pathname === '/api/v1/things') {
			assert.equal(target.searchParams.get('id'), saved.id);
			assert.equal(nativeAbort?.signal.aborted, true, 'stop the live task before looking up durable Pause state');
			return Response.json({ thing: saved });
		}
		const body = JSON.parse(init.body);
		if (body.action === 'poll') return Response.json({ ok: true, command: { id: 'request', leaseId: 'lease', expiresAt: new Date(Date.now() + 10000).toISOString(), command: { action: 'pause', connectionId: 'connection' } } });
		completed.push(body); return Response.json({ ok: true, status: 'complete' });
	} } });
	const abort = new AbortController(), stop = startRemoteSyncWorker('owner', 0, abort.signal);
	try {
		const deadline = Date.now() + 2000;
		while (!completed.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
		assert.deepEqual(paused, scope);
		assert.equal(pausedRevision, saved.updatedAt);
		assert.equal(nativeAbort.signal.aborted, true);
		assert.deepEqual(completed[0]?.result, { accepted: true });
		assert.equal(completed[0]?.leaseId, 'lease');
	} finally { abort.abort(); stop(); if (original) Object.defineProperty(globalThis, 'window', original); else delete (globalThis as any).window; nativeAbort = undefined; }
});


test('remote status preserves exact optional native source locations and legacy absence', async () => {
 snapshot = null;
 const roots = [{ id: 'selected', name: 'Music library', sourcePath: '/Volumes/Drive/Music library' }, { id: 'legacy', name: 'Legacy folder' }];
 const page: any = await executeRemoteSyncCommand({ action: 'status' }, context, { ...session, roots });
 assert.deepEqual(page.roots.find((root: any) => root.id === 'selected'), roots[0]);
 assert.equal(Object.hasOwn(page.roots.find((root: any) => root.id === 'legacy'), 'sourcePath'), false);
});


test('older server or native versions strip optional paths while status and folder controls continue', async () => {
 snapshot = null;
 const roots = [{ id: 'selected', name: 'Music library', sourcePath: '/Volumes/Drive/Music library' }];
 for (const nativeVersion of ['1.14.0', '1.15.0']) {
  let negotiations: string[] = [];
  const older = { ...host, capabilities: { platform: 'macos', fileAccessVersion: nativeVersion },
   requireCapability: async (_feature: string, minimum: string) => { negotiations.push(minimum); throw Error('old server'); },
   request: async () => ({ roots }) };
  const contextOld = { ...context, host: older }, sessionOld = { ...session, host: older, roots };
  const page: any = await executeRemoteSyncCommand({ action: 'status' }, contextOld, sessionOld);
  assert.deepEqual(page.roots, [{ id: 'selected', name: 'Music library' }]);
  const folders: any = await executeRemoteSyncCommand({ action: 'folders', request: { action: 'list' } }, contextOld, sessionOld);
  assert.deepEqual(folders.roots, page.roots);
  assert.deepEqual(negotiations, nativeVersion === '1.14.0' ? ['1.5.0', '1.6.0'] : ['1.5.0', '1.6.0', '1.1.0']);
  assert.equal(page.connectionActivityVersion, undefined);
  assert.equal(page.folderEnrollmentRecoveryVersion, undefined);
  assert.equal(sessionOld.roots[0].sourcePath, roots[0].sourcePath);
 }
});

test('resources use owner/device authorization while paused, without folders or jobs; status samples once', async () => {
 snapshot = null; started = null; const requests: any[] = [], negotiations: string[] = [], authorizations: any[] = [];
 const policy = { transferBytesPerSecond: 500000, scanBytesPerSecond: 400000, cpuPercent: 12 };
 const resources = { version: 1, cpuPercent: 0, cpuStatus: 'measured', cpuScopes: ['source-thread'], effectiveTransferConcurrency: 1, effectiveIndexingConcurrency: 1, memoryBytes: 1000, measuredAt: 100 };
 const resourceHost = { ...host, capabilities: { platform: 'macos', fileAccessVersion: '1.16.0', fileResourceLimitsVersion: '1.1.0' },
  requireCapability: async (_f: string, v: string) => { negotiations.push(v); }, authorizeDevice: async (...args: any[]) => { authorizations.push(args.slice(0,2)); },
  request: async (owner: string, request: any) => { assert.equal(owner, 'owner'); requests.push(request); return { roots: [], deviceResourceLimits: policy, resources }; } };
 const c = { ...context, host: resourceHost }, s = { ...session, host: resourceHost };
 const result = await executeRemoteSyncCommand({ action: 'resources', operation: 'save', deviceResourceLimits: policy }, c, s);
 const { deviceResourceKey, readDeviceSyncResourcePolicy } = await import('./deviceResourcePolicy');
 assert.deepEqual(readDeviceSyncResourcePolicy(deviceResourceKey(scope.origin, 'owner', 'device')), policy, 'Active selected-device hosts must not overwrite remotely accepted policy with stale renderer preferences');
 assert.deepEqual(result, { deviceResourceLimits: policy, resources }); assert.equal(started, null); assert.deepEqual(requests, [{ action: 'resources', deviceResourceLimits: policy }]); assert.deepEqual(authorizations, [['owner','device']]);
 const page: any = await executeRemoteSyncCommand({ action: 'status' }, c, s); assert.deepEqual(page.resourceUsage, result);
 await executeRemoteSyncCommand({ action: 'status', cursor: '32' }, c, s); assert.equal(requests.length, 2); assert.ok(negotiations.includes('1.2.0'));
 await assert.rejects(executeRemoteSyncCommand({ action: 'resources', operation: 'read' }, { ...c, host: { ...resourceHost, capabilities: { ...resourceHost.capabilities, fileResourceLimitsVersion: '1.0.0' } } }, s), /Update the selected Mac/);
});


test('history worker reads the real source journal for its authorized owner, origin and device', async () => {
 const range = { from: 1000, to: 5000, bucketCount: 2 };
 historyFactory = new IDBFactory();
 let authorizations = 0;
 try {
  const journal = await openRealSyncJournal(historyFactory, 'worker-history', IDBKeyRange);
  try {
   const sample = { at: 1100, status: 'running' as const, uploadMbps: 0, downloadMbps: 1, scanMbps: null, cpuPercent: null, memoryBytes: null };
   await journal.deviceHistory({ scope, assertCurrent() {} }).append(sample);
   await journal.deviceHistory({ scope: { ...scope, origin: 'https://other.test' }, assertCurrent() {} }).append({ ...sample, downloadMbps: 9 });
  } finally { journal.close(); }
  const authorizedHost = {
   ...host,
   authorizeDevice: async (owner: string, device: string) => {
    assert.equal(owner, scope.ownerId); assert.equal(device, scope.deviceId); authorizations++;
   },
   requireCapability: async (feature: string, version: string) => {
    assert.equal(feature, 'api.devices-sync-control'); assert.equal(version, '1.4.0');
   }
  };
  const result: any = await executeRemoteSyncCommand({ action: 'history', range }, { ...context, host: authorizedHost }, session);
  assert.equal(authorizations, 1);
  assert.equal(result.sampleCount, 1);
  assert.equal(result.latest.downloadMbps, 1);
  assert.equal(result.buckets[1].downloadMbps, null);
  await assert.rejects(executeRemoteSyncCommand({ action: 'history', range }, {
   ...context, host: { ...authorizedHost, authorizeDevice: async () => { throw Error('The device was unpaired'); } }
  }, session), /unpaired/);
 } finally { historyFactory = undefined; }
});


test('a bounded pending history read does not queue Pause behind it and worker teardown cancels it', async () => {
 const windowBefore = Object.getOwnPropertyDescriptor(globalThis, 'window');
 const completions: any[] = [];
 let historyStarted = false, historyAborted = false, polls = 0;
 delayedHistory = signal => new Promise((_resolve, reject) => {
  historyStarted = true;
  signal.addEventListener('abort', () => { historyAborted = true; reject(signal.reason); }, { once: true });
 });
 const next = [
  { id: 'history', leaseId: 'history-lease', command: { action: 'history', range: { from: 0, to: 5000, bucketCount: 5 } } },
  { id: 'pause', leaseId: 'pause-lease', command: { action: 'pause', connectionId: scope.rootId } }
 ];
 snapshot = { scope, active: true, host, progress: { stage: 'transferring', confirmed: 0, total: 1 } }; paused = null;
 Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: scope.origin }, fetch: async (url: URL, init: any) => {
  if (new URL(url).pathname === '/api/v1/things') return Response.json({ thing: saved });
  const body = JSON.parse(init.body);
  if (body.action === 'poll') {
   const pending = next[polls++];
   return Response.json({ ok: true, command: pending ? { ...pending, expiresAt: new Date(Date.now() + 20_000).toISOString() } : null });
  }
  completions.push(body);
  return Response.json({ ok: true });
 } } });
 const controller = new AbortController(), stop = startRemoteSyncWorker(scope.ownerId, 0, controller.signal);
 try {
  const until = Date.now() + 6000;
  while (!completions.length && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(historyStarted, true);
  assert.deepEqual(paused, scope);
  assert.equal(completions[0]?.requestId, 'pause');
  assert.deepEqual(completions[0]?.result, { accepted: true });
  assert.equal(historyAborted, false);
  controller.abort();
  assert.equal(historyAborted, true);
 } finally {
  controller.abort(); stop(); delayedHistory = undefined; snapshot = null;
  if (windowBefore) Object.defineProperty(globalThis, 'window', windowBefore); else delete (globalThis as any).window;
 }
});

test('remote Pause cancels only its timed enrollment while source device consent is pending', { timeout: 12000 }, async () => {
 const windowBefore = Object.getOwnPropertyDescriptor(globalThis, 'window');
 const completions: { requestId: string; leaseId: string; result?: unknown; error?: string }[] = [];
 let enrollments = 0, polls = 0, enrolmentAborted = false, unrelatedPauseAborted = false;
 delayedEnrollment = signal => new Promise((_resolve, reject) => {
  enrollments++;
  signal.addEventListener('abort', () => { enrolmentAborted = true; reject(signal.reason); }, { once: true });
 });
 const start = { action: 'start', connectionId: saved.id, expectedUpdatedAt: saved.updatedAt, intervalMs: 300000 };
 const next = [
  { id: 'start', leaseId: 'start-lease', command: start },
  { id: 'unrelated', leaseId: 'unrelated-lease', command: { action: 'pause', connectionId: 'other-connection' } },
  { id: 'overlap', leaseId: 'overlap-lease', command: start },
  { id: 'pause', leaseId: 'pause-lease', command: { action: 'pause', connectionId: saved.id } }
 ];
 snapshot = null; paused = null;
 Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: scope.origin }, fetch: async (url: URL, init: { body?: unknown }) => {
  const target = new URL(url);
  if (target.pathname === '/api/v1/things') return Response.json({ ok: true, thing: { ...saved, id: target.searchParams.get('id') } });
  const body = JSON.parse(String(init.body));
  if (body.action === 'poll') {
   const pending = next[polls++];
   return Response.json({ ok: true, command: pending ? { ...pending, expiresAt: new Date(Date.now() + 20000).toISOString() } : null });
  }
  if (body.requestId === 'unrelated') unrelatedPauseAborted = enrolmentAborted;
  completions.push(body);
  return Response.json({ ok: true });
 } } });
 const controller = new AbortController(), stop = startRemoteSyncWorker(scope.ownerId, 0, controller.signal);
 try {
  const until = Date.now() + 10000;
  while (completions.length < next.length && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
  const completed = (id: string) => completions.find(row => row.requestId === id);
  assert.equal(enrollments, 1);
  assert.equal(unrelatedPauseAborted, false);
  assert.deepEqual(completed('unrelated')?.result, { accepted: true });
  assert.match(completed('overlap')?.error ?? '', /confirming another automatic sync setup/);
  assert.equal(enrolmentAborted, true);
  assert.deepEqual(paused, scope);
  assert.deepEqual(completed('pause')?.result, { accepted: true });
  assert.equal(completed('start')?.leaseId, 'start-lease');
  assert.match(completed('start')?.error ?? '', /setup was paused/);
 } finally {
  controller.abort(); stop(); delayedEnrollment = undefined; snapshot = null;
  if (windowBefore) Object.defineProperty(globalThis, 'window', windowBefore); else delete (globalThis as any).window;
 }
});

test('remote config activity reads exact private history and shares only authorized summaries through status', async () => {
 historyFactory = new IDBFactory();
 const journal = await openRealSyncJournal(historyFactory, 'worker-history', IDBKeyRange);
 const foreign = { ...scope, rootId: 'another-config' };
 const old = { id: 'old', startedAt: 10, endedAt: 20, lastActivityAt: 20, status: 'complete' as const, sentBytes: 0, receivedBytes: null };
 const latest = { ...old, id: 'latest', startedAt: 30, endedAt: 40, lastActivityAt: 40, sentBytes: 25 };
 const syncJob = { id: saved.id, updatedAt: saved.updatedAt, configuration };
 await journal.jobs({ scope, currentScope: () => scope }).admit(syncJob, 'admitted');
 await journal.jobs({ scope: foreign, currentScope: () => foreign }).admit({ ...syncJob, id: foreign.rootId }, 'other');
 await journal.syncActivity({ scope, currentScope: () => scope }).append(old);
 await journal.syncActivity({ scope, currentScope: () => scope }).append(latest);
 await journal.syncActivity({ scope: foreign, currentScope: () => foreign }).append({ ...latest, id: 'private', sentBytes: 500 });
 journal.close();
 let visible: unknown = saved;
 let authorized = 0, batchReads = 0;
 const live = { startedAt: 51, lastActivityAt: 52, sentBytes: null, receivedBytes: 11 };
 snapshot = { scope, active: true, activity: live, progress: { stage: 'transferring', confirmed: 0, total: 1 } };
 const readHost = { ...host, authorizeDevice: async () => { authorized++; },
  fetch: async (url: URL) => {
   assert.equal(url.origin, scope.origin);
   if (url.searchParams.has('ids')) {
    batchReads++;
    const ids = JSON.parse(url.searchParams.get('ids')!);
    assert.deepEqual(ids, ['another-config', saved.id]);
    return Response.json({ ok: true, things: [{ ...saved, id: foreign.rootId, crystal: { ...configuration, deviceId: 'other-device' } }, visible] });
   }
   assert.equal(url.searchParams.get('id'), saved.id);
   return Response.json({ ok: true, thing: visible });
  }
 };
 const c = { ...context, host: readHost };
 try {
  const first: any = await executeRemoteSyncCommand({ action: 'connection-activity', connectionId: saved.id, limit: 1 }, c, session);
  assert.deepEqual(first, { connectionId: saved.id, records: [latest], next: { id: 'latest', endedAt: 40 } });
  assert.deepEqual(await executeRemoteSyncCommand({ action: 'connection-activity', connectionId: saved.id, limit: 1, before: first.next }, c, session),
   { connectionId: saved.id, records: [old], next: null });
  assert.equal(authorized, 2);
  const status: any = await executeRemoteSyncCommand({ action: 'status' }, c, session);
  assert.equal(status.connectionActivityVersion, '1.0.0');
  assert.deepEqual(status.task.activity, live);
  assert.equal(status.jobs.find((job: any) => job.connectionId === foreign.rootId).activity, undefined);
  assert.deepEqual(status.jobs.find((job: any) => job.connectionId === saved.id).activity, latest);
  assert.equal(batchReads, 1);
  for (const changed of [{ ...saved, acl: ['tt:public'] }, { ...saved, author: { id: 'foreign' } }, { ...saved, crystal: { ...configuration, deviceId: 'foreign' } }]) {
   visible = changed;
   await assert.rejects(executeRemoteSyncCommand({ action: 'connection-activity', connectionId: saved.id }, c, session), /private configuration|selected device/);
  }
  const denied: any = await executeRemoteSyncCommand({ action: 'status' }, c, session);
  assert.equal(denied.task.activity, undefined);
  assert.equal(denied.jobs.find((job: any) => job.connectionId === saved.id).activity, undefined);
 } finally { historyFactory = undefined; snapshot = null; }
});
