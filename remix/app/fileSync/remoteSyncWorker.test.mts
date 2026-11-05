import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal as openRealSyncJournal } from './journal.client';
import { newFileSyncConfiguration } from './configuration';

const scope = { ownerId: 'owner', deviceId: 'device', origin: 'https://sync.test', dataPlane: 'home', rootId: 'connection' };
let historyFactory: IDBFactory | undefined;
let delayedHistory: ((signal: AbortSignal) => Promise<unknown>) | undefined;
let snapshot: any = null, paused: any = null, started: any = null, nativeAbort: AbortController | undefined;
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
	pauseNativeSyncJob: async (binding: any) => { paused = binding; nativeAbort?.abort(); snapshot = null; }
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
	assert.deepEqual(result, { accepted: true });
	assert.deepEqual(started.binding, scope);
	assert.equal(started.interval, 300000);
	assert.equal(snapshot.active, true);
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
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: scope.origin }, fetch: async (_url: unknown, init: any) => {
		const body = JSON.parse(init.body);
		if (body.action === 'poll') return Response.json({ ok: true, command: { id: 'request', leaseId: 'lease', expiresAt: new Date(Date.now() + 10000).toISOString(), command: { action: 'pause', connectionId: 'connection' } } });
		completed.push(body); return Response.json({ ok: true, status: 'complete' });
	} } });
	const abort = new AbortController(), stop = startRemoteSyncWorker('owner', 0, abort.signal);
	try {
		const deadline = Date.now() + 2000;
		while (!completed.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
		assert.deepEqual(paused, scope);
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
  let negotiations = 0;
  const older = { ...host, capabilities: { platform: 'macos', fileAccessVersion: nativeVersion },
   requireCapability: async (_feature: string, minimum: string) => { negotiations++; assert.equal(minimum, '1.1.0'); throw Error('old server'); },
   request: async () => ({ roots }) };
  const contextOld = { ...context, host: older }, sessionOld = { ...session, host: older, roots };
  const page: any = await executeRemoteSyncCommand({ action: 'status' }, contextOld, sessionOld);
  assert.deepEqual(page.roots, [{ id: 'selected', name: 'Music library' }]);
  const folders: any = await executeRemoteSyncCommand({ action: 'folders', request: { action: 'list' } }, contextOld, sessionOld);
  assert.deepEqual(folders.roots, page.roots);
  assert.equal(negotiations, nativeVersion === '1.14.0' ? 0 : 1);
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
 Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: scope.origin }, fetch: async (_url: unknown, init: any) => {
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
