import { cloudSyncHttpError, SyncConnectionWait, SYNC_RETRY_DELAY_MS, SYNC_RETRY_MAX_MS } from './syncConnectionWait';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createSyncRun, executeSyncRun, type SyncRun } from './execute';
import { planFileSync, type SyncEntry, type SyncScope } from './reconcile';
import { EMPTY_CONTENT_SHA256, fingerprintSource, type FingerprintSource } from './contentFingerprint';
import { cloudFileSyncEntry, type CloudFile } from './cloudFile';
import { prepareCloudSyncRun, parseCloudSyncRun } from './cloudWrite';
import { createCloudSyncPort } from './cloudSyncPort.client';
import { cloudRequests, createCloudFileTransport, type CloudTransportRuntime } from './cloudTransport';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';
import { openSyncJournal } from './journal.client';
import type { TransferActivity } from './transferActivity';
const scope: SyncScope = { origin: 'https://sync.test', ownerId: 'owner', dataPlane: 'home', rootId: 'root', deviceId: 'phone' };
const bytes = new Uint8Array([1, 2, 3, 4]);
const source = (): FingerprintSource => ({ size: bytes.length, read: async (offset, size) => bytes.slice(offset, offset + size), check: () => {} });
async function fixture(payload = bytes) {
 const bytes = payload;
 const source = (): FingerprintSource => ({ size: bytes.length, read: async (offset, size) => { assert.ok(bytes.length, 'Empty files must not issue byte reads'); return bytes.slice(offset, offset + size); }, check: () => {} });
 const fingerprint = await fingerprintSource(source());
 const entry: SyncEntry = { id: 'local-file', version: 'v1', path: 'file.bin', kind: 'file', size: bytes.length, ...(bytes.length ? { fingerprint, sha256: null } : { sha256: EMPTY_CONTENT_SHA256 }) };
 let current = { ...scope }, file: CloudFile | null = null, puts = 0, starts = 0, commits = 0, lost: boolean | number = false, ready = false, opens = 0;
 const receipts = new Map<string, { body: string; file: CloudFile }>();
 let hook: ((path: string, body: any) => Response | null) | undefined;
 const runtime: CloudTransportRuntime = { currentScope: () => current, origin: () => scope.origin, requireCapability: async () => {},
  fetch: async (url: any, init: any) => {
   const u = new URL(String(url)), body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
   if (u.origin === 'https://storage.test') {
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.referrerPolicy, 'no-referrer');
    assert.deepEqual(Object.keys(init.headers), ['x-amz-checksum-sha256']); assert.deepEqual(init.body, bytes); puts++; return new Response(null);
   }
   assert.equal(u.origin, scope.origin); assert.equal(init.headers['X-Thingtime-Expected-Actor'], scope.ownerId); assert.equal(init.headers['X-Thingtime-Expected-Data-Plane'], 'home');
   assert.equal(init.credentials, 'same-origin'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
   const override = hook?.(u.pathname, body); if (override) return override;
   if (u.pathname === '/api/v1/files') {
    if (!body) return u.searchParams.has('operationId') ? Response.json({ ok: true, receipt: receipts.has(u.searchParams.get('operationId')!) ? { file: receipts.get(u.searchParams.get('operationId')!)!.file } : null }) : file ? Response.json({ ok: true, file }) : Response.json({ ok: false }, { status: 404 });
    const prior = receipts.get(body.operationId);
    if (prior) return prior.body === JSON.stringify(body) ? Response.json({ ok: true, file: prior.file, replayed: true }) : Response.json({ ok: false }, { status: 409 });
    if (body.expectedRevision !== (file?.revision ?? null)) return Response.json({ ok: false }, { status: 409 });
    file = { id: body.id, name: body.name, folderId: body.folderId, revision: randomUUID(), trashed: body.trashed, content: { attachmentId: 'att1', version: 'a'.repeat(64), size: bytes.length, fingerprint } };
    receipts.set(body.operationId, { body: JSON.stringify(body), file: structuredClone(file) }); commits++;
    if (lost) { const failure = lost; lost = false; if (typeof failure === 'number') return Response.json({ ok: false }, { status: failure, headers: { 'Retry-After': '120' } }); throw Error('Accepted commit response was lost'); }
    return Response.json({ ok: true, file, replayed: false });
   }
   if (u.pathname === '/api/v1/attachments/uploads') { starts++; return Response.json({ ok: true, upload: { id: 'att1', partSizeBytes: fingerprint.partSizeBytes, partCount: fingerprint.partCount, ...(ready || bytes.length === 0 ? { state: 'ready' } : {}) } }); }
   if (u.pathname.endsWith('/parts')) return Response.json({ ok: true, parts: [{ partNumber: 1, url: 'https://storage.test/part', headers: { 'x-amz-checksum-sha256': body.parts[0].checksumSha256 } }] });
   if (u.pathname.endsWith('/complete')) { ready = true; return Response.json({ ok: true }); }
   if (u.pathname.endsWith('/content')) return Response.json({ ok: true, id: 'att1', version: 'a'.repeat(64), size: bytes.length, fingerprint });
   throw Error('Unexpected request');
  } };
 const make = () => prepareCloudSyncRun(createSyncRun(planFileSync({ scope, complete: true, entries: [entry] }, { scope, complete: true, entries: [] }, { scope, entries: [] }, { mode: 'backup', propagateDeletes: false })), [{ before: null, folderId: null }]);
 const port = (run: SyncRun, persist: (run: SyncRun) => Promise<void>, transfer?: (value: TransferActivity) => void) => createCloudSyncPort(run, { transfer, currentScope: () => current, persist, readLocal: async () => entry, openSource: async () => { opens++; return source(); } }, runtime);
 return { make, port, runtime, entry, file: () => file, counts: () => ({ puts, starts, commits, opens }), lose: (status?: number) => { lost = status ?? true; }, context: (next: SyncScope) => { current = next; }, hook: (next: typeof hook) => { hook = next; } };
}
test('real transport joins executor and durable journal, recovering a lost commit without rereading or uploading bytes', async () => {
 const f = await fixture(), factory = new IDBFactory(); let journal = await openSyncJournal(factory); const run = f.make(); f.lose();
 await assert.rejects(executeSyncRun(run, f.port(run, journal.persist)), /response was lost/);
 assert.deepEqual(f.counts(), { puts: 1, starts: 1, commits: 1, opens: 1 }); journal.close();
 journal = await openSyncJournal(factory); const restored = parseCloudSyncRun((await journal.read(scope))!);
 const result = await executeSyncRun(restored, f.port(restored, journal.persist)); assert.ok(result.operations.every(op => op.confirmed));
 assert.deepEqual(f.counts(), { puts: 1, starts: 1, commits: 1, opens: 1 }); assert.equal(f.file()!.id, run.operations[0].id); journal.close();
});
test('upload lease conflicts wait and resume the original durable operation without publishing twice', async () => {
 const f = await fixture(), factory = new IDBFactory(); let journal = await openSyncJournal(factory); const run = f.make();
 const requestIds: string[] = []; let held = true;
 f.hook((path, body) => {
  if (path !== '/api/v1/attachments/uploads') return null;
  requestIds.push(body.requestId);
  return held ? Response.json({ ok: false, code: 'finalization_in_progress', retryable: true }, { status: 409 }) : null;
 });
 await assert.rejects(executeSyncRun(run, f.port(run, journal.persist)), error => error instanceof SyncConnectionWait && /upload-start; finalization_in_progress/.test(error.message));
 assert.equal(f.counts().commits, 0); journal.close(); held = false;
 journal = await openSyncJournal(factory); const restored = parseCloudSyncRun((await journal.read(scope))!);
 const result = await executeSyncRun(restored, f.port(restored, journal.persist));
 assert.ok(result.operations.every(op => op.confirmed)); assert.deepEqual(requestIds, [run.operations[0].id, run.operations[0].id]);
 assert.equal(f.counts().commits, 1); assert.equal(f.counts().puts, 1); journal.close();
});
test('409 recovery requires the exact allowlisted code, retryable flag and upload endpoint; diagnostics discard arbitrary text', async () => {
 const f = await fixture();
 for (const [path, value, waits, diagnostic] of [
  ['/api/v1/attachments/uploads', { ok: false, code: 'upload_initializing', retryable: true }, true, 'upload_initializing'],
  ['/api/v1/attachments/uploads/complete', { ok: false, code: 'finalization_settling', retryable: true }, true, 'finalization_settling'],
  ['/api/v1/attachments/uploads', { ok: false, code: 'finalization_in_progress', retryable: false }, false, 'finalization_in_progress'],
  ['/api/v1/attachments/uploads', { ok: false, code: 'upload_unavailable', retryable: true }, false, 'upload_unavailable'],
  ['/api/v1/attachments/uploads', { ok: false, error: 'Attachment request id is already in use' }, false, 'upload_request_mismatch'],
  ['/api/v1/files', { ok: false, code: 'finalization_settling', retryable: true }, false, 'finalization_settling'],
  ['/api/v1/attachments/uploads', { ok: false, code: 'secret-code', error: 'private-path-or-token', retryable: true }, false, 'conflict_unknown'],
  ['/api/v1/attachments/uploads', { ok: false, code: 'upload_initializing', retryable: true, oversized: 'x'.repeat(4096) }, false, 'conflict_unknown']
 ] as const) {
  f.runtime.fetch = async () => Response.json(value, { status: 409 });
  await assert.rejects(cloudRequests(f.runtime, scope).json(path + '?private-id=never-retain', {}), error => {
   assert.ok(error instanceof Error); assert.equal(error instanceof SyncConnectionWait, waits);
   assert.match(error.message, new RegExp(diagnostic)); assert.doesNotMatch(error.message, /secret-code|private-path-or-token|private-id|never-retain/);
   return true;
  });
 }
 const controller = new AbortController();
 f.runtime.fetch = async () => { controller.abort(); return Response.json({ ok: false, code: 'upload_initializing', retryable: true }, { status: 409 }); };
 await assert.rejects(cloudRequests(f.runtime, scope, controller.signal).json('/api/v1/attachments/uploads', {}), error => (error as Error).name === 'AbortError');
});
test('a failed durable write prevents every network request; pinned destinations cannot be changed on retry', async () => {
 const f = await fixture(), run = f.make();
 await assert.rejects(executeSyncRun(run, f.port(run, async () => { throw Error('disk full'); })), /disk full/); assert.equal(f.counts().starts, 0);
 const journal = await openSyncJournal(new IDBFactory()); await journal.persist(run);
 const changed = structuredClone(run); changed.cloudWrites[0].folderId = 'other-folder';
 await assert.rejects(journal.persist(changed), /cannot change/); journal.close();
});
test('completed upload is reused after interruption before file publication', async () => {
 const f = await fixture(), run = f.make(); let fail = true;
 f.hook((path, body) => { if (path === '/api/v1/files' && body && fail) { fail = false; throw Error('before commit'); } return null; });
 await assert.rejects(executeSyncRun(run, f.port(run, async () => {})), /before commit/);
 await executeSyncRun(run, f.port(run, async () => {})); assert.equal(f.counts().puts, 1); assert.equal(f.counts().commits, 1); assert.equal(f.counts().starts, 2);
});
test('stale destination, foreign receipt, wrong source bytes and context changes preserve the pending operation', async () => {
 const f = await fixture(), run = f.make(), write = run.cloudWrites[0];
 f.context({ ...scope, ownerId: 'other' }); await assert.rejects(createCloudFileTransport(f.runtime, write).apply(source()), /context changed/);
 f.context(scope); f.hook(path => path.endsWith('/uploads') ? (f.context({ ...scope, rootId: 'other' }), null) : null);
 await assert.rejects(createCloudFileTransport(f.runtime, write).apply(source()), /context changed/); assert.equal(f.counts().puts, 0);
 f.context(scope); f.hook(undefined);
 const wrong = { ...source(), read: async () => new Uint8Array([4, 3, 2, 1]) };
 // Use a byte-agnostic PUT mock while retaining all API behavior.
 const original = f.runtime.fetch; f.runtime.fetch = async (url: any, init: any) => new URL(String(url)).origin === 'https://storage.test' ? new Response(null) : original(url, init);
 await assert.rejects(createCloudFileTransport(f.runtime, write).apply(wrong), /planned fingerprint/); assert.equal(f.counts().commits, 0);
 f.hook((path, body) => path === '/api/v1/files' && body ? Response.json({ ok: false }, { status: 409 }) : null);
 await assert.rejects(createCloudFileTransport(f.runtime, write).apply(source()), /409/); assert.equal(f.counts().commits, 0);
 f.hook(path => path === '/api/v1/files' ? Response.json({ ok: true, receipt: { file: { id: 'foreign' } } }) : null);
 await assert.rejects(createCloudFileTransport(f.runtime, write).lookup(), /Invalid cloud file/);
});
test('bounded responses, refused capabilities and hostile signed requests stop safely', async () => {
 const f = await fixture(), run = f.make();
 f.runtime.requireCapability = async () => { throw Error('incompatible'); };
 await assert.rejects(createCloudFileTransport(f.runtime, run.cloudWrites[0]).apply(source()), /incompatible/); assert.equal(f.counts().starts, 0);
 f.runtime.requireCapability = async () => {};
 f.hook(() => new Response('x'.repeat(65537))); await assert.rejects(createCloudFileTransport(f.runtime, run.cloudWrites[0]).lookup(), /too large/);
 f.hook(path => path.endsWith('/parts') ? Response.json({ ok: true, parts: [{ partNumber: 1, url: 'https://storage.test/part', headers: { Authorization: 'forbidden' } }] }) : null);
 await assert.rejects(createCloudFileTransport(f.runtime, run.cloudWrites[0]).apply(source()), /Invalid signed/); assert.equal(f.counts().puts, 0);
});
test('remote Trash uses the pinned original attachment and a guarded receipt, without opening local bytes', async () => {
 const f = await fixture(), first = f.make(); await executeSyncRun(first, f.port(first, async () => {})); const before = f.file()!;
 const expected = cloudFileSyncEntry(before, 'file.bin');
 const run = prepareCloudSyncRun(createSyncRun({ scope, decisions: [{ kind: 'trash', path: 'file.bin', side: 'remote', expected }] }), [{ folderId: null, before }]);
 const port = createCloudSyncPort(run, { currentScope: () => scope, persist: async () => {}, readLocal: async () => null, openSource: async () => { throw Error('must not open'); } }, f.runtime);
 await executeSyncRun(run, port); assert.equal(f.file()!.trashed, true); assert.equal(f.counts().puts, 1);
});

test('full native verification prevents publication after range reads and also checks a ready upload on retry', async () => {
 const f=await fixture(),run=f.make();let checks=0;
 const pinned={...source(),verify:async()=>{checks++;throw Error('Native source changed after its ranges were read');}};
 await assert.rejects(createCloudFileTransport(f.runtime,run.cloudWrites[0]).apply(pinned),/Native source changed/);
 assert.equal(f.counts().commits,0);assert.equal(f.counts().puts,1);assert.equal(checks,1);
 await assert.rejects(createCloudFileTransport(f.runtime,run.cloudWrites[0]).apply(pinned),/Native source changed/);
 assert.equal(f.counts().commits,0);assert.equal(f.counts().puts,1);assert.equal(checks,2);
 await createCloudFileTransport(f.runtime,run.cloudWrites[0]).apply({...source(),verify:async()=>{checks++;}});
 assert.equal(f.counts().commits,1);assert.equal(f.counts().puts,1);assert.equal(checks,3);
});

test('every upload mutation authorizes before its fresh network deadline', async t => {
 const f=await fixture(), run=f.make(), deadlines: AbortController[]=[];
 let approvals=0, mutations=0;
 t.mock.method(AbortSignal,'timeout',(milliseconds:number)=>{
  assert.ok([30_000,120_000].includes(milliseconds));
  const controller=new AbortController();deadlines.push(controller);return controller.signal;
 });
 f.runtime.authorizeMutation=async()=>{
  approvals++;
  for(const deadline of deadlines) deadline.abort(new DOMException('elapsed during authorization','TimeoutError'));
 };
 const fetch=f.runtime.fetch;
 f.runtime.fetch=async(url,init)=>{
  init?.signal?.throwIfAborted();
  if(init?.method==='POST'||init?.method==='PUT') {mutations++;assert.equal(approvals,mutations);}
  return fetch(url,init);
 };
 const transport=createCloudFileTransport(f.runtime,run.cloudWrites[0]);
 await transport.lookup();assert.equal(approvals,0);
 await transport.apply(source());
 assert.equal(mutations,5);assert.equal(approvals,5);
 assert.deepEqual(f.counts(),{puts:1,starts:1,commits:1,opens:0});
});

test('cancellation, scope changes and refused approval stop before sending upload bytes', async()=>{
 for(const failure of ['cancel','scope','refuse']) {
  const f=await fixture(),run=f.make(),controller=new AbortController();let approvals=0;
  f.runtime.authorizeMutation=async()=>{
   if(++approvals!==3)return;
   if(failure==='cancel')controller.abort(new Error('cancelled approval'));
   else if(failure==='scope')f.context({...scope,ownerId:'other'});
   else throw Error('approval refused');
  };
  await assert.rejects(createCloudFileTransport(f.runtime,run.cloudWrites[0],controller.signal).apply(source()),/cancelled approval|context changed|approval refused/);
  assert.equal(f.counts().puts,0);assert.equal(f.counts().commits,0);
 }
});

test('native file-backed uploads keep journal IDs and verified fingerprints without reading bytes into the browser', async () => {
 const f = await fixture(), run = f.make(), write = run.cloudWrites[0];
 let nativeCalls = 0, reads = 0;
 const digest = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
 const native: FingerprintSource = { ...source(), read: async () => { reads++; throw Error('Browser must not read upload bytes'); },
  uploadPart: async request => {
   assert.deepEqual(request, {uploadId:'att1',requestId:write.operation.id,partNumber:1,offset:0,length:4});
   nativeCalls++; return {sha256:digest};
  } };
 const receipt = await createCloudFileTransport(f.runtime,write).apply(native);
 assert.equal(receipt.operationId,write.operation.id); assert.equal(nativeCalls,1); assert.equal(reads,0); assert.equal(f.counts().puts,0);
 await createCloudFileTransport(f.runtime,write).apply(native);
 assert.equal(nativeCalls,1,'Accepted cloud receipt avoids repeated native upload');
});
test('invalid native upload hashes and cancellation cannot finalize or publish', async () => {
 for (const sha256 of ['invalid','0'.repeat(64)]) {
  const f=await fixture(), write=f.make().cloudWrites[0];let completed=0;
  f.hook(path=>{if(path.endsWith('/complete'))completed++;return null;});
  await assert.rejects(createCloudFileTransport(f.runtime,write).apply({...source(),uploadPart:async()=>({sha256})}),/digest|fingerprint/);
  assert.equal(completed,0);assert.equal(f.counts().commits,0);
 }
 const f=await fixture(), abort=new AbortController();
 await assert.rejects(createCloudFileTransport(f.runtime,f.make().cloudWrites[0],abort.signal).apply({...source(),uploadPart:async()=>{
  abort.abort();return {sha256:'0'.repeat(64)};
 }}),{name:'AbortError'});
 assert.equal(f.counts().commits,0);
});
test('an uncertain native part retries the same reservation before any completion or file publication',async()=>{
 const f=await fixture(), write=f.make().cloudWrites[0], requests:unknown[]=[];
 const digest=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 const native:FingerprintSource={...source(),read:async()=>{throw Error('Unexpected browser read');},uploadPart:async request=>{
  requests.push(structuredClone(request));if(requests.length===1)throw Error('Accepted native part reply lost');return {sha256:digest};
 }};
 await assert.rejects(createCloudFileTransport(f.runtime,write).apply(native),/reply lost/);
 assert.equal(f.counts().commits,0);
 await createCloudFileTransport(f.runtime,write).apply(native);
 assert.deepEqual(requests[0],requests[1]);assert.equal(f.counts().commits,1);assert.equal(f.counts().puts,0);
});

test('whole-file handoff independently verifies stored bytes before canonical publication and recovers accepted completion',async()=>{
 for(const mismatch of [false,true]) {
  const f=await fixture(),run=f.make();let jobs=0,completes=0;
  f.runtime.nativeUploadApproval={id:scope.rootId,updatedAt:'2026-10-18T00:00:00Z',scope,
   configuration:{configurationVersion:1,name:'Backup',deviceId:scope.deviceId,localRootId:'local',remoteFolderId:'cloud',mode:'backup',paused:false,propagateDeletes:false,network:'any',chargingOnly:false,excludedPaths:[]}};
  const fetch=f.runtime.fetch;
  f.runtime.fetch=async(url,init)=>{if(String(url).endsWith('/complete'))completes++;return fetch(url,init);};
  if(mismatch)f.hook((path)=>path.endsWith('/content')?Response.json({ok:true,id:'att1',version:'a'.repeat(64),size:bytes.length,fingerprint:{...f.entry.fingerprint,sha256:'f'.repeat(64)}}):null);
  const native={...source(),read:async()=>{throw Error('No JS byte reads');},uploadFile:async(request:any)=>{
   jobs++;assert.equal(request.requestId,run.cloudWrites[0].operation.id);assert.equal(request.uploadId,'att1');
   assert.deepEqual(request.authorization,f.runtime.nativeUploadApproval);return {fingerprint:f.entry.fingerprint!};
  }};
  if(mismatch)await assert.rejects(createCloudFileTransport(f.runtime,run.cloudWrites[0]).apply(native),/Uploaded bytes/);
  else {
   await createCloudFileTransport(f.runtime,run.cloudWrites[0]).apply(native);
   await createCloudFileTransport(f.runtime,run.cloudWrites[0]).apply(native);
  }
  assert.equal(jobs,1);assert.equal(completes,0);assert.equal(f.counts().puts,0);assert.equal(f.counts().commits,mismatch?0:1);
 }
});


test('speed telemetry counts payload once and logical files only after durable confirmation', async () => {
 const f = await fixture(), run = f.make(), events: TransferActivity[] = [];
 let durable = false;
 await executeSyncRun(run, f.port(run, async value => { durable = value.operations.every(op => op.confirmed); }, event => {
  if ('kind' in event) assert.equal(durable, true);
  events.push(event);
 }));
 assert.deepEqual(events, [{ direction: 'upload', bytes: 4 }, { direction: 'upload', kind: 'file' }]);
 events.length = 0;
 await executeSyncRun(run, f.port(run, async () => {}, event => events.push(event)));
 assert.deepEqual(events, [], 'receipt recovery is not new transfer traffic or a new copied file');
});

test('ready attachment reuse and failed journal confirmations do not inflate throughput', async () => {
 const f = await fixture(), run = f.make(), events: TransferActivity[] = []; let fail = true;
 f.hook((path, body) => { if (path === '/api/v1/files' && body && fail) { fail = false; throw Error('before publication'); } return null; });
 await assert.rejects(executeSyncRun(run, f.port(run, async () => {}, event => events.push(event))), /before publication/);
 assert.deepEqual(events, [{ direction: 'upload', bytes: 4 }]); events.length = 0;
 await assert.rejects(executeSyncRun(run, f.port(run, async value => { if (value.operations.every(op => op.confirmed)) throw Error('journal full'); }, event => events.push(event))), /journal full/);
 assert.deepEqual(events, [], 'ready attachment has no new bytes and failed journal has no confirmed file');
});


test('native empty files publish a durable cloud receipt and replay a lost reply without multipart IO', async () => {
 const f = await fixture(new Uint8Array()), factory = new IDBFactory(); let journal = await openSyncJournal(factory);
 const run = f.make(); f.lose();
 await assert.rejects(executeSyncRun(run, f.port(run, journal.persist)), /response was lost/);
 assert.deepEqual(f.counts(), { puts: 0, starts: 1, commits: 1, opens: 1 });
 assert.deepEqual(cloudFileSyncEntry(f.file(), 'file.bin'), { ...f.entry, id: run.operations[0].id, version: f.file()!.revision });
 journal.close(); journal = await openSyncJournal(factory);
 const restored = parseCloudSyncRun((await journal.read(scope))!);
 assert.ok((await executeSyncRun(restored, f.port(restored, journal.persist))).operations.every(op => op.confirmed));
 assert.deepEqual(f.counts(), { puts: 0, starts: 1, commits: 1, opens: 1 }); journal.close();
});

test('empty uploads require a ready stored object and a canonical content digest', async () => {
 for (const bad of ['unready', 'digest'] as const) {
  const f = await fixture(new Uint8Array()), run = f.make();
  f.hook((path) => bad === 'unready' && path.endsWith('/uploads')
   ? Response.json({ ok: true, upload: { id: 'att1', partSizeBytes: 8388608, partCount: 0, state: 'uploading' } })
   : bad === 'digest' && path.endsWith('/content')
    ? Response.json({ ok: true, id: 'att1', version: 'a'.repeat(64), size: 0, fingerprint: { algorithm: 'sha256-parts-v1', partSizeBytes: 8388608, partCount: 0, sha256: 'a'.repeat(64) } }) : null);
  await assert.rejects(executeSyncRun(run, f.port(run, async () => {})), bad === 'unready' ? /durably stored/ : /Invalid cloud file/);
  assert.equal(f.counts().puts, 0); assert.equal(f.counts().commits, 0);
 }
});


test('uploads negotiate finalization recovery before any network request on older or breaking origins', async () => {
 for (const version of [undefined, '1.6.0', '2.0.0']) {
  const f = await fixture(), run = f.make(); let negotiated = false;
  f.runtime.requireCapability = async (feature, minimum) => {
   if (feature !== 'api.attachment-uploads') return;
   negotiated = true; assert.equal(minimum, '1.6.1');
   if (!capabilitySatisfies(version, minimum)) throw Error('Finalization recovery needs the updated server');
  };
  await assert.rejects(executeSyncRun(run, f.port(run, async () => {})), /updated server/);
  assert.ok(negotiated); assert.deepEqual(f.counts(), { puts: 0, starts: 0, commits: 0, opens: 0 });
 }
});
test('empty-file uploads negotiate the new storage contract before any network request', async () => {
 const f = await fixture(new Uint8Array()), run = f.make();
 const seen: string[] = [];
 f.runtime.requireCapability = async (feature, minimum) => { seen.push(feature + '@' + minimum); if (feature === 'api.files') throw Error('Empty files need the updated server'); };
 await assert.rejects(executeSyncRun(run, f.port(run, async () => {})), /updated server/);
 assert.ok(seen.includes('api.files@1.8.0'));
 assert.deepEqual(f.counts(), { puts: 0, starts: 0, commits: 0, opens: 0 });
});


test('an accepted commit followed by HTTP503 preserves its durable receipt and never uploads or commits again on resume', async () => {
 const f = await fixture(), factory = new IDBFactory(), run = f.make();
 let journal = await openSyncJournal(factory);
 f.lose(503);
 await assert.rejects(executeSyncRun(run, f.port(run, journal.persist)), error => {
  assert.ok(error instanceof SyncConnectionWait); assert.equal(error.retryAfterMs, 120_000); return true;
 });
 assert.equal((await journal.read(scope))!.operations[0].confirmed, false);
 assert.deepEqual(f.counts(), { puts: 1, starts: 1, commits: 1, opens: 1 });
 journal.close(); journal = await openSyncJournal(factory);
 const restored = parseCloudSyncRun((await journal.read(scope))!);
 assert.equal(restored.operations[0].id, run.operations[0].id);
 const completed = await executeSyncRun(restored, f.port(restored, journal.persist));
 assert.equal(completed.operations[0].confirmed, true);
 assert.deepEqual(f.counts(), { puts: 1, starts: 1, commits: 1, opens: 1 }); journal.close();
});

test('cloud HTTP retry classification is status-only and Retry-After is bounded', () => {
 for (const status of [408, 429, 500, 502, 503, 504, 599]) assert.ok(cloudSyncHttpError(status) instanceof SyncConnectionWait);
 for (const status of [400, 401, 403, 404, 409, 412, 413, 422]) assert.equal(cloudSyncHttpError(status) instanceof SyncConnectionWait, false);
 const now = Date.UTC(2026, 9, 20);
 for (const [header, delay] of [[null, SYNC_RETRY_DELAY_MS], ['invalid', SYNC_RETRY_DELAY_MS], ['0', SYNC_RETRY_DELAY_MS], ['1', SYNC_RETRY_DELAY_MS],
  ['120', 120_000], [new Date(now + 90_000).toUTCString(), 90_000], ['999999999999999999999999', SYNC_RETRY_MAX_MS], ['9'.repeat(129), SYNC_RETRY_DELAY_MS]] as const)
  assert.equal((cloudSyncHttpError(503, header, now) as SyncConnectionWait).retryAfterMs, delay);
});


test('temporary responses never hide context changes, explicit cancellation, malformed content or capability failures', async () => {
 for (const kind of ['cancel', 'identity', 'malformed', 'capability', 'authority'] as const) {
  const controller = new AbortController(); let current = scope;
  const runtime: CloudTransportRuntime = { origin: () => scope.origin, currentScope: () => current,
   requireCapability: async () => { if (kind === 'capability') throw Error('Capability mismatch'); },
   fetch: async () => {
    if (kind === 'cancel') controller.abort(Error('Explicit Stop'));
    if (kind === 'identity') current = { ...scope, ownerId: 'other' };
    return kind === 'malformed' ? new Response('{invalid') : new Response('private response must not appear', { status: kind === 'authority' ? 403 : 503 });
   } };
  const transport = cloudRequests(runtime, scope, controller.signal);
  await assert.rejects(async () => { await transport.negotiate({ 'api.files': '1.8.0' }); await transport.json('/api/v1/files'); }, error => {
   assert.equal(error instanceof SyncConnectionWait, false, kind);
   assert.doesNotMatch((error as Error).message, /private response/); return true;
  });
 }
});

test('an internal request deadline is resumable even when fetch reports generic AbortError', async () => {
 const deadline = new DOMException('Timed out', 'TimeoutError');
 const timeout = mock.method(AbortSignal, 'timeout', () => AbortSignal.abort(deadline));
 try {
  const runtime: CloudTransportRuntime = { origin: () => scope.origin, currentScope: () => scope, requireCapability: async () => {},
   fetch: async () => { throw new DOMException('Aborted', 'AbortError'); } };
  await assert.rejects(cloudRequests(runtime, scope).json('/api/v1/files'), SyncConnectionWait);
 } finally { timeout.mock.restore(); }
});

test('temporary HTTP failure reason distinguishes bounded fixed upstream and proxy codes without exposing response data', async () => {
 for(const [code,header,label] of [
  ['storage_unavailable',scope.origin,'storage_unavailable; proxy-selected-origin'],
  ['LOCAL_API_NOT_CONFIGURED',null,'LOCAL_API_NOT_CONFIGURED; proxy-missing'],
  ['private-path?secret', 'https://private.invalid/secret','response_unknown; proxy-mismatch']
 ] as const) {
  const runtime={currentScope:()=>scope,origin:()=>scope.origin,requireCapability:async()=>{},fetch:async()=>Response.json({ok:false,code,error:'/private/secret'},
   {status:503,headers:header?{'x-thingtime-api-fallback':header}:{}})};
  await assert.rejects(cloudRequests(runtime,scope).json('/api/v1/attachments/uploads',{requestId:'fixture'}),error=>{
   assert.ok(error instanceof SyncConnectionWait);assert.match(error.message,new RegExp(`503; upload-start; ${label}`));
   assert.doesNotMatch(error.message,/private|secret|https:/);return true;
  });
 }
});
