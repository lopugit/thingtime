import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { accountApi, accountWorkspaceWorker } from './accountApi.client';
import { bindLocalWorkspace, currentAccountWorkspace, LOCAL_WORKSPACE_OWNER, workspaceDatabase } from './runtime.client';
import { withCharacterRequest } from './characterRequest.client';
import { draftRequest } from '../drafts/draftClient';
import { workspaceDraftContextSync, workspaceDraftRecoveryKey } from '../drafts/workspaceDraft';
import { rootIdentity } from '../utils/rootIdentity';

const scope = { kind: 'account', origin: 'https://characters.example', ownerId: 'principal', dataPlane: 'home' } as const;
test('Character delegation never borrows a local partition, and owner replies remain available offline', async () => {
 const previous = { window: globalThis.window, fetch: globalThis.fetch, indexedDB: globalThis.indexedDB };
 const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
 const events = new EventTarget(), calls: { url: string; init: RequestInit }[] = [];
 let online = false, afterFetch: (() => void) | undefined;
 Object.assign(globalThis, { window: { location: { origin: scope.origin }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) }, indexedDB: new IDBFactory(),
  fetch: async (url: string, init: RequestInit) => {
   if (url.includes('capabilities')) return Response.json({ schemaVersion: 1, origin: scope.origin, features: { 'api.auth-characters': {version:'1.0.0'}, 'api.drafts': {version:'1.1.0'} } });
   calls.push({ url, init }); afterFetch?.();
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
  await assert.rejects(draftRequest('character', { operation: 'save' }), /Reconnect/);
  await assert.rejects(withCharacterRequest(async () => assert.fail('Must not run offline')), /Reconnect/);
  assert.equal(calls.length, 0); assert.equal(comments.length, 0);
  online = true; bind(false);
  await assert.rejects(api.things.comment({ id: parent.id, text: 'Character reply', characterId: 'character' }), /offline/);
  await assert.rejects(draftRequest('character', { operation: 'save' }), /offline/);
  assert.equal(calls.length, 0); assert.equal(comments.length, 0);
  bind();
  await api.things.comment({ id: parent.id, text: 'Character reply', characterId: 'character' });
  assert.deepEqual(comments, [{ id: parent.id, text: 'Character reply', characterId: 'character' }]);
  assert.deepEqual(await accountWorkspaceWorker(scope).sync.exportSnapshot(), before, 'no Character content enters the principal queue');
  const saved = await draftRequest<any>('character', { operation: 'save', expectedActor: 'wrong' });
  assert.equal(saved.draft.id, 'remote-character-draft');
  const call = calls[0];
  assert.equal(call.url, '/api/v1/drafts'); assert.equal(call.init.redirect, 'error'); assert.equal(call.init.credentials, 'same-origin');
  assert.equal((call.init.headers as any)['X-Thingtime-Character'], 'character');
  assert.equal((call.init.headers as any)['X-Thingtime-Expected-Actor'], 'character');
  assert.equal((call.init.headers as any)['X-Thingtime-Expected-Data-Plane'], 'home');
  assert.equal(JSON.parse(String(call.init.body)).expectedActor, 'character');
  assert.deepEqual(currentAccountWorkspace(), scope);
  assert.deepEqual(await accountWorkspaceWorker(scope).sync.exportSnapshot(), before);
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
  bind(); afterFetch = () => bindLocalWorkspace(false, rootIdentity.read().generation, {...scope,dataPlane:'other-database'});
  await assert.rejects(draftRequest('character', undefined, {id:'draft'}), /workspace changed/i);
  assert.equal(calls.at(-1)!.init.signal?.aborted, true);
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
