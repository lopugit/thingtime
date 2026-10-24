import assert from 'node:assert/strict';
import test from 'node:test';
import { accountThemeTransport } from './themeTransport.client';
import { accountAlgorithmTransport } from './algorithmTransport.client';
import { accountWorkspaceLease, bindLocalWorkspace } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';

for (const [kind, version, transport] of [
 ['themes', '1.6.0', accountThemeTransport],
 ['algorithms', '1.4.0', accountAlgorithmTransport]
] as const) {
 test(`${kind} delegation negotiates actor support and cannot adopt another principal or database`, async () => {
  const origin = `https://character-${kind}.example`;
  const principal = { kind: 'account', origin, ownerId: 'principal', dataPlane: 'home' } as const;
  const scope = { ...principal, ownerId: 'character', delegatedBy: principal.ownerId };
  const previous = { window: globalThis.window, fetch: globalThis.fetch };
  const calls: RequestInit[] = [];
  let supported: string = kind === 'themes' ? '1.5.0' : '1.3.0';
  let characters: string | undefined;
  let after: (() => void) | undefined;
  Object.assign(globalThis, {
   window: { location: { origin }, dispatchEvent: () => true },
   fetch: async (url: string, init: RequestInit) => {
    if (url.includes('capabilities')) return Response.json({ schemaVersion: 1, origin, features: {
     [`api.${kind}-sync`]: { version: supported }, 'api.mongodb-endpoint': { version: '1.1.0' },
     ...(characters ? { 'api.auth-characters': { version: characters } } : {})
    } });
    calls.push(init); after?.();
    return Response.json({ ok: true, ownerId: scope.ownerId, dataPlane: scope.dataPlane, storagePlane: 'home', complete: true, [kind]: [] });
   }
  });
  const bind = (current = principal, confirmed = true) => {
   rootIdentity.confirm(rootIdentity.read().generation);
   bindLocalWorkspace(false, rootIdentity.read().generation, current, confirmed);
  };
  const read = () => transport(scope, accountWorkspaceLease(scope)).snapshot(new AbortController().signal);
  try {
   bind();
   await assert.rejects(read(), /incompatible/);
   characters = '1.0.0';
   await assert.rejects(read(), /incompatible/);
   assert.equal(calls.length, 0, 'older servers never receive delegated requests');
   supported = version;
   assert.deepEqual(await read(), []);
   const sent = calls[0], headers = new Headers(sent.headers);
   assert.equal(headers.get('X-Thingtime-Character'), scope.ownerId);
   assert.equal(headers.get('X-Thingtime-Expected-Actor'), scope.ownerId);
   assert.equal(headers.get('X-Thingtime-Expected-Data-Plane'), scope.dataPlane);
   assert.deepEqual(JSON.parse(String(sent.body)), { operation: 'snapshot', expectedOwnerId: scope.ownerId });
   assert.equal(sent.credentials, 'same-origin'); assert.equal(sent.redirect, 'error'); assert.equal(sent.cache, 'no-store');
   bind(principal, false);
   await assert.rejects(read(), /offline/);
   assert.equal(calls.length, 1);
   bind();
   const retained = transport(scope, accountWorkspaceLease(scope));
   bind({ ...principal, ownerId: 'another-principal' } as any);
   await assert.rejects(retained.snapshot(new AbortController().signal), /workspace changed/i);
   bind();
   const oldPlane = transport(scope, accountWorkspaceLease(scope));
   bind({ ...principal, dataPlane: 'custom-' + 'a'.repeat(64) } as any);
   await assert.rejects(oldPlane.snapshot(new AbortController().signal), /workspace changed/i);
   assert.equal(calls.length, 1);
   bind();
   after = () => bind(principal, false);
   await assert.rejects(read(), /offline|confirmation changed/);
   assert.equal(calls.at(-1)!.signal!.aborted, true, 'revocation cancels the in-flight response');
   after = undefined; bind();
   characters = '2.0.0';
   await assert.rejects(requireThingtimeCapability('test-refresh', '1.0.0'));
   await assert.rejects(read(), /incompatible/);
   assert.equal(calls.length, 2, 'breaking Character versions fail closed');
  } finally {
   bindLocalWorkspace(true, rootIdentity.read().generation);
   Object.assign(globalThis, previous);
  }
 });
}
