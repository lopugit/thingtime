import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { anonymousApi } from './api.client';
import { publicWorkspaceRead } from './publicRead.client';
import { bindLocalWorkspace, anonymousWorkspaceDatabase } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';

test('anonymous structured discovery uses only the public read endpoint, omits credentials and scopes cached queries', async () => {
 const old = { window: globalThis.window, indexedDB: globalThis.indexedDB, fetch: globalThis.fetch };
 const origin = 'https://search-public.example'; let offline = false, reads = 0;
 const query = { conditions: [{ field: 'name', op: 'contains', value: 'gold' }] };
 Object.assign(globalThis, { window: { location: { origin }, dispatchEvent() {} }, indexedDB: new IDBFactory(), fetch: async (url: RequestInfo | URL, options?: RequestInit) => {
  if (options?.credentials === 'same-origin') return Response.json({ schemaVersion: 1, origin, features: { 'api.things-search': { version: '1.3.0' } } });
  if (offline) throw new TypeError('Offline');
  reads++; assert.equal(String(url), origin + '/api/v1/things/search');
  assert.equal(options?.credentials, 'omit'); assert.equal(options?.redirect, 'error'); assert.equal(options?.method, 'POST');
  assert.deepEqual(JSON.parse(String(options?.body)), query);
  assert.equal(new Headers(options?.headers).has('Authorization'), false);
  return Response.json({ ok: true, things: [{ id: 'public-gold' }], posts: {}, nextCursor: null });
 } });
 bindLocalWorkspace(true, rootIdentity.read().generation);
 try {
  const api = anonymousApi({ things: { search: async (..._args: any[]): Promise<any> => { throw new Error('No account transport'); } } });
  assert.equal((await api.things.search({ ...query, anon: 1 })).things[0].id, 'public-gold');
  offline = true;
  assert.equal((await api.things.search(query)).things[0].id, 'public-gold');
  await assert.rejects(api.things.search({ q: 'different' }), /Offline/);
  await assert.rejects(api.things.search({ q: 'a'.repeat(33 * 1024) }), /32 KiB/);
  await assert.rejects(publicWorkspaceRead('/api/v1/things', 'api.things-search', '1.3.0', undefined, '{}'), /Search must/);
  await assert.rejects(publicWorkspaceRead('https://evil.example/api/v1/things/search', 'api.things-search', '1.3.0', undefined, '{}'), /Unsupported/);
  assert.equal(reads, 1);
  rootIdentity.changed(); bindLocalWorkspace(false, rootIdentity.read().generation); rootIdentity.confirm(rootIdentity.read().generation);
  await assert.rejects(api.things.search(query), /Workspace changed/);
 } finally { await anonymousWorkspaceDatabase().close(); Object.assign(globalThis, old); }
});
