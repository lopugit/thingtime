import assert from 'node:assert/strict';
import test from 'node:test';
import { bindLocalWorkspace, accountWorkspaceLease, accountRemoteWorkspaceLease, assertAccountSyncAllowed, canSyncAccountWorkspace, isAnonymousWorkspace, announceLocalWorkspaceChange, LOCAL_WORKSPACE_CHANGED } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { createRootDataLoader } from '../utils/rootDataLoader';
import { RootDataUnavailableError } from '../utils/rootDataRecovery';
import { workspaceScopeKey } from './storage';
import type { LoaderFunctionArgs } from 'react-router';
const scope = { kind: 'account', origin: 'https://thingtime.example', ownerId: 'owner', dataPlane: 'home' } as const;
test('offline account content remains editable but cannot authorize remote requests', () => {
 bindLocalWorkspace(false, rootIdentity.read().generation, scope, false);
 const local = accountWorkspaceLease(scope); local.assertCurrent();
 assert.equal(isAnonymousWorkspace(), false); assert.equal(canSyncAccountWorkspace(scope), false);
 assert.throws(() => assertAccountSyncAllowed(scope), /offline/);
 bindLocalWorkspace(false, rootIdentity.read().generation, scope, true);
 local.assertCurrent(); const remote = accountRemoteWorkspaceLease(scope); remote.assertCurrent();
 let retired = false; const stop = remote.onInvalidate(() => { retired = true; });
 bindLocalWorkspace(false, rootIdentity.read().generation, scope, false);
 assert.equal(retired, true); local.assertCurrent();
 bindLocalWorkspace(false, rootIdentity.read().generation, scope, true);
 assert.throws(() => remote.assertCurrent(), /confirmation changed/); stop();
 const fresh = accountRemoteWorkspaceLease(scope); fresh.assertCurrent();
 bindLocalWorkspace(false, rootIdentity.read().generation, { ...scope, ownerId: 'other' }, true);
 assert.throws(() => local.assertCurrent(), /workspace changed/i); assert.throws(() => fresh.assertCurrent(), /workspace changed/i);
 bindLocalWorkspace(true, rootIdentity.read().generation);
 assert.equal(canSyncAccountWorkspace(scope), false); assert.equal(isAnonymousWorkspace(), true);
});

test('authoritative root refusal permanently retires local editors and remote operations', async () => {
 bindLocalWorkspace(false, rootIdentity.read().generation, scope, true);
 const local = accountWorkspaceLease(scope), remote = accountRemoteWorkspaceLease(scope);
 let aborted = false; const stop = remote.onInvalidate(() => { aborted = true; });
 const load = createRootDataLoader(async () => { throw new RootDataUnavailableError(false); }, rootIdentity);
 await assert.rejects(load({ request: new Request(scope.origin), params: {}, context: {} } as LoaderFunctionArgs), RootDataUnavailableError);
 assert.equal(aborted, true); assert.equal(canSyncAccountWorkspace(scope), false);
 assert.throws(local.assertCurrent, /workspace changed/i);
 const generation = rootIdentity.read().generation;
 bindLocalWorkspace(false, generation, scope, true); rootIdentity.confirm(generation);
 accountWorkspaceLease(scope).assertCurrent();
 assert.throws(local.assertCurrent, /workspace changed/i); assert.throws(remote.assertCurrent, /workspace changed/i);
 stop();
});


test('cross-tab changes are scoped invalidations without data or message echoes', () => {
 const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
 const received: string[] = [], sent: unknown[] = [];
 const channels: TestChannel[] = [];
 class TestChannel {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor() { channels.push(this); }
  postMessage(value: unknown) { sent.push(value); }
 }
 Object.defineProperty(globalThis, 'window', { configurable: true, value: { BroadcastChannel: TestChannel, dispatchEvent: (event: Event) => { received.push(event.type); } } });
 try {
  bindLocalWorkspace(false, rootIdentity.read().generation, scope, true);
  const key = workspaceScopeKey(scope);
  channels[0].onmessage!({ data: { scope: workspaceScopeKey({ ...scope, ownerId: 'different' }) } });
  channels[0].onmessage!({ data: { scope: workspaceScopeKey({ kind: 'anonymous' }) } });
  assert.deepEqual(received, []);
  channels[0].onmessage!({ data: { scope: key } });
  assert.ok(received.includes(LOCAL_WORKSPACE_CHANGED)); assert.deepEqual(sent, []);
  announceLocalWorkspaceChange(['test-id']); assert.deepEqual(sent, [{ scope: key }]);
  const count = received.length; rootIdentity.changed();
  channels[0].onmessage!({ data: { scope: key } }); assert.equal(received.length, count);
 } finally {
  rootIdentity.confirm(rootIdentity.read().generation);
  if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window');
 }
});
