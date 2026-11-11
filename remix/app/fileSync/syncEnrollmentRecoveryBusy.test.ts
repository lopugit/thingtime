import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { nativeBridgeMessageEvent, type ThingtimeNativeBridge } from '../utils/nativeBridge';
import { configurationDraftKey, claimSyncEnrollment } from './configurationEditor';
import { parseFileSyncConfiguration } from './configuration';

test('natural saved-enrollment recovery waits for queued native startup status and durably admits its exact config', async () => {
 const scope = { origin: 'https://startup.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'device' };
 const saved = { id: 'connection', updatedAt: '2026-11-11T00:00:00Z', configuration: parseFileSyncConfiguration({ configurationVersion: 1,
  name: 'Backup', deviceId: 'device', localRootId: 'root', remoteFolderId: 'cloud', mode: 'backup', propagateDeletes: false,
  paused: false, network: 'any', chargingOnly: false, excludedPaths: [] }) };
 const entries = new Map<string, string>([[configurationDraftKey(scope), JSON.stringify({ version: 1, id: saved.id, baseUpdatedAt: saved.updatedAt,
  configuration: saved.configuration, exclusions: '', pending: true, enrollment: { transport: 'local', intervalMs: 300000, savedRevision: saved.updatedAt } })]]);
 const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); },
  removeItem: (key: string) => { entries.delete(key); }, key: (index: number) => [...entries.keys()][index] ?? null, get length() { return entries.size; } };
 const requests: Record<string, unknown>[] = [];
 const page = Object.assign(new EventTarget(), { location: { origin: scope.origin }, localStorage: storage,
  fetch: (async (target: string | URL) => {
   const url = new URL(String(target), scope.origin);
   if (url.pathname === '/.well-known/thingtime-capabilities.json') return Response.json({ schemaVersion: 1, origin: scope.origin, features: { 'api.things': { version: '1.64.0' } } });
   assert.equal(url.pathname, '/api/v1/things');
   return Response.json({ thing: { id: saved.id, author: { id: scope.ownerId }, acl: ['tt:user'], thingtime: ['file-sync'], updatedAt: saved.updatedAt, crystal: saved.configuration } });
  }) as typeof fetch, thingtimeNativeBridge: undefined as ThingtimeNativeBridge | undefined });
 page.thingtimeNativeBridge = { version: '1.0.0', platform: 'ios', isNativeWebView: true, devicePairingVersion: '1.1.0',
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
  await recoverSavedSyncEnrollments(scope.ownerId, 0, new AbortController().signal, getNativeSyncAdapter());
  assert.equal(requests.length, 1, 'native queue owns contention; renderer never replays status');
  assert.equal(storage.getItem(configurationDraftKey(scope)), null, 'exact saved intent clears only after durable admission');
  const journal = await openSyncJournal();
  try { const binding = { ...scope, rootId: saved.id }, job = await journal.jobs({ scope: binding, currentScope: () => binding }).read();
   assert.equal(job?.state, 'runnable'); assert.equal(job?.pendingFolderValidation, true); assert.deepEqual(job?.reviewed, saved); assert.equal(job?.intervalMs, 300000);
  } finally { journal.close(); }
  const release = claimSyncEnrollment(scope); assert.ok(release, 'actual recovery finally releases its claim'); release();
 } finally {
  for (const [key, descriptor] of before) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
 }
});
