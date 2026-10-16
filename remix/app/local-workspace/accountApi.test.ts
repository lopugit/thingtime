import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { accountApi, accountWorkspaceWorker, resolveAccountWebpage } from './accountApi.client';
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
  bindLocalWorkspace(false, rootIdentity.read().generation, scope); rootIdentity.confirm(rootIdentity.read().generation);
  const api = accountApi({ actions: { run: remote }, things: { create: remote, update: remote, get: remote, list: remote, search: remote, bulk: remote } }, { id: scope.ownerId }, scope.dataPlane);
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
  const matches: any = await api.things.search({ workspace: true, q: 'cold offline' });
  const structured: any = await api.things.search({ workspace: true, device: true, conditions: [{ field: 'name', op: 'contains', value: 'cold' }] });
  assert.equal(structured.things[0].id, page.id); assert.equal(structured.incomplete, true); assert.equal(structured.source, 'device');
  assert.equal(matches.things[0].id, page.id); assert.equal(matches.things[0].author.id, scope.ownerId); assert.equal(matches.incomplete, true);
  await assert.rejects(api.things.search({ workspace: true, q: 'cold offline', cursor: 'server-cursor' }), /Reload/);
  await assert.rejects(api.things.get({ id: 'not-cached' }), /offline/);
  await assert.rejects(api.things.create({ thingtime: ['data'], crystal: {}, attachmentIds: ['attachment'] }), /offline/);
  await assert.rejects(async () => api.actions.run({}), /offline/);
  let refusal: Promise<unknown> | undefined;
  assert.doesNotThrow(() => { refusal = api.actions.run({}); });
  await assert.rejects(refusal!, /offline/, 'promise-based callers must catch authority refusals without crashing the route');
  const destination: any = await api.things.create({ thingtime: ['folder'], crystal: { name: 'Offline destination' } });
  const moved: any = await api.things.bulk({ op: 'move', ids: [page.id, component.id], folderId: destination.id });
  assert.equal(moved.savedLocally, true); assert.equal(moved.succeeded, 2);
  assert.equal((await api.things.list({ folder: destination.id }) as any).things.length, 2);
  assert.equal((await api.things.list({ folder: 'root', thingtime: 'webpage' }) as any).things.length, 0);
  await assert.rejects(api.things.bulk({ op: 'move', ids: [page.id, page.id], folderId: null }), /distinct Things/);
  await assert.rejects(api.things.bulk({ op: 'move', ids: [page.id], folderId: 'not-cached' }), /online once/);
  await assert.rejects(api.things.bulk({ op: 'move', ids: [page.id], folderId: destination.id, acl: ['tt:public'] } as any), /distinct Things/);
  assert.equal((await api.things.get({ id: page.id }) as any).thing.folderId, destination.id);
  await api.things.bulk({ op: 'move', ids: [page.id, component.id], folderId: null });
  assert.equal((await api.things.list({ folder: destination.id }) as any).things.length, 0);
  assert.equal(remoteCalls, 1, 'unconfirmed account cannot fall through to any remote adapter');
  await api.things.bulk({ op: 'delete', ids: [destination.id] });
  assert.equal((await api.things.list({ folder: 'root' }) as any).things.some((row: any) => row.id === destination.id), false);
  await api.things.bulk({ op: 'delete', ids: [page.id] });
  // Browser online hints can stay true after an offline reload. The verified
  // workspace binding, not that hint, decides whether a remote resolve may run.
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  assert.equal((await resolveAccountWebpage(scope, { kind: 'global' })).page, null);
  assert.equal((await resolveAccountWebpage(scope, { kind: 'path', path: '/ode' })).page, null);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  assert.equal((await api.things.list({ thingtime: 'webpage' }) as any).things.length, 0);
  rootIdentity.changed(); bindLocalWorkspace(true, rootIdentity.read().generation); rootIdentity.confirm(rootIdentity.read().generation);
  await assert.rejects(api.things.create({ thingtime: ['data'], crystal: {} } as any), /workspace changed/i);
  await assert.rejects(api.things.get({ id: page.id, key: 'old-key' } as any), /workspace changed/i);
  await assert.rejects(api.things.search({ workspace: true, device: true }), /workspace changed/i);
  assert.equal(remoteCalls, 1);
  const anonymous = await workspaceDatabase().transaction({ kind: 'anonymous' }, 'readonly', { assertCurrent() {}, onInvalidate: () => () => {} }, tx => tx.list('things'));
  assert.equal(anonymous.length, 0);
 } finally {
  rootIdentity.changed(); await workspaceDatabase().close();
  Object.assign(globalThis, { window: oldWindow, indexedDB: oldFactory, fetch: oldFetch });
  if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
 }
});


test('account library search paints local content first, refreshes only its owner, and retires late responses', async () => {
 const oldWindow = globalThis.window, oldFactory = globalThis.indexedDB, oldFetch = globalThis.fetch;
 const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
 const target = new EventTarget(), scope = { kind: 'account', origin: 'https://thingtime.example', ownerId: 'search-owner', dataPlane: 'home' } as const;
 const nav = { onLine: false };
 Object.assign(globalThis, { window: { location: { origin: scope.origin }, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target) }, indexedDB: new IDBFactory(), fetch: async () => { throw new Error('Unexpected sync request'); } });
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav });
 let release!: (value: any) => void, remoteQuery: any, batchReads = 0;
 const response = () => new Promise(resolve => { release = resolve; });
 const remoteSearch = async (args: any) => { remoteQuery = args; if (args.q === 'Pending batch') { batchReads++; return { ok: true, things: [], nextCursor: null, total: 0 }; } return response(); };
 try {
  bindLocalWorkspace(false, rootIdentity.read().generation, scope); rootIdentity.confirm(rootIdentity.read().generation);
  const api = accountApi({ things: { search: remoteSearch } }, { id: scope.ownerId, username: 'alice' }, scope.dataPlane) as any;
  const sync = accountWorkspaceWorker(scope).sync;
  const local = await sync.things.create({ thingtime: ['data'], crystal: { name: 'Card pending' } });
  nav.onLine = true;
  let finish!: (value: any) => void;
  const refreshed = new Promise<any>(resolve => { finish = resolve; });
  const initial = await api.things.search({ workspace: true, q: 'card' }, { onRefresh: finish });
  assert.equal(initial.things[0].id, local.id); assert.equal(initial.refreshing, true);
  assert.equal(remoteQuery.author, 'alice'); assert.equal(remoteQuery.workspace, undefined);
  // The search response races a newer local edit; it must not resurrect its old match.
  await sync.things.update({ id: local.id, crystal: { name: 'Changed while search ran' } });
  const remoteRow = { id: 'owned-remote-card', thingtime: ['data'], crystal: { name: 'Card from account' }, author: { id: scope.ownerId }, createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z', acl: ['tt:user'], visibility: 'private' };
  release({ ok: true, things: [remoteRow], nextCursor: null, total: 1 });
  const fresh = await refreshed;
  assert.deepEqual(fresh.things.map((row: any) => row.id), [remoteRow.id]);
  assert.equal((await sync.view(remoteRow.id))?.crystal.name, 'Card from account');
  for (let n = 0; n < 3; n++) await sync.things.create({ thingtime: ['data'], crystal: { name: `Pending batch ${n}` } });
  const first = await api.things.search({ workspace: true, q: 'Pending batch', limit: 1 });
  const second = await api.things.search({ workspace: true, q: 'Pending batch', limit: 1, cursor: first.nextCursor });
  const third = await api.things.search({ workspace: true, q: 'Pending batch', limit: 1, cursor: second.nextCursor });
  assert.equal(new Set([...first.things, ...second.things, ...third.things].map((row: any) => row.id)).size, 3);
  assert.equal(third.nextCursor, null); assert.equal(batchReads, 1, 'pending-only continuation needs no remote page');
  // The library sends its account scope so a plain-remote facade (signed in, no
  // resolved data plane) stays owner-scoped. This adapter accepts that argument
  // but must never let it widen or redirect the workspace's own remote read.
  await api.things.search({ workspace: true, q: 'Pending batch', author: 'mallory', limit: 1 });
  assert.equal(remoteQuery.author, 'alice'); assert.equal(remoteQuery.workspace, undefined);
  await assert.rejects(api.things.search({ workspace: true, q: 'Other query', cursor: first.nextCursor }), /scope or filters/);
  const remoteFirst = api.things.search({ workspace: true, q: 'card', limit: 1 });
  while (remoteQuery.q !== 'card') await new Promise(resolve => setTimeout(resolve, 0));
  release({ ok: true, things: [remoteRow], nextCursor: 'remote-page-two', total: 2 });
  const remotePage = await remoteFirst;
  const nextRefresh = new Promise<any>(resolve => { finish = resolve; });
  const interim = await api.things.search({ workspace: true, q: 'card', limit: 1, cursor: remotePage.nextCursor }, { onRefresh: finish });
  assert.deepEqual(interim.things, [], 'continuations retain displayed results without appending the cached first page');
  assert.equal(remoteQuery.cursor, 'remote-page-two');
  const secondRemoteRow = { ...remoteRow, id: 'owned-remote-card-two', crystal: { name: 'Card two' } };
  release({ ok: true, things: [secondRemoteRow], nextCursor: null, total: 2 });
  assert.deepEqual((await nextRefresh).things.map((row: any) => row.id), [secondRemoteRow.id]);
  nav.onLine = false;
  assert.ok((await api.things.search({ workspace: true, q: 'card' })).things.some((row: any) => row.id === remoteRow.id));
  assert.equal((await workspaceDatabase().transaction({ kind: 'anonymous' }, 'readonly', { assertCurrent() {}, onInvalidate: () => () => {} }, tx => tx.list('things'))).length, 0);
  nav.onLine = true;
  let stale = 0;
  await api.things.search({ workspace: true, q: 'card' }, { onRefresh: () => stale++, onError: () => stale++ });
  rootIdentity.changed(); bindLocalWorkspace(true, rootIdentity.read().generation); rootIdentity.confirm(rootIdentity.read().generation);
  release({ ok: true, things: [remoteRow] });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(stale, 0);
  await assert.rejects(api.things.search({ workspace: true, q: 'card' }), /workspace changed/i);
 } finally {
  rootIdentity.changed(); await workspaceDatabase().close();
  Object.assign(globalThis, { window: oldWindow, indexedDB: oldFactory, fetch: oldFetch });
  if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
 }
});

test('account folder lists overlay pending placement on fresh and cached pages without remote bulk writes', async () => {
 const saved = { window: globalThis.window, indexedDB: globalThis.indexedDB, fetch: globalThis.fetch }, oldNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
 const target = new EventTarget(), scope = { kind: 'account', origin: 'https://thingtime.example', ownerId: 'move-owner', dataPlane: 'home' } as const;
 const nav = { onLine: false }, requests: string[] = []; let remoteBulk = 0;
 const row = (id: string, kind = 'data', folderId: string | null = null) => ({ id, thingtime: [kind], crystal: { name: id }, folderId, createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z', author: { id: scope.ownerId }, acl: ['tt:user'], visibility: 'private', revision: 1 });
 const first = row('owned-move-source'), folder = row('owned-move-folder', 'folder'), foreign = { ...row('foreign'), author: { id: 'other-account' } };
 Object.assign(globalThis, { window: { location: { origin: scope.origin }, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target) }, indexedDB: new IDBFactory(), fetch: async (input: string, init?: RequestInit) => {
  const url = new URL(input, scope.origin);
  if (url.pathname.includes('capabilities')) return Response.json({ schemaVersion: 1, origin: scope.origin, features: { 'api.things': { version: '1.33.0' }, 'api.things-update': { version: '1.10.0' }, 'api.mongodb-endpoint': { version: '1.1.0' } } });
  requests.push(`${init?.method || 'GET'} ${url.pathname}`); assert.equal(init?.method, 'GET');
  assert.equal(new Headers(init?.headers).get('X-Thingtime-Expected-Actor'), scope.ownerId);
  assert.equal(new Headers(init?.headers).get('X-Thingtime-Expected-Data-Plane'), scope.dataPlane);
  return Response.json(url.searchParams.has('id') ? { ok: true, thing: foreign } : { ok: true, things: url.searchParams.get('folder') === folder.id ? [] : [first, folder], nextCursor: null });
 } });
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav });
 try {
  bindLocalWorkspace(false, rootIdentity.read().generation, scope); rootIdentity.confirm(rootIdentity.read().generation);
  const api = accountApi({ things: { bulk: async () => { remoteBulk++; return { ok: true }; } } }, { id: scope.ownerId }, scope.dataPlane) as any;
  const sync = accountWorkspaceWorker(scope).sync; await sync.remember(first); await sync.remember(folder);
  await api.things.bulk({ op: 'move', ids: [first.id], folderId: folder.id }); nav.onLine = true;
  assert.deepEqual((await api.things.list({ folder: 'root' })).things.map((x: any) => x.id), [folder.id]);
  assert.deepEqual((await api.things.list({ folder: folder.id })).things.map((x: any) => x.id), [first.id]);
  assert.deepEqual((await api.things.list({ folder: 'root' })).things.map((x: any) => x.id), [folder.id], 'cached page also excludes moved rows');
  await assert.rejects(api.things.bulk({ op: 'move', ids: [first.id, foreign.id], folderId: null }), /separately/);
  assert.equal((await sync.view(first.id))!.folderId, folder.id); assert.equal(remoteBulk, 0);
  nav.onLine = false; await api.things.bulk({ op: 'move', ids: [first.id], folderId: null }); nav.onLine = true;
  assert.ok((await api.things.list({ folder: 'root' })).things.some((x: any) => x.id === first.id));
  assert.deepEqual((await api.things.list({ folder: folder.id })).things, []);
  assert.ok(requests.length > 0); assert.ok(requests.every(request => request.startsWith('GET ')));
 } finally {
  rootIdentity.changed(); await workspaceDatabase().close(); Object.assign(globalThis, saved);
  if (oldNav) Object.defineProperty(globalThis, 'navigator', oldNav); else Reflect.deleteProperty(globalThis, 'navigator');
 }
});

test('cached account page membership survives deletion and explicit conflict restoration', async () => {
 const oldWindow = globalThis.window, oldFactory = globalThis.indexedDB, oldFetch = globalThis.fetch;
 const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
 const target = new EventTarget(), scope = { kind: 'account', origin: 'https://thingtime.example', ownerId: 'restore-owner', dataPlane: 'home' } as const;
 const nav = { onLine: false };
 Object.assign(globalThis, { window: { location: { origin: scope.origin }, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target) }, indexedDB: new IDBFactory(), fetch: async () => { throw new Error('Unexpected network'); } });
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav });
 try {
  bindLocalWorkspace(false, rootIdentity.read().generation, scope); rootIdentity.confirm(rootIdentity.read().generation);
  const api = accountApi({ things: {} }, { id: scope.ownerId }, scope.dataPlane) as any;
  const worker = accountWorkspaceWorker(scope), sync = worker.sync;
  const row: any = { id: 'restore-fixture', thingtime: ['data'], crystal: { name: 'Original' }, author: { id: scope.ownerId }, createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z', acl: ['tt:user'], visibility: 'private' };
  await sync.remember(row); await sync.remove([row.id]);
  const remote = { ...row, crystal: { name: 'Changed elsewhere' }, updatedAt: '2026-10-16T00:00:01.000Z' };
  const transport = { get: async () => remote, remove: async () => { throw { status: 409 }; }, write: async () => { throw new Error('Unexpected write'); } };
  await sync.sync(transport); assert.equal((await sync.status())[0].state, 'conflict');
  worker.transport.read = async () => ({ ok: true, things: [structuredClone(remote)], nextCursor: null });
  nav.onLine = true;
  assert.deepEqual((await api.things.list({ folder: 'root' })).things, []);
  const review = await sync.inspectConflict(transport, row.id);
  await sync.resolveConflict(transport, { id: row.id, keep: 'remote', localRevision: review.localRevision, remoteUpdatedAt: review.remote.updatedAt });
  // With no usable background refresh, cached membership must still expose the
  // restored row immediately. Do not make restoration depend on a second GET.
  worker.transport.read = async () => { throw new Error('Read unavailable'); };
  assert.equal((await api.things.list({ folder: 'root' })).things[0].crystal.name, 'Changed elsewhere');
 } finally {
  rootIdentity.changed(); await workspaceDatabase().close();
  Object.assign(globalThis, { window: oldWindow, indexedDB: oldFactory, fetch: oldFetch });
  if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
 }
});

test('a mixed dedicated-adapter delete never removes a cached device copy remotely', async () => {
 const oldWindow = globalThis.window, oldFactory = globalThis.indexedDB, oldFetch = globalThis.fetch;
 const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
 const target = new EventTarget(), scope = { kind: 'account', origin: 'https://thingtime.example', ownerId: 'mixed-owner', dataPlane: 'home' } as const;
 Object.assign(globalThis, { window: { location: { origin: scope.origin }, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target) }, indexedDB: new IDBFactory(), fetch: async () => { throw new Error('Unexpected network'); } });
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
 let remoteDeletes = 0;
 try {
  bindLocalWorkspace(false, rootIdentity.read().generation, scope); rootIdentity.confirm(rootIdentity.read().generation);
  const api = accountApi({ things: { bulk: async () => { remoteDeletes++; return { ok: true }; } } }, { id: scope.ownerId }, scope.dataPlane) as any;
  const worker = accountWorkspaceWorker(scope), sync = worker.sync;
  const row: any = { id: 'cached-ordinary', thingtime: ['data'], crystal: { name: 'Cached' }, author: { id: scope.ownerId }, createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z', acl: ['tt:user'], visibility: 'private' };
  await sync.remember(row);
  // 'vault' is not a locally cacheable kind, so this id needs its dedicated adapter.
  worker.transport.read = async () => ({ ok: true, thing: { ...row, id: 'needs-adapter', thingtime: ['vault'] }, nextCursor: null });
  // Falling back here would delete the cached copy on the server while leaving it
  // readable on this device, with nothing left to re-read and correct it.
  await assert.rejects(api.things.bulk({ op: 'delete', ids: [row.id, 'needs-adapter'] }), /separately/);
  assert.equal(remoteDeletes, 0, 'a mixed batch must not reach the remote bulk adapter');
  assert.equal((await sync.view(row.id))?.crystal.name, 'Cached', 'the cached device copy survives the refusal');
  // A batch with no cached device copy still uses the dedicated online adapter.
  assert.deepEqual(await api.things.bulk({ op: 'delete', ids: ['needs-adapter'] }), { ok: true });
  assert.equal(remoteDeletes, 1);
 } finally {
  rootIdentity.changed(); await workspaceDatabase().close();
  Object.assign(globalThis, { window: oldWindow, indexedDB: oldFactory, fetch: oldFetch });
  if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
 }
});
