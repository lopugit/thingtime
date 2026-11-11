import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { nativeBridgeMessageEvent, type ThingtimeNativeBridge } from '../utils/nativeBridge';
import { configurationDraftKey, claimSyncEnrollment } from './configurationEditor';
import { parseFileSyncConfiguration } from './configuration';
import type { SyncJob } from './syncJobJournal';

for (const scenario of ['fresh', 'legacy', 'legacy-occupied', 'paused', 'changed-cloud']) test(`natural saved-enrollment recovery: ${scenario}`, async () => {
 const scope = { origin: 'https://startup.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'device' };
 let privateReads = 0;
 const saved = { id: scenario, updatedAt: '2026-11-11T00:01:00Z', configuration: parseFileSyncConfiguration({ configurationVersion: 1,
  name: 'Backup', deviceId: 'device', localRootId: 'root', remoteFolderId: 'cloud', mode: 'backup', propagateDeletes: false,
  paused: false, network: 'any', chargingOnly: false, excludedPaths: [] }) };
 const entries = new Map<string, string>([[configurationDraftKey(scope), JSON.stringify({ version: 1, id: saved.id, baseUpdatedAt: saved.updatedAt,
  configuration: saved.configuration, exclusions: '', pending: true, enrollment: { transport: 'local', intervalMs: 300000, savedRevision: saved.updatedAt } })]]);
 const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); },
  removeItem: (key: string) => { entries.delete(key); }, key: (index: number) => [...entries.keys()][index] ?? null, get length() { return entries.size; } };
 const requests: Record<string, unknown>[] = [];
 const page = Object.assign(new EventTarget(), { location: { origin: scope.origin }, localStorage: storage,
  fetch: (async (target: string | URL, init?: RequestInit) => {
   const url = new URL(String(target), scope.origin);
   if (url.pathname === '/.well-known/thingtime-capabilities.json') return Response.json({ schemaVersion: 1, origin: scope.origin, features: { 'api.things': { version: '1.64.0' } } });
   assert.equal(url.pathname, '/api/v1/things');
   assert.equal(new Headers(init?.headers).get('X-Thingtime-Expected-Actor'), scope.ownerId);
   privateReads++;
   return Response.json({ thing: { id: saved.id, author: { id: scope.ownerId }, acl: ['tt:user'], thingtime: ['file-sync'], updatedAt: scenario === 'changed-cloud' && privateReads > 1 ? '2026-11-11T00:02:00Z' : saved.updatedAt, crystal: saved.configuration } });
  }) as typeof fetch, thingtimeNativeBridge: undefined as ThingtimeNativeBridge | undefined });
 page.thingtimeNativeBridge = { version: '1.0.0', platform: 'ios', isNativeWebView: true, devicePairingVersion: '1.2.0',
  fileAccessVersion: '1.3.1', fileStagingVersion: '1.2.0', filePublicationVersion: '1.2.0', postMessage(message) {
   const payload = message.payload as Record<string, unknown>; requests.push(payload);
   assert.equal(message.type, 'mobile-device'); assert.equal(payload.action, 'status');
   setTimeout(() => page.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, { detail: { type: 'mobile-device-result',
    payload: { ...payload, state: 'paired', deviceId: scope.deviceId } } })), 300);
  } };
 const globals = { window: page, document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
  navigator: { locks: { request: async (_key: string, options: { signal?: AbortSignal }, run: () => Promise<unknown>) => { options.signal?.throwIfAborted(); return run(); } } },
  indexedDB: new IDBFactory(), IDBKeyRange, fetch: page.fetch };
 const before = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
 for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
 try {
  const { recoverSavedSyncEnrollments } = await import('./syncEnrollmentRecovery.client');
  const { getNativeSyncAdapter } = await import('./nativeSyncHost.client');
  const { openSyncJournal } = await import('./journal.client');
  const binding = { ...scope, rootId: saved.id };
  let prior: SyncJob | null = null;
  if (scenario !== 'fresh') {
   const journal = await openSyncJournal();
   try {
    const jobs = journal.jobs({ scope: binding, currentScope: () => binding });
    const old = { ...saved, updatedAt: '2026-11-11T00:00:00Z', configuration: { ...saved.configuration, mode: 'two-way' as const } };
    prior = await jobs.transition(await jobs.admit(old, 'original-' + scenario, 300000, undefined, undefined, { previous: null, pendingFolderValidation: true }), 'attention');
    if (scenario === 'paused') { const { pauseNativeSyncJob } = await import('./nativeSyncTasks.client'); await pauseNativeSyncJob(binding, 0); prior = await jobs.read(); }
   } finally { journal.close(); }
  }
  const { nativeSyncTasks } = await import('./nativeSyncTasks.client');
  let releaseLane: (() => void) | undefined;
  const occupied = scenario === 'legacy-occupied' ? nativeSyncTasks.start({ ...binding, rootId: 'other-running-config' },
   async () => await new Promise<void>(resolve => { releaseLane = resolve; })) : undefined;
  try { await recoverSavedSyncEnrollments(scope.ownerId, 0, new AbortController().signal, getNativeSyncAdapter()); }
  finally { releaseLane?.(); await occupied; }
  assert.equal(requests.length, scenario === 'paused' ? 0 : scenario === 'fresh' ? 1 : 2, 'each private authority check has one native status; none replay');
  const succeeds = scenario === 'fresh' || scenario.startsWith('legacy');
  assert.equal(storage.getItem(configurationDraftKey(scope)) === null, succeeds, 'intent clears only after durable verified admission');
  const journal = await openSyncJournal();
  try { const jobs = journal.jobs({ scope: binding, currentScope: () => binding }), job = await jobs.read();
   if (succeeds) {
    assert.equal(job?.state, 'runnable'); assert.equal(job?.pendingFolderValidation, true); assert.deepEqual(job?.reviewed, saved); assert.equal(job?.intervalMs, 300000);
    if (prior) { assert.equal(job?.id, prior.id); assert.deepEqual((await jobs.setupRecovery(prior.id, prior.revision))?.previous, prior); }
   } else { assert.deepEqual(job, prior); assert.equal(await jobs.setupRecovery(prior!.id, prior!.revision), null); }
  } finally { journal.close(); }
  const release = claimSyncEnrollment(scope); assert.ok(release, 'actual recovery finally releases its claim'); release();
 } finally {
  for (const [key, descriptor] of before) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
 }
});
