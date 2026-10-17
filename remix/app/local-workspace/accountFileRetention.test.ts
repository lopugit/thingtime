import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { AccountFileSync, type AccountFileRetentionTransport } from './accountFiles';
import { WorkspaceDatabase, WORKSPACE_LIMITS, type WorkspaceTransaction } from './storage';
const scope = { kind: 'account' as const, ownerId: 'owner', origin: 'https://files.test', dataPlane: 'home' };
function fixture() {
 const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange);
 let now = Date.parse('2026-10-17T00:00:00Z'), retired = false;
 const lease = { assertCurrent() { if (retired) throw new Error('Retired'); }, onInvalidate: () => () => {} };
 const files = new AccountFileSync(db, scope, lease, () => now), bytes = new TextEncoder().encode('Previously uploaded file bytes');
 const remote = { ok: true, cacheKey: 'a'.repeat(64) + ':original', size: bytes.length, file: { ownerId: scope.ownerId, updatedAt: new Date(now).toISOString(), folderId: null as string | null,
  attachment: { id: 'account-file', name: 'existing.txt', size: bytes.length, contentType: 'text/plain', mediaKind: 'file', title: 'Original title' } } };
 const calls: any[] = [];
 const transport = {
  retention: async () => structuredClone(remote), bytes: async () => { calls.push('read'); return bytes; },
  start: async () => { throw Error('Retained files must never upload'); }, parts: async () => { throw Error('Must not request parts'); }, put: async () => { throw Error('Must not PUT'); }, complete: async () => { throw Error('Must not complete'); },
  get: async () => ({ id: remote.file.attachment.id, author: { id: scope.ownerId }, thingtime: ['attachment'], crystal: remote.file.attachment, folderId: remote.file.folderId, updatedAt: remote.file.updatedAt }),
  annotate: async (input: any) => { calls.push(input); assert.equal(input.id, remote.file.attachment.id); assert.equal(input.expectedUpdatedAt, remote.file.updatedAt); for (const key of ['title','description','filenamePreview']) if (key in input) (remote.file.attachment as any)[key] = input[key]; remote.file.updatedAt = new Date(++now).toISOString(); return { attachment: remote.file.attachment, updatedAt: remote.file.updatedAt }; },
  move: async () => { throw Error('Unexpected move'); },
  remove: async (input: any) => { calls.push(input); assert.equal(input.retainReceipt, true); assert.equal(input.requestId, undefined); return { deleted: true as const, deferred: false }; }
 };
 return { db, files, bytes, remote, transport, calls, lease, advance() { now += 1000; }, retire() { retired = true; } };
}
test('retained account files use canonical metadata, scoped bytes and existing edit/delete queues without uploading', async () => {
 const f = fixture();
 try {
  const { row, changed } = await f.files.retain(f.transport, 'account-file'); assert.equal(changed, true);
  assert.match(row.id, /^local-file-account-/); assert.equal(row.localAttachment.requestId, undefined);
  assert.equal(row.crystal.title, 'Original title'); assert.equal(await f.files.remoteId(row.id), 'account-file');
  assert.deepEqual((await f.files.readFile(row.id)).bytes, f.bytes); assert.equal((await f.files.sync(f.transport)).completed, 0);
  assert.deepEqual(f.calls, ['read']); assert.equal((await f.files.library()).aliases.get('account-file'), row.id);
  for (const other of [{...scope,ownerId:'other'},{...scope,dataPlane:'other'},{...scope,origin:'https://other.test'}]) assert.equal((await new AccountFileSync(f.db,other,f.lease).library()).things.length,0);
  f.advance(); await f.files.things.annotateFile({ id: row.id, title: 'Edited offline' });
  await f.files.sync(f.transport); assert.equal(f.remote.file.attachment.title,'Edited offline');
  assert.equal(f.calls.filter((c: unknown) => typeof c === 'object' && c !== null && 'title' in c).length,1);
  await f.files.remove(row.id); assert.equal((await f.files.library()).things.length,0);
  await assert.rejects(f.files.retain(f.transport,'account-file'), /deleted/);
  await f.files.sync(f.transport); assert.equal((await f.files.library()).aliases.get('account-file'),null);
  await f.db.transaction(scope,'readonly',f.lease, async tx => { assert.equal(await tx.getBytes(row.id),undefined); assert.equal((await tx.list('account-files')).length,1); });
 } finally { await f.db.close(); }
});
test('retention reconciles clean remote details while preserving offline edits and immutable operations', async () => {
 const f=fixture();
 try {
  const {row}=await f.files.retain(f.transport,'account-file'); f.advance();
  f.remote.file.attachment.title='New account title'; f.remote.file.updatedAt='2026-10-17T00:00:01.000Z';
  assert.equal((await f.files.retain(f.transport,'account-file')).row.crystal.title,'New account title');
  assert.deepEqual(f.calls,['read'],'Unchanged immutable bytes are read from scoped storage');
  await f.files.things.annotateFile({id:row.id,title:'Local title'}); f.advance();
  (f.remote.file.attachment as any).description='Account description'; f.remote.file.updatedAt='2026-10-17T00:00:02.000Z';
  assert.equal((await f.files.retain(f.transport,'account-file')).row.crystal.title,'Local title');
  await f.files.sync(f.transport);
  const local=(await f.files.views([row.id]))[0]; assert.equal(local.crystal.title,'Local title'); assert.equal(local.crystal.description,'Account description');
  assert.equal(f.remote.file.attachment.title,'Local title');
 } finally {await f.db.close();}
});
test('foreign, linked, oversized or malformed descriptors never persist bytes or create upload intent', async () => {
 for(const mutate of [ (r:any)=>r.file.ownerId='foreign', (r:any)=>r.file.attachment.url='https://foreign.test/file', (r:any)=>r.size++, (r:any)=>r.cacheKey='url-secret', (r:any)=>r.file.updatedAt='bad', (r:any)=>{r.size=r.file.attachment.size=17*1024*1024;} ]) {
  const f=fixture(); try {mutate(f.remote);await assert.rejects(f.files.retain(f.transport,'account-file')); assert.deepEqual(f.calls,[]); assert.deepEqual(await f.files.status(),[]); assert.deepEqual((await f.files.library()).things,[]);} finally {await f.db.close();}
 }
});
test('truncation, changed snapshots, retirement and quota failures leave no partial retention', async () => {
 for(const mode of ['truncated','changed','retired','quota']) {
  const f=fixture(); try {
   const transport:AccountFileRetentionTransport={...f.transport,bytes:async()=>{
    if(mode==='changed')f.remote.file.updatedAt='2026-10-17T00:00:01.000Z';
    if(mode==='retired')f.retire(); return mode==='truncated'?f.bytes.slice(1):f.bytes;
   }};
   if(mode==='quota')await f.db.transaction(scope,'readwrite',f.lease,async tx=>{for(let i=0;i<4;i++)await tx.putBytes('fill-'+i,new Uint8Array(16*1024*1024));});
   await assert.rejects(f.files.retain(transport,'account-file'));
   if(mode!=='retired') {assert.equal((await f.files.library()).things.length,0);assert.deepEqual(await f.files.metadata.status(),[]);assert.deepEqual(await f.files.status(),[]);}
  }finally{await f.db.close();}
 }
});
test('cross-tab retention converges on one identity and rejects changed immutable bytes', async () => {
 const f=fixture(); try {
  const other=new AccountFileSync(f.db,scope,f.lease);
  const [a,b]=await Promise.all([f.files.retain(f.transport,'account-file'),other.retain(f.transport,'account-file')]);
  assert.equal(a.row.id,b.row.id); assert.equal((await f.files.library()).things.length,1);
  await f.db.transaction(scope,'readonly',f.lease,async tx=>assert.equal((await tx.list('account-files')).length,1));
  f.advance(); f.remote.cacheKey='b'.repeat(64)+':original';
  await assert.rejects(f.files.retain(f.transport,'account-file'),/bytes or identity changed/);
  assert.deepEqual((await f.files.readFile(a.row.id)).bytes,f.bytes);
 }finally{await f.db.close();}
});
test('retention coalesces reads and cannot resurrect a file deleted in flight', async () => {
 const f=fixture(); try {
  const {row}=await f.files.retain(f.transport,'account-file'); f.advance();
  let resume!:()=>void, entered!:()=>void; const ready=new Promise<void>(r=>{entered=r;}), hold=new Promise<void>(r=>{resume=r;});let reads=0;
  const transport={...f.transport,retention:async()=>{reads++;entered();await hold;return structuredClone(f.remote);}};
  const a=f.files.retain(transport,'account-file'), b=f.files.retain(transport,'account-file');
  await ready;await f.files.remove(row.id);resume();await assert.rejects(a,/deleted/);await assert.rejects(b,/deleted/);assert.equal(reads,1);assert.equal((await f.files.library()).things.length,0);
 }finally{await f.db.close();}
});
test('retention admits at most three distinct files at once and releases admission after failure', async () => {
 const f=fixture(); let resume!:()=>void;
 const hold=new Promise<void>(r=>{resume=r;});
 const transport={...f.transport,retention:async()=>{await hold;throw Error('Unavailable');}};
 try {
  const pending=['a','b','c'].map(id=>assert.rejects(f.files.retain(transport,id),/Unavailable/));
  await assert.rejects(f.files.retain(transport,'d'),/Other files/); resume(); await Promise.all(pending);
  assert.equal((await f.files.retain(f.transport,'account-file')).changed,true);
 }finally{resume();await f.db.close();}
});
test('an upload completed while retention reads bytes keeps its original local identity and request', async () => {
 const f=fixture();
 try {
  const requestId=crypto.randomUUID();
  const local=await f.files.things.saveFile({requestId,name:'existing.txt',contentType:'text/plain',bytes:f.bytes,purpose:'file'});
  let resume!:()=>void,entered!:()=>void;const hold=new Promise<void>(r=>{resume=r;}),ready=new Promise<void>(r=>{entered=r;});
  const retaining=f.files.retain({...f.transport,bytes:async()=>{entered();await hold;return f.bytes;}},'account-file');
  await ready;
  assert.equal((await f.files.sync({...f.transport,start:async()=>({id:'account-file',partSizeBytes:f.bytes.length,partCount:1}),parts:async(_id,parts)=>parts.map(part=>({...part,url:'https://storage.test/part',headers:{},expiresAt:'2026-10-18'})),put:async()=>{},complete:async()=>f.remote.file.attachment as any})).completed,1);
  resume(); assert.equal((await retaining).row.id,local.id);
  assert.equal((await f.files.library()).things.length,1);
  await f.db.transaction(scope,'readonly',f.lease,async tx=>{const records=await tx.list<any>('account-files');assert.equal(records.length,1);assert.equal(records[0].value.request.requestId,requestId);assert.equal(records[0].value.source,undefined);});
 }finally{await f.db.close();}
});
test('conflicting account and offline edits remain reviewable after retention refresh', async () => {
 const f=fixture();try{
  const {row}=await f.files.retain(f.transport,'account-file');
  await f.files.things.annotateFile({id:row.id,title:'Local title'});f.advance();
  f.remote.file.attachment.title='Concurrent account title';f.remote.file.updatedAt='2026-10-17T00:00:01.000Z';
  await f.files.retain(f.transport,'account-file');await f.files.sync(f.transport);
  assert.equal((await f.files.status())[0].state,'conflict');
  assert.equal((await f.files.views([row.id]))[0].crystal.title,'Local title');assert.equal(f.remote.file.attachment.title,'Concurrent account title');
  assert.equal(f.calls.filter(c=>typeof c==='object').length,0);
 }finally{await f.db.close();}
});
test('retained existing files can be removed at the exact device quota', async () => {
 const f=fixture();try{
  const {row}=await f.files.retain(f.transport,'account-file');
  await f.db.transaction(scope,'readwrite',f.lease,async tx=>{let remaining=WORKSPACE_LIMITS.bytes-(await tx.usage()).bytes,index=0;while(remaining){const size=Math.min(remaining,WORKSPACE_LIMITS.binaryBytes);await tx.putBytes('fill-'+index++,new Uint8Array(size));remaining-=size;}});
  await f.files.remove(row.id);await f.files.sync(f.transport);
  assert.deepEqual(await f.files.status(),[]);assert.equal((await f.files.library()).aliases.get('account-file'),null);
 }finally{await f.db.close();}
});
test('aborting during the final storage transaction rolls back retained bytes, metadata and alias', async () => {
 const f=fixture(),controller=new AbortController(),original=f.db.transaction.bind(f.db);
 f.db.transaction=async(scope,mode,lease,run)=>original(scope,mode,lease,async tx=>run(mode==='readwrite'?{
  ...tx,putBytes:async(...args:Parameters<WorkspaceTransaction['putBytes']>)=>{await tx.putBytes(...args);controller.abort();}
 }:tx));
 try{
  await assert.rejects(f.files.retain(f.transport,'account-file',controller.signal));
  f.db.transaction=original;
  await f.db.transaction(scope,'readonly',f.lease,async tx=>{assert.equal((await tx.usage()).records,0);});
 }finally{await f.db.close();}
});
