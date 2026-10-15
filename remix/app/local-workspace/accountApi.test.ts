import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { accountApi, resolveAccountWebpage } from './accountApi.client';
import { bindLocalWorkspace, workspaceDatabase } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';

test('account local facade and native page resolution work offline without uploading anonymous content', async () => {
 const oldWindow = globalThis.window, oldFactory = globalThis.indexedDB, oldFetch = globalThis.fetch;
 const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
 const target = new EventTarget(), scope = { kind: 'account', origin: 'https://thingtime.example', ownerId: 'owner', dataPlane: 'home' } as const;
 Object.assign(globalThis, { window: { location: { origin: scope.origin }, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target) }, indexedDB: new IDBFactory(), fetch: async () => { throw new Error('Unexpected network'); } });
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
 let remoteCalls = 0; const remote = async (..._args: any[]) => { remoteCalls++; return { ok: true }; };
 try {
  bindLocalWorkspace(false, rootIdentity.read().generation, scope);
  const api = accountApi({ actions: { run: remote }, things: { create: remote, update: remote, get: remote, list: remote } }, { id: scope.ownerId }, scope.dataPlane);
  const component: any = await api.things.create({ thingtime: ['component'], crystal: { name: 'Card', componentKey: 'card', version: 1, render: { tag: 'p', children: 'Locally rendered' } } } as any);
  const page: any = await api.things.create({ thingtime: ['webpage'], crystal: { name: 'Offline page', blocks: [{ id: 'card', type: 'component', component: 'card' }] } } as any);
  const resolved = await resolveAccountWebpage(scope, { kind: 'id', id: page.id });
  assert.equal(resolved.page.id, page.id); assert.equal(resolved.refs.card, component.id); assert.equal(resolved.components[0].crystal.render.children, 'Locally rendered');
  assert.equal((await api.things.get({ id: page.id } as any) as any).thing.crystal.name, 'Offline page');
  assert.equal(remoteCalls, 0);
  await assert.rejects(api.things.update({ id: page.id, attachmentIds: ['attachment'], crystal: {} } as any), /online adapter/);
  await api.things.create({ thingtime: ['data'], crystal: {}, attachmentIds: ['attachment'] } as any); assert.equal(remoteCalls, 1, 'unsupported creates retain the complete existing remote adapter');
  bindLocalWorkspace(false, rootIdentity.read().generation, scope, false);
  const offlineEdit: any = await api.things.update({ id: page.id, crystal: { name: 'Cold offline account' } });
  assert.equal(offlineEdit.thing.crystal.name, 'Cold offline account');
  const library: any = await api.things.list({ limit: 1 });
  assert.equal(library.incomplete, true); assert.equal(library.things.length, 1); assert.ok(library.nextCursor.startsWith('device:'));
  const secondPage: any = await api.things.list({ limit: 1, cursor: library.nextCursor });
  assert.equal(secondPage.things.length, 1); assert.notEqual(secondPage.things[0].id, library.things[0].id);
  assert.equal((await api.things.list({ thingtime: 'webpage' }) as any).things[0].id, page.id);
  await assert.rejects(api.things.get({ id: 'not-cached' }), /offline/);
  await assert.rejects(api.things.create({ thingtime: ['data'], crystal: {}, attachmentIds: ['attachment'] }), /offline/);
  await assert.rejects(async () => api.actions.run({}), /offline/);
  assert.equal(remoteCalls, 1, 'unconfirmed account cannot fall through to any remote adapter');
  rootIdentity.changed(); bindLocalWorkspace(true, rootIdentity.read().generation); rootIdentity.confirm(rootIdentity.read().generation);
  await assert.rejects(api.things.create({ thingtime: ['data'], crystal: {} } as any), /workspace changed/i);
  await assert.rejects(api.things.get({ id: page.id, key: 'old-key' } as any), /workspace changed/i);
  assert.equal(remoteCalls, 1);
  const anonymous = await workspaceDatabase().transaction({ kind: 'anonymous' }, 'readonly', { assertCurrent() {}, onInvalidate: () => () => {} }, tx => tx.list('things'));
  assert.equal(anonymous.length, 0);
 } finally {
  rootIdentity.changed(); await workspaceDatabase().close();
  Object.assign(globalThis, { window: oldWindow, indexedDB: oldFactory, fetch: oldFetch });
  if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
 }
});
