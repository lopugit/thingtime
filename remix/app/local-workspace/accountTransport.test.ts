import { bindLocalWorkspace } from './runtime.client';
import assert from 'node:assert/strict';
import test from 'node:test';
import { accountThingTransport, readBoundedJson } from './accountTransport.client';
import { accountWriteSupported } from './accountSync';
import { rootIdentity } from '../utils/rootIdentity';

test('incomplete local adapters cannot silently discard caller fields', () => {
 assert.equal(accountWriteSupported({ thingtime: ['data'], crystal: {}, tags: [] }), true);
 assert.equal(accountWriteSupported({ id: 'id', crystal: {}, expectedUpdatedAt: 'stamp' }, true), true);
 for (const field of ['attachmentIds', 'tokenAcl', 'geo', 'shareId', 'expectedActor', 'unknown'])
  assert.equal(accountWriteSupported({ crystal: {}, [field]: 'value' }, true), false, field);
});
test('response reader bounds bytes and rejects incomplete or invalid JSON', async () => {
 assert.deepEqual(await readBoundedJson(Response.json({ ok: true })), { ok: true });
 await assert.rejects(readBoundedJson(new Response(new Uint8Array(8 * 1024 * 1024 + 1))), /cache limit/);
 await assert.rejects(readBoundedJson(new Response('{"ok":')));
 await assert.rejects(readBoundedJson(new Response(null)), /Missing account response/);
});
test('transport pins account and database on reads and writes and retires mismatched sessions', async () => {
 const saved = { window: globalThis.window, fetch: globalThis.fetch };
 const origin = 'https://thingtime.example', scope = { kind: 'account', origin, ownerId: 'owner', dataPlane: 'home' } as const;
 bindLocalWorkspace(false, rootIdentity.read().generation, scope);
 const generation = rootIdentity.read().generation, calls: any[] = [], events: string[] = [];
 const lease = { assertCurrent() { if (rootIdentity.read().generation !== generation) throw new Error('Retired workspace'); }, onInvalidate: () => () => {} };
 let result = Response.json({ ok: true, thing: { id: 'thing' } });
 Object.assign(globalThis, { window: { location: { origin }, dispatchEvent(event: Event) { events.push(event.type); } }, fetch: async (url: string, init: RequestInit) => {
  if (url.includes('capabilities')) return Response.json({ schemaVersion: 1, origin, features: { 'api.things': { version: '1.33.0' }, 'api.things-update': { version: '1.10.0' }, 'api.mongodb-endpoint': { version: '1.1.0' } } });
  calls.push({ url, init }); return result.clone();
 } });
 try {
  const transport = accountThingTransport(scope, lease);
  await transport.get('thing', new AbortController().signal);
  await transport.write({ id: 'thing', operationId: 'write', version: 1, method: 'update', body: { id: 'thing' } }, new AbortController().signal);
  result = Response.json({ ok: true });
  await transport.remove!({ id: 'thing', operationId: 'delete', version: 1, method: 'delete', body: { id: 'thing', expectedUpdatedAt: '2026-01-01T00:00:00.000Z' } }, new AbortController().signal);
  assert.equal(calls.at(-1).init.method, 'DELETE');
  assert.equal(JSON.parse(calls.at(-1).init.body).expectedUpdatedAt, '2026-01-01T00:00:00.000Z');
  for (const { init } of calls) { assert.equal(init.headers['X-Thingtime-Expected-Actor'], 'owner'); assert.equal(init.headers['X-Thingtime-Expected-Data-Plane'], 'home'); assert.equal(init.credentials, 'same-origin'); assert.equal(init.redirect, 'error'); }
  // An HTML refusal from an edge/WAF must keep its HTTP status so the sync
  // queue can classify it, instead of degrading to a status-less retry.
  for (const status of [403, 409]) {
   result = new Response('<html><body>Forbidden</body></html>', { status, headers: { 'Content-Type': 'text/html' } });
   await assert.rejects(transport.get('thing', new AbortController().signal), (error: any) => {
    assert.equal(error.status, status); assert.match(String(error.message), /could not be completed/); return true;
   }, `status ${status}`);
  }
  result = Response.json({ ok: false, code: 'ACTOR_CHANGED' }, { status: 409 });
  await assert.rejects(transport.get('thing', new AbortController().signal), /session changed/);
  assert.deepEqual(events, ['thingtime:root-data-refresh']); const count = calls.length;
  await assert.rejects(transport.get('thing', new AbortController().signal), /Retired workspace/); assert.equal(calls.length, count);
 } finally { Object.assign(globalThis, saved); }
});
