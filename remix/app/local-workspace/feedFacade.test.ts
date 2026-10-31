import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { anonymousApi } from './api.client';
import { accountApi, accountWorkspaceWorker } from './accountApi.client';
import { anonymousWorkspaceDatabase, bindLocalWorkspace, workspaceDatabase } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { WorkspaceError } from './storage';

const retained = (id: string, changes: Record<string, unknown> = {}) => ({ id, type: 'text', thingtime: ['post'], text: id, tags: ['art'], visibility: 'private', acl: ['tt:private'], createdAt: '2026-10-20T12:00:00.000Z', author: { id: 'other', username: 'other', displayName: null, avatarUrl: null }, comments: [], images: [], attachments: [], ...changes });

test('anonymous feed reads owned roots offline, trains its local profile and fences retired facades', async () => {
 const before = { window: globalThis.window, indexedDB: globalThis.indexedDB, fetch: globalThis.fetch, IDBKeyRange: globalThis.IDBKeyRange, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
 let network = 0;
 Object.assign(globalThis, { window: { dispatchEvent() {}, location: { origin: 'https://anonymous-feed.test' } }, indexedDB: new IDBFactory(), IDBKeyRange, fetch: async () => { network++; throw new TypeError('Offline'); } });
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
 bindLocalWorkspace(true, rootIdentity.read().generation);
 try {
  const api: any = anonymousApi({ things: {}, algorithms: {} });
  const a = await api.things.create({ type: 'text', text: 'Offline art', tags: ['art'] });
  const b = await api.things.create({ type: 'text', text: 'Offline science', tags: ['science'] });
  await api.things.comment({ id: a.id, text: 'A reply' });
  const brain = (await api.algorithms.create({ name: 'Local art' })).algorithm;
  const page = await api.things.feed({ algorithm: brain.id, limit: 1 });
  assert.equal(page.source, 'device'); assert.equal(page.incomplete, true); assert.equal(page.localRanking, true); assert.ok(page.nextCursor);
  const next = await api.things.feed({ algorithm: brain.id, cursor: page.nextCursor, limit: 1 });
  assert.deepEqual(new Set([...page.posts, ...next.posts].map(row => row.id)), new Set([a.id, b.id]));
  await api.algorithms.track({ algorithmId: brain.id, events: [{ thingId: page.posts[0].id, signal: 'view' }] });
  assert.ok((await api.algorithms.list()).algorithms.find(row => row.id === brain.id).eventCount > 0);
  assert.deepEqual((await api.things.feed({ tag: 'art' })).posts.map(row => row.id), [a.id]);
  assert.equal(network, 0);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  assert.equal((await api.things.feed({ device: true })).posts.length, 2); assert.equal(network, 0, 'explicit device mode never requests public discovery');
  rootIdentity.changed(); bindLocalWorkspace(false, rootIdentity.read().generation); rootIdentity.confirm(rootIdentity.read().generation);
  await assert.rejects(api.things.feed({ device: true }), /Workspace changed/);
 } finally {
  rootIdentity.changed(); bindLocalWorkspace(false, rootIdentity.read().generation); rootIdentity.confirm(rootIdentity.read().generation);
  await anonymousWorkspaceDatabase().close();
  Object.assign(globalThis, { window: before.window, indexedDB: before.indexedDB, fetch: before.fetch, IDBKeyRange: before.IDBKeyRange });
  if (before.navigator) Object.defineProperty(globalThis, 'navigator', before.navigator); else delete (globalThis as any).navigator;
 }
});

test('account feed merges owned work and retained reads without restoring refused, deleted or foreign-plane posts', async () => {
 const before = { window: globalThis.window, indexedDB: globalThis.indexedDB, fetch: globalThis.fetch, IDBKeyRange: globalThis.IDBKeyRange, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
 const events = new EventTarget(), scope = { kind: 'account', ownerId: 'owner', origin: 'https://account-feed.test', dataPlane: 'home' } as const;
 let remoteCalls = 0, response: unknown = new TypeError('Connection lost');
 const remote = { things: { feed: async () => { remoteCalls++; throw response; } } };
 Object.assign(globalThis, { window: { location: { origin: scope.origin }, dispatchEvent: events.dispatchEvent.bind(events), addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) }, indexedDB: new IDBFactory(), IDBKeyRange, fetch: async () => { throw new TypeError('Offline'); } });
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
 bindLocalWorkspace(false, rootIdentity.read().generation, scope); rootIdentity.confirm(rootIdentity.read().generation);
 try {
  const api: any = accountApi(remote, { id: scope.ownerId, username: 'owner' }, scope.dataPlane), worker = accountWorkspaceWorker(scope);
  const own = await api.things.create({ type: 'text', text: 'Authored here', tags: ['art'] });
  const deleted = await api.things.create({ type: 'text', text: 'Deleted here' });
  await worker.posts.remember([retained('retained'), retained('refused'), retained(deleted.id), retained(own.id, { text: 'Stale remote content' }), retained('comment', { thingtime: ['post', 'comment'], targetId: 'retained' })]);
  await api.things.remove({ id: deleted.id });
  await worker.posts.forget('refused');
  const page = await api.things.feed({ limit: 20 });
  assert.equal(page.source, 'device'); assert.equal(page.incomplete, true);
  assert.deepEqual(new Set(page.posts.map(row => row.id)), new Set(['retained', own.id]));
  assert.equal(page.posts.find(row => row.id === own.id).text, 'Authored here');
  assert.equal(page.posts.find(row => row.id === 'retained').author.id, 'other', 'retained display data is never rewritten as owned content');
  assert.equal(remoteCalls, 0);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  assert.equal((await api.things.feed({ device: true })).posts.length, 2); assert.equal(remoteCalls, 0);
  assert.equal((await api.things.feed()).source, 'device'); assert.equal(remoteCalls, 1, 'transient first-page failure falls back to the scoped device view');
  response = new WorkspaceError('FORBIDDEN', 'Access refused', 403);
  await assert.rejects(api.things.feed(), /Access refused/);
  response = new TypeError('Connection lost');
  await assert.rejects(api.things.feed({ cursor: 'server-page' }), /Connection lost/, 'load-more never mixes remote and device cursor streams');
  bindLocalWorkspace(false, rootIdentity.read().generation, { ...scope, dataPlane: 'custom-' + 'a'.repeat(64) }, false);
  await assert.rejects(api.things.feed({ device: true }), /changed/);
  const otherPlane: any = accountApi(remote, { id: scope.ownerId }, 'custom-' + 'a'.repeat(64));
  assert.deepEqual((await otherPlane.things.feed({ device: true })).posts, []);
 } finally {
  rootIdentity.changed(); bindLocalWorkspace(false, rootIdentity.read().generation); rootIdentity.confirm(rootIdentity.read().generation);
  await workspaceDatabase().close();
  Object.assign(globalThis, { window: before.window, indexedDB: before.indexedDB, fetch: before.fetch, IDBKeyRange: before.IDBKeyRange });
  if (before.navigator) Object.defineProperty(globalThis, 'navigator', before.navigator); else delete (globalThis as any).navigator;
 }
});
