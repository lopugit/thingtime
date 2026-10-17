import { bindLocalWorkspace } from './runtime.client';
import assert from 'node:assert/strict';
import test from 'node:test';
import { accountThingTransport, readBoundedBytes, readBoundedJson } from './accountTransport.client';
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
  if (url.includes('capabilities')) return Response.json({ schemaVersion: 1, origin, features: { 'api.attachment-delete': { version: '1.3.0' }, 'api.attachment-upload-abort': { version: '1.2.0' }, 'api.attachment-annotate': { version: '1.2.0' }, 'api.things-bulk': { version: '1.6.0' }, 'api.attachment-uploads': { version: '1.5.0' }, 'api.attachment-upload-parts': { version: '1.1.0' }, 'api.attachment-upload-complete': { version: '1.4.0' }, 'api.things': { version: '1.33.0' }, 'api.things-update': { version: '1.10.0' }, 'api.things-export': { version: '1.15.0' }, 'api.things-fork': { version: '1.6.0' }, 'api.components-browse': { version: '1.0.0' }, 'api.schemas-browse': { version: '1.0.0' }, 'api.attachment-content': { version: '1.11.0' }, 'api.mongodb-endpoint': { version: '1.1.0' } } });
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
  await transport.export({ ids: ['thing'] }, new AbortController().signal);
  assert.equal(calls.at(-1).url, '/api/v1/things/export'); assert.equal(calls.at(-1).init.method, 'POST');
  await transport.fork({ id: 'thing' });
  assert.equal(calls.at(-1).url, '/api/v1/things/fork'); assert.equal(calls.at(-1).init.method, 'POST');
  await transport.browse('component', { mine: 1, cursor: 'next' });
  assert.equal(calls.at(-1).url, '/api/v1/components/browse?mine=1&cursor=next');
  await transport.browse('schema', { mine: 1 });
  assert.equal(calls.at(-1).url, '/api/v1/schemas/browse?mine=1');
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

test('file transport negotiates uploads, preserves retry codes, and sends signed bytes without credentials', async () => {
 const saved = { window: globalThis.window, fetch: globalThis.fetch };
 const origin = 'https://thingtime.example', scope = { kind: 'account', origin, ownerId: 'file-owner', dataPlane: 'home' } as const;
 const calls: any[] = [];
 let response = Response.json({ ok: true, upload: { id: 'remote-file' } });
 Object.assign(globalThis, { window: { location: { origin }, dispatchEvent() {} }, fetch: async (url: string | URL, init: RequestInit) => {
  if (String(url).includes('capabilities')) return Response.json({ schemaVersion: 1, origin, features: { 'api.attachment-delete': { version: '1.3.0' }, 'api.attachment-upload-abort': { version: '1.2.0' }, 'api.attachment-annotate': { version: '1.2.0' }, 'api.things-bulk': { version: '1.6.0' }, 'api.attachment-uploads': { version: '1.5.0' }, 'api.attachment-upload-parts': { version: '1.1.0' }, 'api.attachment-upload-complete': { version: '1.4.0' }, 'api.mongodb-endpoint': { version: '1.1.0' } } });
  calls.push({ url: String(url), init }); return response.clone();
 } });
 try {
  rootIdentity.confirm(rootIdentity.read().generation);
  bindLocalWorkspace(false, rootIdentity.read().generation, scope);
  const transport = accountThingTransport(scope, { assertCurrent() {}, onInvalidate: () => () => {} }).files, signal = new AbortController().signal;
  assert.deepEqual(await transport.start({ requestId: 'immutable-request', filename: 'file.txt', contentType: 'text/plain', sizeBytes: 3, purpose: 'file' }, signal), { id: 'remote-file' });
  response = Response.json({ ok: true, parts: [{ partNumber: 1 }] });
  assert.deepEqual(await transport.parts('remote-file', [{ partNumber: 1, checksumSha256: 'hash' }], signal), [{ partNumber: 1 }]);
  response = Response.json({ ok: false, code: 'upload_parts_retryable', retryable: true }, { status: 409, headers: { 'Retry-After': '30' } });
  await assert.rejects(transport.complete('remote-file', signal), (error: any) => error.code === 'upload_parts_retryable' && error.status === 409 && error.retryable === true && error.retryAfterMs === 30000);
  for (const { init } of calls) { assert.equal(init.headers['X-Thingtime-Expected-Actor'], scope.ownerId); assert.equal(init.headers['X-Thingtime-Expected-Data-Plane'], 'home'); }
  response = Response.json({ ok: true, cancelled: true, deferred: false });
  assert.equal((await transport.cancel!('immutable-request', signal)).cancelled, true);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { requestId: 'immutable-request' });
  const stamp = '2026-10-16T00:00:00.000Z';
  response = Response.json({ ok: true, deleted: true, deferred: false });
  const deletion = { id: 'remote-file', requestId: 'immutable-request', expectedUpdatedAt: stamp };
  assert.equal((await transport.remove!(deletion, signal)).deleted, true);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), deletion);
  assert.equal(calls.at(-1).url, '/api/v1/attachments/delete');
  response = Response.json({ ok: true, attachment: { id: 'remote-file', title: 'Updated title' }, updatedAt: stamp });
  assert.equal((await transport.annotate({ id: 'remote-file', title: 'Updated title', expectedUpdatedAt: stamp }, signal)).updatedAt, stamp);
  assert.equal(JSON.parse(calls.at(-1).init.body).expectedUpdatedAt, stamp);
  response = Response.json({ ok: true, results: [{ id: 'remote-file', ok: true }], succeeded: 1, failed: 0 });
  await transport.move('remote-file', null, stamp, signal);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { op: 'move', ids: ['remote-file'], folderId: null, expectedUpdatedAt: stamp });
  response = Response.json({ ok: true, results: [{ id: 'remote-file', ok: false, status: 409 }] });
  await assert.rejects(transport.move('remote-file', null, stamp, signal), (error: any) => error.status === 409);
  response = Response.json({ ok: true, results: [{ id: 'wrong-file', ok: true }] });
  await assert.rejects(transport.move('remote-file', null, stamp, signal), /invalid file move result/);
  response = new Response(null, { status: 200 });
  const part = { partNumber: 1, url: '/api/v1/attachments/local-object?signature=opaque', headers: { 'x-amz-checksum-sha256': 'hash' }, expiresAt: '' };
  const bytes = Uint8Array.of(1,2,3);
  await transport.put(part, bytes, signal);
  assert.equal(calls.at(-1).url, origin + part.url);
  await transport.put({ ...part, url: 'https://bucket.s3.example/object?signed=opaque' }, bytes, signal);
  for (const { init } of calls.filter(call => call.init.method === 'PUT')) {
   assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.referrerPolicy, 'no-referrer');
   assert.deepEqual(init.headers, part.headers); assert.deepEqual(init.body, bytes);
  }
  const count = calls.length;
  // eslint-disable-next-line no-script-url -- hostile URL is an inert refusal fixture.
  for (const url of ['file:///etc/passwd','javascript:alert(1)','http://example.test/file','https://user:pass@example.test/file'])
   await assert.rejects(transport.put({ ...part, url }, bytes, signal), /invalid storage URL/);
  bindLocalWorkspace(true, rootIdentity.read().generation);
  await assert.rejects(transport.put(part, bytes, signal), /workspace changed/);
  assert.equal(calls.length, count);
 } finally { Object.assign(globalThis, saved); }
});


test('owned file transport binds metadata and exact bytes to one account, plane and immutable version', async () => {
 const saved={window:globalThis.window,fetch:globalThis.fetch};
 const origin='https://retention.test',scope={kind:'account' as const,origin,ownerId:'owner',dataPlane:'home'};
 const calls:any[]=[],bytes=new Uint8Array([1,2,3]),key='a'.repeat(64)+':original';
 let etag='"'+key+':v1"', body=bytes;
 Object.assign(globalThis,{window:{location:{origin},dispatchEvent(){}},fetch:async(url:string,init:RequestInit)=>{
  if(url.includes('capabilities'))return Response.json({schemaVersion:1,origin,features:{'api.attachment-content':{version:'1.13.0'},'api.attachment-delete':{version:'1.4.0'},'api.mongodb-endpoint':{version:'1.1.0'}}});
  calls.push({url,init});
  return url.includes('cache=bytes')?new Response(body,{headers:{ETag:etag,'Content-Length':'3'}}):Response.json({ok:true});
 }});
 try{
  rootIdentity.confirm(rootIdentity.read().generation);bindLocalWorkspace(false,rootIdentity.read().generation,scope);
  const transport=accountThingTransport(scope,{assertCurrent(){},onInvalidate:()=>()=>{}}).files,signal=new AbortController().signal;
  await assert.rejects(transport.retention('file',signal),/incompatible/); // Prior test's other-origin manifest must be rejected and evicted.
  await transport.retention('file',signal);assert.equal(calls.at(-1).url,'/api/v1/attachments/content?id=file&cache=retain&download=1');
  assert.deepEqual(await transport.bytes('file',key,3,signal),bytes);
  for(const {init} of calls){assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.headers['X-Thingtime-Expected-Actor'],'owner');assert.equal(init.headers['X-Thingtime-Expected-Data-Plane'],'home');}
  etag='"another-version"';await assert.rejects(transport.bytes('file',key,3,signal),/version changed/);
  etag='"'+key+':v1"';body=bytes.slice(1);await assert.rejects(transport.bytes('file',key,3,signal),/incomplete/);
  body=new Uint8Array([1,2,3,4]);await assert.rejects(transport.bytes('file',key,3,signal),/exceeds/);
  await transport.remove!({id:'file',expectedUpdatedAt:'2026-10-17T00:00:00.000Z',retainReceipt:true},signal);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body),{id:'file',expectedUpdatedAt:'2026-10-17T00:00:00.000Z',retainReceipt:true});
 }finally{Object.assign(globalThis,saved);}
});

test('bounded file reader refuses missing, oversized and truncated bodies',async()=>{
 await assert.rejects(readBoundedBytes(new Response(null),3),/missing/);
 await assert.rejects(readBoundedBytes(new Response(new Uint8Array(2)),3),/incomplete/);
 await assert.rejects(readBoundedBytes(new Response(new Uint8Array(4)),3),/exceeds/);
 await assert.rejects(readBoundedBytes(new Response(new Uint8Array(3)),17*1024*1024),/Invalid file size/);
});
