import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { accountApi, accountWorkspaceWorker } from './accountApi.client';
import { bindLocalWorkspace, currentAccountWorkspace, LOCAL_WORKSPACE_OWNER, workspaceDatabase } from './runtime.client';
import { characterApi, createCharacterRequest, withCharacterRequest } from './characterRequest.client';
import { WorkspaceApiIdentity } from './apiIdentity';
import { draftRequest } from '../drafts/draftClient';
import { workspaceDraftContextSync, workspaceDraftRecoveryKey } from '../drafts/workspaceDraft';
import { rootIdentity } from '../utils/rootIdentity';

const scope = { kind: 'account', origin: 'https://characters.example', ownerId: 'principal', dataPlane: 'home' } as const;
test('retained Character callbacks cannot borrow another root, plane or later session', async () => {
 const bind = (account = scope, confirmed = true) => {
  rootIdentity.confirm(rootIdentity.read().generation);
  bindLocalWorkspace(false, rootIdentity.read().generation, account, confirmed);
 };
 let calls = 0;
 const run = async () => { calls++; return 'Character result'; };
 try {
  bind();
  const slot = new WorkspaceApiIdentity<any>();
  const original = slot.resolve('first', { things: { get: run }, drafts: run, timeline: { canChangeLocally: () => false, canExportLocally: () => false } }, characterApi);
  const submit = createCharacterRequest();
  assert.equal(original.timeline.canChangeLocally(), false);
  assert.equal(original.timeline.canExportLocally(), false);
  assert.equal(await original.things.get(), 'Character result');
  bind({ ...scope, ownerId: 'other-principal' } as any);
  slot.resolve('second', { things: { get: run } }, characterApi);
  await assert.rejects(original.things.get(), /workspace changed/i);
  await assert.rejects(original.drafts(), /workspace changed/i);
  await assert.rejects(submit(run), /workspace changed/i);
  assert.equal(calls, 1);
  bind();
  const differentPlane = createCharacterRequest();
  bind({ ...scope, dataPlane: 'other-plane' } as any);
  await assert.rejects(differentPlane(run), /workspace changed/i);
  bind();
  const retired = createCharacterRequest();
  rootIdentity.changed(); bind();
  await assert.rejects(retired(run), /workspace changed/i);
  assert.equal(calls, 1, 'neither requests nor response side effects run after retirement');
  const reconnect = createCharacterRequest();
  bind(scope, false);
  await assert.rejects(reconnect(run), /offline/);
  bind();
  assert.equal(await reconnect(run), 'Character result', 'same local identity may regain verified authority');
  await assert.rejects(reconnect(async signal => {
   bind(scope, false); assert.equal(signal.aborted, true); return 'stale result';
  }), /confirmation changed|offline/);
  bindLocalWorkspace(true, rootIdentity.read().generation);
  const anonymous = createCharacterRequest();
  bind();
  await assert.rejects(anonymous(run), /Reconnect/);
  assert.equal(calls, 2, 'an unbound callback cannot adopt a later authenticated workspace');
 } finally { bindLocalWorkspace(true, rootIdentity.read().generation); }
});

test('Character posting remains server-authorized while owner replies stay available offline', async () => {
 const previous = { window: globalThis.window, fetch: globalThis.fetch, indexedDB: globalThis.indexedDB };
 const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
 const events = new EventTarget(), calls: { url: string; init: RequestInit }[] = [];
 let online = false;
 Object.assign(globalThis, { window: { location: { origin: scope.origin }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) }, indexedDB: new IDBFactory(),
  fetch: async (url: string, init: RequestInit) => {
   if (url.includes('capabilities')) return Response.json({ schemaVersion: 1, origin: scope.origin, features: { 'api.auth-characters': {version:'1.0.0'}, 'api.drafts': {version:'1.1.0'} } });
   calls.push({ url, init });
   return Response.json({ ok: true, draft: { id: 'remote-character-draft' } });
  }
 });
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { get onLine() { return online; } } });
 const bind = (confirmed = true) => { rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(false, rootIdentity.read().generation, scope, confirmed); };
 try {
  bind();
  const comments: unknown[] = [];
  const api: any = accountApi({ things: { comment: async (input: unknown) => { comments.push(input); return { ok: true }; } } }, { id: scope.ownerId }, scope.dataPlane);
  const parent = await api.things.create({ type: 'text', text: 'Owner post' });
  const reply = await api.things.comment({ id: parent.id, text: 'Offline owner reply', characterId: scope.ownerId });
  assert.equal(reply.savedLocally, true); assert.equal(reply.comment.author.id, scope.ownerId);
  assert.equal(comments.length, 0);
  const before = await accountWorkspaceWorker(scope).sync.exportSnapshot();
  await assert.rejects(api.things.comment({ id: parent.id, text: 'Character reply', characterId: 'character' }), /Reconnect/);
  await assert.rejects(withCharacterRequest(async () => assert.fail('Must not run offline')), /Reconnect/);
  assert.equal(calls.length, 0); assert.equal(comments.length, 0);
  online = true; bind(false);
  await assert.rejects(api.things.comment({ id: parent.id, text: 'Character reply', characterId: 'character' }), /offline/);
  assert.equal(calls.length, 0); assert.equal(comments.length, 0);
  bind();
  await api.things.comment({ id: parent.id, text: 'Character reply', characterId: 'character' });
  assert.deepEqual(comments, [{ id: parent.id, text: 'Character reply', characterId: 'character' }]);
  assert.deepEqual(await accountWorkspaceWorker(scope).sync.exportSnapshot(), before, 'no Character content enters the principal queue');
  assert.deepEqual(currentAccountWorkspace(), scope);
  const context = workspaceDraftContextSync(scope, 'post:new');
  const key = workspaceDraftRecoveryKey(scope.origin, 'character', context, scope);
  assert.notEqual(key, workspaceDraftRecoveryKey(scope.origin, scope.ownerId, context, scope));
  assert.notEqual(key, workspaceDraftRecoveryKey(scope.origin, 'character', context, {...scope,ownerId:'other-principal'}));
  assert.notEqual(key, workspaceDraftRecoveryKey(scope.origin, 'character', context, {...scope,dataPlane:'other-database'}));
  await assert.rejects(withCharacterRequest(async (signal, capturedScope) => {
   assert.deepEqual(capturedScope, scope);
   bindLocalWorkspace(false, rootIdentity.read().generation, {...scope,ownerId:'other-principal'});
   assert.equal(signal.aborted, true); return 'late result';
  }), /workspace changed/i);
  bindLocalWorkspace(true,rootIdentity.read().generation);
  const count = calls.length;
  await assert.rejects(draftRequest('character', {operation:'save'}), /account changed/);
  await assert.rejects(withCharacterRequest(async () => assert.fail('Anonymous cannot delegate')), /Reconnect/);
  assert.equal(calls.length,count);
  assert.notEqual(scope.ownerId,LOCAL_WORKSPACE_OWNER);
 } finally {
  bindLocalWorkspace(true,rootIdentity.read().generation);
  await workspaceDatabase().close(); Object.assign(globalThis,previous);
  if (navigatorDescriptor) Object.defineProperty(globalThis,'navigator',navigatorDescriptor); else delete (globalThis as any).navigator;
 }
});
