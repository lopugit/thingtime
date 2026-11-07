import assert from 'node:assert/strict';
import test from 'node:test';
import { accountProviderMetadataTransport } from './providerTransport.client';
import { bindLocalWorkspace, accountWorkspaceLease } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
const origin = 'https://provider-transport.example';
const scope = { kind: 'account', ownerId: 'owner', origin, dataPlane: 'home' } as const;
const signal = () => new AbortController().signal;

test('provider metadata sync uses direct bounded credential requests with exact actor/plane fences and cancels stale responses', async () => {
 const previous = { window: globalThis.window, fetch: globalThis.fetch }, calls: { url: string; init: RequestInit }[] = [], events: string[] = [];
 let response = Response.json({ ok: true, ownerId: scope.ownerId, entries: [], nextCursor: null }), after: (() => void) | undefined;
 Object.assign(globalThis, { window: { location: { origin }, dispatchEvent: (event: Event) => { events.push(event.type); return true; } }, fetch: async (url: string, init: RequestInit) => {
  if (url.includes('capabilities')) return Response.json({ schemaVersion: 1, origin, features: { 'api.lopu-vault': { version: '1.3.0' }, 'api.mongodb-endpoint': { version: '1.1.0' } } });
  calls.push({ url, init }); after?.(); return response;
 } });
 const bind = (confirmed = true) => { rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(false, rootIdentity.read().generation, scope, confirmed); return accountProviderMetadataTransport(scope, accountWorkspaceLease(scope)); };
 try {
  let transport = bind(false); await assert.rejects(transport.metadata(signal()), /offline/); assert.equal(calls.length, 0);
  transport = bind(); await transport.metadata(signal());
  assert.equal(calls[0].url, '/api/v1/lopu/vault'); assert.equal(calls[0].init.credentials, 'same-origin'); assert.equal(calls[0].init.cache, 'no-store'); assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(calls[0].init.headers, { 'Content-Type': 'application/json', 'X-Thingtime-Expected-Actor': 'owner', 'X-Thingtime-Expected-Data-Plane': 'home' });
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { action: 'sync-metadata', expectedOwnerId: 'owner' });
  response = new Response('<h1>refused private server text</h1>', { status: 403 });
  await assert.rejects(transport.metadata(signal()), (error: any) => error.status === 403 && !error.message.includes('private server text'));
  response = Response.json({ ok: true, ownerId: 'different', entries: [] });
  await assert.rejects(transport.metadata(signal()), /confirmation changed/); assert.ok(events.includes('thingtime:root-data-refresh'));
  transport = bind(); response = Response.json({ ok: true, ownerId: scope.ownerId, entries: [], nextCursor: null }); after = () => bindLocalWorkspace(false, rootIdentity.read().generation, scope, false);
  await assert.rejects(transport.metadata(signal()), /confirmation changed|offline/); assert.equal(calls.at(-1)!.init.signal!.aborted, true);
  after = undefined; transport = bind(); response = Response.json({ ok: false, code: 'DATA_PLANE_CHANGED' }, { status: 409 });
  await assert.rejects(transport.metadata(signal()), /confirmation changed/);
  transport = bind(); response = new Response('x'.repeat(8 * 1024 * 1024 + 1));
  await assert.rejects(transport.metadata(signal()), /cache limit/);
 } finally { Object.assign(globalThis, previous); rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(true, rootIdentity.read().generation); }
});

test('provider writes negotiate their own contract and send immutable commands only through a confirmed account', async () => {
 const writeOrigin = 'https://provider-write-transport.example', writeScope = { ...scope, origin: writeOrigin };
 const previous = { window: globalThis.window, fetch: globalThis.fetch }, calls: { url: string; init: RequestInit }[] = [];
 const command = { action: 'create-group' as const, id: 'fixture-group', writeId: 'fixture-write', expectedVersion: null, name: 'Fixture' };
 const acknowledgment = { action: command.action, id: command.id, writeId: command.writeId, expectedVersion: null, resultVersion: 'vault-state-v1:'+'a'.repeat(64) };
 let capability = '1.3.1';
 Object.assign(globalThis, { window: { location: { origin: writeOrigin }, dispatchEvent: () => true }, fetch: async (url: string, init: RequestInit) => {
  if (url.includes('capabilities')) return Response.json({ schemaVersion: 1, origin: writeOrigin, features: { 'api.lopu-vault': { version: capability }, 'api.mongodb-endpoint': { version: '1.1.0' } } });
  calls.push({ url, init }); return Response.json({ ok: true, ownerId: scope.ownerId, acknowledgment });
 } });
 const bind = (confirmed = true) => { rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(false, rootIdentity.read().generation, writeScope, confirmed); return accountProviderMetadataTransport(writeScope, accountWorkspaceLease(writeScope)); };
 try {
  await assert.rejects(bind(false).write(command, signal()), /offline/); assert.equal(calls.length,0);
  await assert.rejects(bind().write(command, signal())); assert.equal(calls.length,0,'older metadata-only servers receive no mutation');
  capability = '1.4.0'; assert.deepEqual(await bind().write(command, signal()), acknowledgment);
  assert.equal(calls[0].url,'/api/v1/lopu/vault'); assert.equal(calls[0].init.credentials,'same-origin'); assert.equal(calls[0].init.redirect,'error');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { action:'sync-write',command,expectedOwnerId:scope.ownerId });
  assert.equal((calls[0].init.headers as Record<string,string>)['X-Thingtime-Expected-Data-Plane'],'home');
 } finally { Object.assign(globalThis, previous); rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(true, rootIdentity.read().generation); }
});
