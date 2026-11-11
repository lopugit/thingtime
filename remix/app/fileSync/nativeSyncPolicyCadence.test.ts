import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

if (!process.execArgv.includes('--experimental-test-module-mocks')) {
 test('native policy migration preserves automatic cadence through completion and reload', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', 'tsx', '--test', fileURLToPath(import.meta.url)], { env, encoding: 'utf8', timeout: 30000 });
  assert.equal(child.status, 0, child.stdout + child.stderr);
 });
} else {
 test('actual task admission retains prior interval unless the caller explicitly replaces it', async () => {
  const origin = 'https://cadence.test', root = '00000000-0000-4000-8000-000000000001';
  let passes = 0, current: any;
  const bridge = { platform: 'ios', fileAccessVersion: '1.5.0', fileUploadVersion: '1.6.0', fileUploadPolicyVersion: '1.0.0' };
  const adapter = { platform: 'ios', bridge };
  const module = async (path: string, namedExports: Record<string, unknown>) => (mock as any).module(new URL(path, import.meta.url).href, { namedExports });
  await module('../activity/activityManager.ts', { activityManager: { enabled: () => true, register: () => () => {} } });
  await module('../utils/rootIdentity.ts', { rootIdentity: { read: () => ({ pending: false, generation: 0 }), subscribe: () => () => {} } });
  await module('./pagedForegroundSync.ts', { runPagedForegroundCloudSync: async (_saved: unknown, _scope: unknown, input: any) => {
   passes++; input.progress({ stage: 'complete', confirmed: 0, total: 0 }); return { progress: { phase: 'complete' } };
  } });
  const fetch = async (target: URL) => target.pathname === '/api/v1/things'
   ? Response.json({ thing: { id: current.id, updatedAt: current.updatedAt, crystal: current.configuration, acl: ['tt:user'], thingtime: ['file-sync'], author: { id: 'owner' } } })
   : Response.json({ ok: true, folder: { id: 'cloud-root', revision: 'r1', name: 'Destination', folderId: null } });
  await module('./nativeSyncHost.client.ts', {
   getNativeSyncAdapter: () => adapter, isNativeSyncAdapterCurrent: () => true,
   createNativeSyncHost: async () => ({ origin: () => origin, capabilities: bridge, assertCurrent() {}, authorizeDevice: async () => {}, fetch, requireCapability: async () => {},
    request: async () => ({ roots: [{ id: root, name: 'Folder' }], conditions: { network: 'wifi', charging: true }, cancelled: true }) })
  });
  const globals = { window: Object.assign(new EventTarget(), { location: { origin } }), document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
   navigator: { locks: { request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run() } }, indexedDB: new IDBFactory(), IDBKeyRange };
  const before = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
   const { openSyncJournal } = await import('./journal.client');
   const { startNativeSyncTask, nativeSyncTasks } = await import('./nativeSyncTasks.client');
   for (const explicit of [undefined, 900000]) {
    const scope = { origin, ownerId: 'owner', deviceId: 'device', rootId: explicit ? 'explicit' : 'inherited', dataPlane: 'home' };
    const old = { id: scope.rootId, updatedAt: '2026-11-11T00:00:00Z', configuration: { configurationVersion: 1, name: 'Backup', deviceId: 'device', localRootId: root, remoteFolderId: 'cloud-root', sourceKind: 'folder', mode: 'backup', paused: false, propagateDeletes: false, network: 'wifi', chargingOnly: false, excludedPaths: [] } };
    current = { ...old, updatedAt: '2026-11-11T00:01:00Z', configuration: { ...old.configuration, configurationVersion: 5, uploadPolicy: { uploadBytesPerSecond: 2000000 } } };
    let journal = await openSyncJournal();
    let jobs = journal.jobs({ scope, currentScope: () => scope });
    const prior = await jobs.admit(old as any, 'old-' + scope.rootId, 300000);
    await startNativeSyncTask(current, scope, 0, prior, explicit);
    assert.equal(nativeSyncTasks.read()?.status, 'complete', nativeSyncTasks.read()?.progress.message);
    journal.close(); journal = await openSyncJournal(); jobs = journal.jobs({ scope, currentScope: () => scope });
    const restored = (await jobs.read())!;
    assert.equal(restored.state, 'scheduled');
    assert.equal(restored.intervalMs, explicit ?? 300000);
    assert.deepEqual(restored.reviewed, current);
    const clock = mock.method(Date, 'now', () => restored.nextRunAt! + 1);
    try { await startNativeSyncTask(current, scope, 0, restored); } finally { clock.mock.restore(); }
    assert.equal((await jobs.read())?.state, 'scheduled');
    assert.equal((await jobs.read())?.intervalMs, explicit ?? 300000);
    journal.close();
   }
   assert.equal(passes, 4, 'both migrated schedules run again after completion and durable reload');
  } finally {
   for (const [key, descriptor] of before) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
 });
}
