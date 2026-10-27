import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { accountWorkspaceWorker } from './accountApi.client';
import { bindLocalWorkspace, workspaceDatabase } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { readCatalogueStream, writeCatalogueStream, type CatalogueSink } from '../catalogue/catalogueStream';

test('reconnect retries failed theme reads inside the refresh throttle without granting home content authority', async () => {
 const original = { window: globalThis.window, indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange, fetch: globalThis.fetch };
 const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
 const target = new EventTarget(), nav = { onLine: true };
 const scope = { kind: 'account', origin: 'https://theme-reconnect.example', ownerId: 'owner', dataPlane: 'custom-' + 'a'.repeat(64) } as const;
 let externalRequests = 0, snapshots = 0, selections = 0, genericPasses = 0;
 Object.assign(globalThis, {
  window: { location: { origin: scope.origin }, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target) },
  indexedDB: new IDBFactory(), IDBKeyRange, fetch: async () => { externalRequests++; throw Error('Unexpected network'); }
 });
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav });
 rootIdentity.changed(); bindLocalWorkspace(false, rootIdentity.read().generation, scope); rootIdentity.confirm(rootIdentity.read().generation);
 const worker = accountWorkspaceWorker(scope, { localPlane: 'home' });
 const emptyCatalogue = async (domain: 'themes' | 'algorithms', sink: CatalogueSink, signal: AbortSignal) => {
  const identity = { domain, origin: scope.origin, ownerId: scope.ownerId, dataPlane: scope.dataPlane, storagePlane: 'home' } as const;
  const chunks: Uint8Array[] = [];
  await writeCatalogueStream({ ...identity, version: 1, generation: 'reconnect-fixture' }, (async function* () {})(), async bytes => { chunks.push(bytes); }, { signal });
  return readCatalogueStream(new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close(); } }), identity, sink, { signal });
 };
 try {
  worker.themeTransport.catalogue = async (sink, signal) => { snapshots++; if (snapshots === 1) throw Error('Temporary catalogue failure'); return emptyCatalogue('themes', sink, signal); };
  worker.themeTransport.selection = async () => { selections++; if (selections === 1) throw Error('Temporary selection failure'); return { themeId: null, version: 'theme-selection-v1:' + 'a'.repeat(64) }; };
  worker.algorithmWorker!.transport.catalogue = (sink, signal) => emptyCatalogue('algorithms', sink, signal);
  worker.algorithmWorker!.transport.selection = async () => ({ algorithmId: null, version: 'algorithm-selection-v1:' + 'a'.repeat(64) });
  worker.sync.sync = async () => { genericPasses++; throw Error('The selected custom plane does not authorize generic home sync'); };
  await Promise.all([worker.refreshThemes(true), worker.refreshThemeSelection(true)]);
  assert.ok(worker.themeErrors.catalog); assert.ok(worker.themeErrors.selection);
  nav.onLine = false; target.dispatchEvent(new Event('offline'));
  nav.onLine = true; target.dispatchEvent(new Event('online'));
  await Promise.all([worker.refreshThemes(), worker.refreshThemeSelection()]);
  assert.equal(snapshots, 2); assert.equal(selections, 2);
  assert.equal(worker.themeErrors.catalog, ''); assert.equal(worker.themeErrors.selection, '');
  assert.equal(genericPasses, 0); assert.equal(externalRequests, 0);
  rootIdentity.changed();
  target.dispatchEvent(new Event('online'));
  assert.equal(snapshots, 2); assert.equal(selections, 2, 'retired workers never refresh after another online event');
 } finally {
  worker.stop(); rootIdentity.changed(); await workspaceDatabase().close(); Object.assign(globalThis, original);
  if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
 }
});
