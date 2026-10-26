import { bindLocalWorkspace } from './runtime.client';
import assert from 'node:assert/strict';
import test from 'node:test';
import { accountThingTransport, readBoundedFileBlob, readBoundedJson } from './accountTransport.client';
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
 let result = Response.json({ ok: true, thing: { id: 'thing' } }), thingVersion = '1.34.0', contentVersion = '1.11.0';
 Object.assign(globalThis, { window: { location: { origin }, dispatchEvent(event: Event) { events.push(event.type); } }, fetch: async (url: string, init: RequestInit) => {
  if (url.includes('capabilities')) return Response.json({ schemaVersion: 1, origin, features: { 'api.drafts': { version: '1.1.0' }, 'api.attachment-delete': { version: '1.5.0' }, 'api.attachment-upload-abort': { version: '1.2.0' }, 'api.attachment-annotate': { version: '1.2.0' }, 'api.things-bulk': { version: '1.6.0' }, 'api.attachment-uploads': { version: '1.5.0' }, 'api.attachment-upload-parts': { version: '1.1.0' }, 'api.attachment-upload-complete': { version: '1.4.0' }, 'api.things-comment': { version: '1.8.0' }, 'api.things': { version: thingVersion }, 'api.things-update': { version: '1.10.0' }, 'api.things-export': { version: '1.18.0' }, 'api.things-fork': { version: '1.6.0' }, 'api.components-browse': { version: '1.0.0' }, 'api.schemas-browse': { version: '1.0.0' }, 'api.attachment-content': { version: contentVersion }, 'api.mongodb-endpoint': { version: '1.1.0' } } });
  calls.push({ url, init }); return result.clone();
 } });
 try {
  const transport = accountThingTransport(scope, lease);
  await transport.get('thing', new AbortController().signal);
  await transport.write({ id: 'thing', operationId: 'write', version: 1, method: 'update', body: { id: 'thing' } }, new AbortController().signal);
  const beforeBinding=calls.length;
  await assert.rejects(transport.write({id:'thing',operationId:'binding',version:1,method:'update',body:{id:'thing',attachmentIds:['file']}},new AbortController().signal),/incompatible/);
  assert.equal(calls.length,beforeBinding,'do not send attachment edits to a server without atomic binding');
  const beforeBlocks = calls.length;
  await assert.rejects(transport.write({ id: 'page', operationId: 'editable-blocks', version: 1, method: 'update', body: { id: 'page', crystal: { blocks: [{ id: 'button', type: 'element', tag: 'button', children: [] }] } } }, new AbortController().signal), /incompatible/);
  assert.equal(calls.length, beforeBlocks, 'keep a device edit queued instead of sending new block types to an older origin');
  await transport.write({ id: 'queued-comment', operationId: 'comment-write', version: 1, method: 'create', body: { shareId:'queued-comment', targetId:'parent', thingtime:['post','comment'], crystal:{type:'text',text:'Saved offline'},attachmentIds:['receipt-file'],tags:[],acl:['tt:inherit'] } }, new AbortController().signal);
  const submission=calls.at(-2);assert.equal(submission.url,'/api/v1/things/comment');
  assert.deepEqual(JSON.parse(submission.init.body),{id:'parent',shareId:'queued-comment',type:'text',text:'Saved offline',tags:[],attachmentIds:['receipt-file']});
  assert.equal(calls.at(-1).url,'/api/v1/things?id=queued-comment','read the canonical receipt after the normal comment endpoint');
  const edit = {id:'queued-comment',operationId:'comment-edit',version:2,method:'update' as const,body:{id:'queued-comment',targetId:'parent',thingtime:['post','comment'],crystal:{type:'text',text:'Edited offline'},acl:['tt:inherit'],visibility:'private',expectedUpdatedAt:'2026-10-17T00:00:00Z'}};
  const frozen=structuredClone(edit);await transport.write(edit,new AbortController().signal);
  const edited=JSON.parse(calls.at(-1).init.body);assert.equal(calls.at(-1).init.method,'PATCH');
  assert.equal(edited.acl,undefined);assert.equal(edited.visibility,undefined);assert.equal(edited.targetId,'parent');assert.equal(edited.expectedUpdatedAt,edit.body.expectedUpdatedAt);assert.deepEqual(edit,frozen);
  await transport.write({...edit,body:{...edit.body,acl:['tt:public']}},new AbortController().signal);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body).acl,['tt:public'],'never silently discard a different audience request');
  const attachment={id:'actual-file',name:'test.png',size:16,contentType:'image/png',mediaKind:'image'};
  result=Response.json({ok:true,thing:{id:'thing'},post:{id:'thing',attachments:[attachment]}});
  assert.deepEqual((await transport.get('thing',new AbortController().signal) as any).attachments,[attachment]);
  result=Response.json({ok:true,thing:{id:'thing'},post:{id:'other',attachments:[attachment]}});
  assert.equal((await transport.get('thing',new AbortController().signal) as any).attachments,undefined);
  result = Response.json({ ok: true });
  const deletion = { id: 'thing', operationId: 'delete', version: 1, method: 'delete' as const, body: { id: 'thing', expectedUpdatedAt: '2026-01-01T00:00:00.000Z' } };
  await assert.rejects(transport.remove!(deletion, new AbortController().signal), /incompatible/);
  thingVersion = '1.42.0';
  await transport.remove!(deletion, new AbortController().signal);
  assert.equal(calls.at(-1).init.method, 'DELETE');
  assert.equal(JSON.parse(calls.at(-1).init.body).retainAttachmentReceipts,true);
  assert.equal(JSON.parse(calls.at(-1).init.body).expectedUpdatedAt, '2026-01-01T00:00:00.000Z');
  const beforeBoundDelete=calls.length;
  await assert.rejects(transport.files.remove!({id:'file',requestId:'request',targetId:'post',expectedUpdatedAt:'2026-10-17T00:00:00Z'},new AbortController().signal),/incompatible/);
  assert.equal(calls.length,beforeBoundDelete);
  await assert.rejects(transport.files.retention('file',new AbortController().signal,true),/incompatible/);
  assert.equal(calls.length,beforeBoundDelete);
  contentVersion = '1.18.0';
  await transport.export({ ids: ['thing'] }, new AbortController().signal);
  assert.equal(calls.at(-1).url, '/api/v1/things/export'); assert.equal(calls.at(-1).init.method, 'POST');
  await transport.fork({ id: 'thing' });
  assert.equal(calls.at(-1).url, '/api/v1/things/fork'); assert.equal(calls.at(-1).init.method, 'POST');
  await transport.browse('component', { mine: 1, cursor: 'next' });
  assert.equal(calls.at(-1).url, '/api/v1/components/browse?mine=1&cursor=next');
  await transport.browse('schema', { mine: 1 });
  assert.equal(calls.at(-1).url, '/api/v1/schemas/browse?mine=1');
  const draftCommand = { operation: 'save' as const, id: 'draft', writeId: 'write', revision: 0, mode: 'template' as const, content: { name: 'Saved locally', surface: 'post' as const, context: 'post:new:', snapshot: '{}', attachmentIds: [] } };
  await transport.drafts.write(draftCommand, new AbortController().signal);
  assert.equal(calls.at(-1).url, '/api/v1/drafts');
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { ...draftCommand, expectedActor: scope.ownerId });
  await transport.drafts.list({ surface: 'post', cursor: 'next' });
  assert.equal(calls.at(-1).url, '/api/v1/drafts?surface=post&cursor=next');
  await transport.drafts.read('draft'); assert.equal(calls.at(-1).url, '/api/v1/drafts?id=draft');
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
  if (String(url).includes('capabilities')) return Response.json({ schemaVersion: 1, origin, features: { 'api.attachment-delete': { version: '1.5.0' }, 'api.attachment-upload-abort': { version: '1.2.0' }, 'api.attachment-annotate': { version: '1.2.0' }, 'api.things-bulk': { version: '1.6.0' }, 'api.attachment-uploads': { version: '1.5.0' }, 'api.attachment-upload-parts': { version: '1.1.0' }, 'api.attachment-upload-complete': { version: '1.4.0' }, 'api.mongodb-endpoint': { version: '1.1.0' } } });
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
 let etag='"'+key+':v1"', body=bytes, declaredSize='3';
 Object.assign(globalThis,{window:{location:{origin},dispatchEvent(){}},fetch:async(url:string,init:RequestInit)=>{
  if(url.includes('capabilities'))return Response.json({schemaVersion:1,origin,features:{'api.attachment-content':{version:'1.16.0'},'api.attachment-delete':{version:'1.5.0'},'api.mongodb-endpoint':{version:'1.1.0'}}});
  calls.push({url,init});
  return url.includes('cache=retain-bytes')?new Response(body,{headers:{ETag:etag,'Content-Length':declaredSize}}):Response.json({ok:true});
 }});
 try{
  rootIdentity.confirm(rootIdentity.read().generation);bindLocalWorkspace(false,rootIdentity.read().generation,scope);
  const transport=accountThingTransport(scope,{assertCurrent(){},onInvalidate:()=>()=>{}}).files,signal=new AbortController().signal;
  await assert.rejects(transport.retention('file',signal),/incompatible/); // Prior test's other-origin manifest must be rejected and evicted.
  await transport.retention('file',signal);assert.equal(calls.at(-1).url,'/api/v1/attachments/content?id=file&cache=retain&download=1');
  const retained = await transport.bytes('file',key,3,signal); assert.ok(retained instanceof Blob);
  assert.deepEqual(new Uint8Array(await retained.arrayBuffer()),bytes);
  for(const {init} of calls){assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.headers['X-Thingtime-Expected-Actor'],'owner');assert.equal(init.headers['X-Thingtime-Expected-Data-Plane'],'home');}
  etag='"another-version"';await assert.rejects(transport.bytes('file',key,3,signal),/version changed/);
  etag='"'+key+':v1"';declaredSize='4';await assert.rejects(transport.bytes('file',key,3,signal),/version changed/);declaredSize='3';
  etag='"'+key+':v1"';body=bytes.slice(1);await assert.rejects(transport.bytes('file',key,3,signal),/incomplete/);
  body=new Uint8Array([1,2,3,4]);await assert.rejects(transport.bytes('file',key,3,signal),/exceeds/);
  await transport.remove!({id:'file',expectedUpdatedAt:'2026-10-17T00:00:00.000Z',retainReceipt:true},signal);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body),{id:'file',expectedUpdatedAt:'2026-10-17T00:00:00.000Z',retainReceipt:true});
 }finally{Object.assign(globalThis,saved);}
});

test('owned file transport rejects a changed version without waiting for refused-body cleanup', {timeout: 2000}, async () => {
 const saved = {window: globalThis.window, fetch: globalThis.fetch};
 const origin = 'https://retention.test', scope = {kind: 'account' as const, origin, ownerId: 'owner', dataPlane: 'home'};
 let cancelled = 0, pulled = 0;
 const body = new ReadableStream({pull() {pulled++;}, cancel() {cancelled++; return new Promise<void>(() => {});}}, {highWaterMark: 0});
 Object.assign(globalThis, {window: {location: {origin}, dispatchEvent() {}}, fetch: async (url: string) => {
  if (url.includes('capabilities')) return Response.json({schemaVersion: 1, origin, features: {'api.attachment-content': {version: '1.16.0'}, 'api.mongodb-endpoint': {version: '1.1.0'}}});
  return new Response(body, {headers: {ETag: '"different"', 'Content-Length': '1'}});
 }});
 try {
  rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(false, rootIdentity.read().generation, scope);
  const transport = accountThingTransport(scope, {assertCurrent() {}, onInvalidate: () => () => {}}).files;
  await assert.rejects(transport.bytes('file', 'a'.repeat(64) + ':original', 1, new AbortController().signal), /version changed/);
  assert.equal(cancelled, 1); assert.equal(pulled, 0);
 } finally { Object.assign(globalThis, saved); }
});

test('bounded file reader refuses missing, oversized and truncated bodies',async()=>{
 await assert.rejects(readBoundedFileBlob(new Response(null),3),/missing/);
 await assert.rejects(readBoundedFileBlob(new Response(new Uint8Array(2)),3),/incomplete/);
 await assert.rejects(readBoundedFileBlob(new Response(new Uint8Array(4)),3),/exceeds/);
 await assert.rejects(readBoundedFileBlob(new Response(new Uint8Array(3)),Number.MAX_SAFE_INTEGER + 1),/Invalid file size/);
});

test('bounded Blob reader captures exact immutable chunks and releases its stream', async () => {
 const first = new Uint8Array([1, 2]), second = new Uint8Array([3, 4]);
 const body = new ReadableStream({start(controller) {controller.enqueue(first); controller.enqueue(second); controller.close();}});
 const blob = await readBoundedFileBlob(new Response(body), 4);
 first.fill(0); second.fill(0);
 assert.ok(blob instanceof Blob); assert.equal(body.locked, false);
 assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
});

test('bounded Blob reader refuses an invalid declared size before reading or waiting for cleanup', {timeout: 2000}, async () => {
 let cancelled = 0, pulled = 0;
 const body = new ReadableStream({pull() {pulled++;}, cancel() {cancelled++; return new Promise<void>(() => {});}}, {highWaterMark: 0});
 await assert.rejects(readBoundedFileBlob(new Response(body), Number.MAX_SAFE_INTEGER + 1), /Invalid file size/);
 assert.equal(pulled, 0); assert.equal(cancelled, 1); assert.equal(body.locked, false);
});

for (const early of [false, true]) test(`bounded Blob reader cancels a ${early ? 'pre-aborted' : 'stalled'} response without waiting for producer cleanup`, {timeout: 2000}, async () => {
 const controller = new AbortController(); let cancelled = 0;
 const body = new ReadableStream({cancel() {cancelled++; return new Promise<void>(() => {});}});
 if (early) controller.abort();
 const result = assert.rejects(readBoundedFileBlob(new Response(body), 1, controller.signal), {name: 'AbortError'});
 controller.abort(); await result;
 assert.equal(cancelled, 1); assert.equal(body.locked, false);
});

for (const mode of ['caller', 'local-scope', 'remote-scope'] as const) test(`owned file transport cancels stalled bytes after ${mode} retirement`, {timeout: 2000}, async () => {
 const saved = {window: globalThis.window, fetch: globalThis.fetch};
 const origin = 'https://retention.test', scope = {kind: 'account' as const, origin, ownerId: 'owner', dataPlane: 'home'};
 const key = 'a'.repeat(64) + ':original', controller = new AbortController();
 let entered!: () => void, invalidate!: () => void, removed = 0, cancelled = 0;
 const ready = new Promise<void>(resolve => {entered = resolve;});
 const body = new ReadableStream({pull() {entered();}, cancel() {cancelled++;}}, {highWaterMark: 0});
 Object.assign(globalThis, {window: {location: {origin}, dispatchEvent() {}}, fetch: async (url: string) => {
  if (url.includes('capabilities')) return Response.json({schemaVersion: 1, origin, features: {'api.attachment-content': {version: '1.16.0'}, 'api.mongodb-endpoint': {version: '1.1.0'}}});
  return new Response(body, {headers: {ETag: `"${key}:v1"`, 'Content-Length': '1'}});
 }});
 try {
  rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(false, rootIdentity.read().generation, scope);
  const transport = accountThingTransport(scope, {assertCurrent() {}, onInvalidate(callback) {invalidate = callback; return () => {removed++;};}}).files;
  const result = assert.rejects(transport.bytes('file', key, 1, controller.signal), {name: 'AbortError'});
  await ready;
  if (mode === 'caller') controller.abort(); else if (mode === 'local-scope') invalidate(); else rootIdentity.changed();
  await result; assert.equal(cancelled, 1); assert.equal(body.locked, false); assert.equal(removed, 1);
 } finally { Object.assign(globalThis, saved); }
});

test('parent deletion refuses an origin without durable cascade receipts and permits a compatible retry',async()=>{
 const saved={window:globalThis.window,fetch:globalThis.fetch};
 const origin='https://cascade-receipts.test',scope={kind:'account' as const,origin,ownerId:'owner',dataPlane:'home'};
 let version='1.33.2';const mutations:any[]=[];
 Object.assign(globalThis,{window:{location:{origin},dispatchEvent(){}},fetch:async(url:string,init:RequestInit)=>{
  if(url.includes('capabilities'))return Response.json({schemaVersion:1,origin,features:{'api.things':{version},'api.mongodb-endpoint':{version:'1.1.0'}}});
  mutations.push(init);return Response.json({ok:true});
 }});
 try{
  rootIdentity.confirm(rootIdentity.read().generation);bindLocalWorkspace(false,rootIdentity.read().generation,scope);
  const transport=accountThingTransport(scope,{assertCurrent(){},onInvalidate:()=>()=>{}});
  const op={id:'post',operationId:'delete',version:1,method:'delete' as const,body:{id:'post',expectedUpdatedAt:'2026-10-17T00:00:00.000Z'}};
  // The checker first rejects any cached manifest from another origin.
  await assert.rejects(transport.remove!(op,new AbortController().signal),/incompatible/);
  await assert.rejects(transport.remove!(op,new AbortController().signal),/incompatible/);assert.deepEqual(mutations,[]);
  for (const older of ['1.40.0', '1.41.0', '2.0.0']) {
   version=older; await assert.rejects(transport.remove!(op,new AbortController().signal),/incompatible/);
   assert.deepEqual(mutations,[]);
  }
  version='1.42.0';await transport.remove!(op,new AbortController().signal);
  assert.deepEqual(JSON.parse(mutations[0].body),{...op.body,retainAttachmentReceipts:true});
 }finally{Object.assign(globalThis,saved);}
});

test('owned-original transport negotiates before fetching and accepts streamed files above the old byte budget', async () => {
 const saved = {window: globalThis.window, fetch: globalThis.fetch};
 const origin = 'https://retention-streams.test', scope = {kind: 'account' as const, origin, ownerId: 'owner', dataPlane: 'home'};
 const key = 'a'.repeat(64) + ':original', size = 17 * 1024 * 1024 + 5;
 let version = '1.15.9', requests = 0, consumed = 0;
 Object.assign(globalThis, {window: {location: {origin}, dispatchEvent() {}}, fetch: async (url: string, init: RequestInit) => {
  if (url.includes('capabilities')) return Response.json({schemaVersion: 1, origin, features: {'api.attachment-content': {version}, 'api.mongodb-endpoint': {version: '1.1.0'}}});
  requests++; assert.ok(url.includes('cache=retain-bytes')); assert.equal(init.credentials, 'same-origin'); assert.equal(init.redirect, 'error');
  return new Response(new ReadableStream({pull(controller) {
   const count = Math.min(1024 * 1024, size - consumed);
   if (!count) {controller.close(); return;}
   consumed += count; controller.enqueue(new Uint8Array(count).fill(137));
  }}, {highWaterMark: 0}), {headers: {ETag: `"${key}:v1"`, 'Content-Length': String(size)}});
 }});
 try {
  rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(false, rootIdentity.read().generation, scope);
  const transport = accountThingTransport(scope, {assertCurrent() {}, onInvalidate: () => () => {}}).files, signal = new AbortController().signal;
  await assert.rejects(transport.bytes('file', key, size, signal), /incompatible/); // Evicts the preceding test's other origin.
  for (const unsupported of ['1.15.9', '2.0.0']) {version = unsupported; await assert.rejects(transport.bytes('file', key, size, signal), /incompatible/);}
  assert.equal(requests, 0);
  version = '1.16.1'; const blob = await transport.bytes('file', key, size, signal);
  assert.ok(blob instanceof Blob); assert.equal(blob.size, size); assert.equal(consumed, size); assert.equal(requests, 1);
  assert.deepEqual(new Uint8Array(await blob.slice(-5).arrayBuffer()), new Uint8Array(5).fill(137));
 } finally {Object.assign(globalThis, saved);}
});


test('atomic attachment edits refuse media-only update contracts before transport', async () => {
 const saved={window:globalThis.window,fetch:globalThis.fetch};
 const origin='https://atomic-binding.test',scope={kind:'account' as const,origin,ownerId:'owner',dataPlane:'home'};
 let version='1.12.0';const mutations:any[]=[];
 Object.assign(globalThis,{window:{location:{origin},dispatchEvent(){}},fetch:async(url:string,init:RequestInit)=>{
  if(url.includes('capabilities'))return Response.json({schemaVersion:1,origin,features:{'api.things':{version:'1.42.0'},'api.things-update':{version},'api.mongodb-endpoint':{version:'1.1.0'}}});
  mutations.push(init);return Response.json({ok:true,thing:{id:'post'}});
 }});
 try{
  rootIdentity.confirm(rootIdentity.read().generation);bindLocalWorkspace(false,rootIdentity.read().generation,scope);
  const transport=accountThingTransport(scope,{assertCurrent(){},onInvalidate:()=>()=>{}});
  const op={id:'post',operationId:'binding',version:1,method:'update' as const,body:{id:'post',attachmentIds:['file'],expectedUpdatedAt:'2026-10-17T00:00:00.000Z'}};
  // First refusal also discards a cached manifest belonging to another origin.
  await assert.rejects(transport.write(op,new AbortController().signal),/incompatible/);
  for(const older of ['1.11.0','1.12.0','2.0.0']){
   version=older;await assert.rejects(transport.write(op,new AbortController().signal),/incompatible/);assert.deepEqual(mutations,[]);
  }
  version='1.13.0';await transport.write(op,new AbortController().signal);
  const writes=mutations.filter(init=>init.method==='PATCH');
  assert.equal(writes.length,1);assert.equal(mutations.length,2);
  assert.deepEqual(JSON.parse(writes[0].body),op.body);
 }finally{Object.assign(globalThis,saved);}
});
