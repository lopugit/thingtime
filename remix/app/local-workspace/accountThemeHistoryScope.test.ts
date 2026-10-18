import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { accountApi } from './accountApi.client';
import { bindLocalWorkspace, workspaceDatabase } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { localTimelineBackend, scopedTimelineStore } from '../timeline/localBackend.client';
import { themeContentValue } from '../timeline/themeContent';

test('Home History reads and exports device theme edits while a custom plane is selected, with the current account lease', async () => {
 const saved = { window: globalThis.window, indexedDB: globalThis.indexedDB, fetch: globalThis.fetch, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
 const target = new EventTarget(), factory = new IDBFactory();
 const account = { kind: 'account', ownerId: 'theme-owner', origin: 'https://theme-history.test', dataPlane: 'custom-selected' } as const;
 const home = { ownerId: account.ownerId, apiOrigin: account.origin, dataPlane: 'home' };
 Object.assign(globalThis, { indexedDB: factory, window: { indexedDB: factory, location: { origin: account.origin },
  addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target) } });
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
 let requests = 0;
 const remote = async () => { requests++; throw Error('Unexpected account request'); };
 globalThis.fetch = remote;
 try {
  bindLocalWorkspace(false, rootIdentity.read().generation, account, false); rootIdentity.confirm(rootIdentity.read().generation);
  const selected: any = accountApi({ timeline: { exportVersion: remote } }, { id: account.ownerId }, account.dataPlane);
  const homeApi: any = accountApi({ timeline: { exportVersion: remote } }, { id: account.ownerId }, account.dataPlane, { localPlane: 'home' });
  const theme = (await homeApi.themes.save({ name: 'Home device edit', theme: {} })).theme;
  const store = scopedTimelineStore(home), [entry] = await store.forThing(theme.id);
  assert.ok(entry, 'Home History must include authored home rows, not only downloaded cache');
  assert.equal(entry.receipt, null); assert.equal(entry.event.after?.adapter, 'theme-content');
  assert.equal(selected.timeline.canExportLocally(home), true);
  const result = await selected.timeline.exportVersion(home, entry.event.id);
  assert.equal(themeContentValue(result.export.content).crystal.name, 'Home device edit');
  assert.equal(result.export.receipt, null); assert.equal(requests, 0);
  for (const other of [{ ...home, ownerId: 'other' }, { ...home, apiOrigin: 'https://other.test' }, { ...home, dataPlane: 'custom-unselected' }]) {
   assert.equal(selected.timeline.canExportLocally(other), false);
   assert.deepEqual(await scopedTimelineStore(other).forThing(theme.id), []);
   await assert.rejects(selected.timeline.exportVersion(other, entry.event.id), /offline/);
  }
  bindLocalWorkspace(false, rootIdentity.read().generation, { ...account, dataPlane: 'custom-next' }, false);
  await assert.rejects(store.forThing(theme.id), /workspace changed/i);
  await assert.rejects(selected.timeline.exportVersion(home, entry.event.id), /workspace changed/i);
  assert.throws(result.assertAvailable, /workspace changed/i);
  assert.equal((await scopedTimelineStore(home).forThing(theme.id)).length, 1, 'new selection can reacquire the same owner home partition');
  rootIdentity.changed(); bindLocalWorkspace(true, rootIdentity.read().generation);
  assert.deepEqual(await scopedTimelineStore(home).forThing(theme.id), []);
  assert.equal(requests, 0);
 } finally {
  rootIdentity.changed(); await localTimelineBackend().close(); await workspaceDatabase().close();
  Object.assign(globalThis, { window: saved.window, indexedDB: saved.indexedDB, fetch: saved.fetch });
  if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator); else Reflect.deleteProperty(globalThis, 'navigator');
 }
});
