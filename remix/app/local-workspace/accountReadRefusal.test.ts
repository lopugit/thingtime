import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { accountApi, accountWorkspaceWorker } from './accountApi.client';
import { bindLocalWorkspace, workspaceDatabase, LOCAL_WORKSPACE_CHANGED } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';

test('cached ordinary Thing refresh retires definitive refusals but preserves offline use after session and network failures', { timeout: 10000 }, async () => {
 const saved = { window: globalThis.window, indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
 const target = new EventTarget(), nav = { onLine: true };
 const scope = { kind: 'account', origin: 'https://thingtime.example', ownerId: 'refusal-owner', dataPlane: 'home' } as const;
 Object.assign(globalThis, { window: { location: { origin: scope.origin }, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target) }, indexedDB: new IDBFactory(), IDBKeyRange });
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav });
 try {
  bindLocalWorkspace(false, rootIdentity.read().generation, scope); rootIdentity.confirm(rootIdentity.read().generation);
  const api: any = accountApi({ things: {} }, { id: scope.ownerId }, scope.dataPlane);
  const worker = accountWorkspaceWorker(scope);
  const forget = worker.posts.forget.bind(worker.posts), read = worker.transport.read.bind(worker.transport); let refusals = 0;
  worker.posts.forget = async id => { refusals++; return forget(id); };
  for (const status of [401,503,403,404,410]) {
   nav.onLine = true;
   const row = { id: `component-${status}`, thingtime: ['component'], crystal: { name: 'Retained component', componentKey: `card-${status}`, version: 1, render: { tag: 'p', children: 'Retained text' } }, author: { id: scope.ownerId }, acl: ['tt:user'], visibility: 'private', createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z' } as any;
   await worker.sync.remember(row);
   worker.transport.read = async () => { throw { status }; };
   const definitive = [403,404,410].includes(status);
   const changed = definitive ? new Promise<void>(resolve => {
    const listener = (event: Event) => { if ((event as any).removedIds?.includes(row.id)) { target.removeEventListener(LOCAL_WORKSPACE_CHANGED, listener); resolve(); } };
    target.addEventListener(LOCAL_WORKSPACE_CHANGED, listener);
   }) : Promise.resolve();
   assert.equal((await api.things.get({ id: row.id })).thing.crystal.name, 'Retained component', 'cached first paint remains immediate');
   await changed;
   nav.onLine = false;
   worker.transport.read = read;
   if (definitive) {
    assert.equal(await worker.sync.view(row.id), null);
   } else {
    assert.equal(refusals, 0, 'session expiry and transient failure must not become content revocation');
    assert.equal((await api.things.get({ id: row.id })).thing.id, row.id);
   }
  }
  assert.equal(refusals, 3);
 } finally {
  rootIdentity.changed(); await workspaceDatabase().close();
  Object.assign(globalThis, { window: saved.window, indexedDB: saved.indexedDB, IDBKeyRange: saved.IDBKeyRange });
  if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator); else Reflect.deleteProperty(globalThis, 'navigator');
 }
});
