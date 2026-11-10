import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { accountApi } from './accountApi.client';
import { bindLocalWorkspace, canSyncAccountWorkspace, workspaceDatabase } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';

test('Home theme views read shared themes under selected authority and retire in-flight reads on identity change', { timeout: 15_000 }, async () => {
 const original = { window: globalThis.window, indexedDB: globalThis.indexedDB, fetch: globalThis.fetch };
 const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
 const events = new EventTarget(), nav = { onLine: false };
 const scope = { kind: 'account', origin: 'https://theme-public.test', ownerId: 'owner', dataPlane: 'custom-selected' } as const;
 const calls: { method: string; input: unknown; options: { signal: AbortSignal; expectedActor: string; expectedDataPlane: string; expectedApiOrigin: string } }[] = [];
 let complete: ((value: unknown) => void) | undefined;
 Object.assign(globalThis, { indexedDB: new IDBFactory(), fetch: async () => { throw Error('Unexpected background request'); },
  window: { location: { origin: scope.origin }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) } });
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav });
 rootIdentity.changed(); bindLocalWorkspace(false, rootIdentity.read().generation, scope); rootIdentity.confirm(rootIdentity.read().generation);
 const remote = (method: string) => async (input: unknown, options: (typeof calls)[number]['options']) => {
  calls.push({ method, input, options });
  if ((input as { id?: string })?.id === 'pending') return new Promise(resolve => { complete = resolve; });
  return method === 'getShared' ? { ok: true, theme: { id: 'public', name: 'Shared design' } } : { ok: true, themes: [] };
 };
 try {
  const api = accountApi({ themes: { getShared: remote('getShared'), listShared: remote('listShared') }, things: { get: remote('get') } }, { id: scope.ownerId }, scope.dataPlane, { localPlane: 'home' }) as any;
  const saved = (await api.themes.save({ name: 'Local Home design', theme: {} })).theme;
  assert.equal((await api.themes.getShared({ id: saved.id })).theme.name, saved.name);
  assert.equal(calls.length, 0, 'retained Home themes remain available offline without requests');
  nav.onLine = true;
  assert.equal(canSyncAccountWorkspace({ ...scope, dataPlane: 'home' }), false, 'a local Home view grants no generic Home authority');
  assert.equal((await api.themes.getShared({ id: 'public' })).theme.name, 'Shared design');
  assert.deepEqual(await api.themes.listShared({ limit: 3 }), { ok: true, themes: [] });
  assert.deepEqual(calls.map(call => call.method), ['getShared', 'listShared']);
  for (const { options } of calls) {
   assert.equal(options.expectedActor, scope.ownerId); assert.equal(options.expectedDataPlane, scope.dataPlane);
   assert.equal(options.expectedApiOrigin, scope.origin); assert.equal(options.signal.aborted, false);
  }
  await assert.rejects(api.things.get({ id: 'unretained-home' }), /workspace changed|not saved on this device/i);
  assert.equal(calls.length, 2, 'the shared-theme read exception cannot authorize generic Home requests');
  bindLocalWorkspace(false, rootIdentity.read().generation, scope, false);
  await assert.rejects(api.themes.listShared(), /offline|confirm your account/i);
  assert.equal(calls.length, 2);
  bindLocalWorkspace(false, rootIdentity.read().generation, scope, true);
  const pending = api.themes.getShared({ id: 'pending' });
  while (!complete) await new Promise(resolve => setTimeout(resolve, 0));
  const last = calls.at(-1)!;
  rootIdentity.changed();
  assert.equal(last.options.signal.aborted, true);
  complete({ ok: true, theme: { id: 'pending', name: 'Former account result' } });
  await assert.rejects(pending, /workspace changed/i);
  await assert.rejects(api.themes.getShared({ id: saved.id }), /workspace changed/i);
  await assert.rejects(api.themes.listShared(), /workspace changed/i);
  assert.equal(calls.length, 3);
 } finally {
  rootIdentity.changed(); await workspaceDatabase().close(); Object.assign(globalThis, original);
  if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
 }
});
