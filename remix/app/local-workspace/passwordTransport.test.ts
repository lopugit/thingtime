import assert from 'node:assert/strict';
import test from 'node:test';
import { accountPasswordTransport } from './passwordTransport.client';
import { bindLocalWorkspace, accountWorkspaceLease } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
const origin = 'https://password-transport.example';
const scope = { kind: 'account', ownerId: 'owner', origin, dataPlane: 'home' } as const;
const signal = () => new AbortController().signal;

test('password sync uses direct bounded credential requests with exact actor/plane fences and cancels stale responses', async () => {
 const previous = { window: globalThis.window, fetch: globalThis.fetch }, calls: { url: string; init: RequestInit }[] = [], events: string[] = [];
 let response = Response.json({ ok: true, ownerId: scope.ownerId, entries: [], nextCursor: null }), after: (() => void) | undefined;
 Object.assign(globalThis, { window: { location: { origin }, dispatchEvent: (event: Event) => { events.push(event.type); return true; } }, fetch: async (url: string, init: RequestInit) => {
  if (url.includes('capabilities')) return Response.json({ schemaVersion: 1, origin, features: { 'api.passwords': { version: '1.0.0' }, 'api.mongodb-endpoint': { version: '1.1.0' } } });
  calls.push({ url, init }); after?.(); return response;
 } });
 const bind = (confirmed = true) => { rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(false, rootIdentity.read().generation, scope, confirmed); return accountPasswordTransport(scope, accountWorkspaceLease(scope)); };
 try {
  let transport = bind(false); await assert.rejects(transport.page(undefined, signal()), /offline/); assert.equal(calls.length, 0);
  transport = bind(); await transport.page(undefined, signal());
  assert.equal(calls[0].url, '/api/v1/passwords'); assert.equal(calls[0].init.credentials, 'same-origin'); assert.equal(calls[0].init.cache, 'no-store'); assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(calls[0].init.headers, { 'Content-Type': 'application/json', 'X-Thingtime-Expected-Actor': 'owner', 'X-Thingtime-Expected-Data-Plane': 'home' });
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { operation: 'export', expectedOwnerId: 'owner' });
  response = new Response('<h1>refused private server text</h1>', { status: 403 });
  await assert.rejects(transport.page(undefined, signal()), (error: any) => error.status === 403 && !error.message.includes('private server text'));
  response = Response.json({ ok: true, ownerId: 'different', entries: [] });
  await assert.rejects(transport.page(undefined, signal()), /confirmation changed/); assert.ok(events.includes('thingtime:root-data-refresh'));
  transport = bind(); response = Response.json({ ok: true, ownerId: scope.ownerId, entries: [], nextCursor: null }); after = () => bindLocalWorkspace(false, rootIdentity.read().generation, scope, false);
  await assert.rejects(transport.page(undefined, signal()), /confirmation changed|offline/); assert.equal(calls.at(-1)!.init.signal!.aborted, true);
  after = undefined; transport = bind(); response = Response.json({ ok: false, code: 'DATA_PLANE_CHANGED' }, { status: 409 });
  await assert.rejects(transport.page(undefined, signal()), /confirmation changed/);
  transport = bind(); response = new Response('x'.repeat(8 * 1024 * 1024 + 1));
  await assert.rejects(transport.page(undefined, signal()), /cache limit/);
 } finally { Object.assign(globalThis, previous); rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(true, rootIdentity.read().generation); }
});
