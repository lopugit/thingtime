import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.execArgv.includes('--experimental-test-module-mocks')) {
 test('policy discovery never reopens terminal jobs sharing a runnable device', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', 'tsx', '--test', fileURLToPath(import.meta.url)], { env, encoding: 'utf8', timeout: 30000 });
  assert.equal(child.status, 0, child.stdout + child.stderr);
 });
} else {
 test('same-device policy changes resume only runnable and scheduled admissions', async () => {
  const origin = 'https://policy-recovery.test', calls: string[] = [], reads: string[] = [];
  const bridge = { platform: 'ios', fileUploadPolicyVersion: '1.1.0' };
  const adapter = { platform: 'ios', bridge };
  const configuration = { configurationVersion: 1, name: 'Backup', deviceId: 'device', localRootId: 'folder', remoteFolderId: 'cloud', sourceKind: 'folder', mode: 'backup', paused: false, propagateDeletes: false, network: 'wifi', chargingOnly: false, excludedPaths: [] };
  const jobs = ['complete', 'attention', 'paused', 'runnable', 'scheduled'].map(state => ({
   id: state, state, scope: { origin, ownerId: 'owner', deviceId: 'device', rootId: state, dataPlane: 'home' },
   reviewed: { id: state, updatedAt: 'old', configuration },
   ...(state === 'scheduled' ? { intervalMs: 60000, nextRunAt: Date.now() + 60000 } : {})
  }));
  const module = async (path: string, namedExports: Record<string, unknown>) => (mock as any).module(new URL(path, import.meta.url).href, { namedExports });
  await module('../activity/activityManager.ts', { activityManager: { enabled: () => true } });
  await module('../utils/rootIdentity.ts', { rootIdentity: { read: () => ({ pending: false, generation: 0 }) } });
  await module('./syncEnrollmentRecovery.client.ts', { recoverSavedSyncEnrollments: async () => ({ pendingLocalIntents: 0, durableProgress: false }) });
  await module('./journal.client.ts', { openSyncJournal: async () => ({ close() {}, jobs: () => ({ list: async () => ({ jobs }) }) }) });
  await module('./nativeSyncHost.client.ts', { getNativeSyncAdapter: () => adapter, isNativeSyncAdapterCurrent: () => true, createNativeSyncHost: async () => ({ origin: () => origin }) });
  await module('./nativeSyncTasks.client.ts', {
   nativeSyncTasks: { read: () => undefined, isPaused: () => false },
   readNativeConfiguration: async (_host: unknown, scope: {rootId:string}) => {
    reads.push(scope.rootId);
    return { id: scope.rootId, updatedAt: 'new', configuration: { ...configuration, configurationVersion: 5, uploadPolicy: { uploadBytesPerSecond: 2000000 } } };
   },
   startNativeSyncTask: async (saved: {id:string}) => { calls.push(saved.id); }
  });
  await module('./configuredPlan.ts', { readOwnedFileSyncConfiguration: (value: unknown) => value });
  const beforeWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), beforeDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin } } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible' } });
  try {
   const { resumeNativeSyncJobs } = await import('./NativeSyncBootstrap');
   await resumeNativeSyncJobs('owner', 0, new AbortController().signal, true);
   assert.deepEqual(calls, ['runnable', 'scheduled']);
   assert.deepEqual(reads, ['runnable', 'scheduled'], 'terminal admissions must not enter policy recovery even when another config selects their device');
  } finally {
   if (beforeWindow) Object.defineProperty(globalThis, 'window', beforeWindow); else Reflect.deleteProperty(globalThis, 'window');
   if (beforeDocument) Object.defineProperty(globalThis, 'document', beforeDocument); else Reflect.deleteProperty(globalThis, 'document');
  }
 });
}
