import { createQuotaFactory, TEST_STORAGE_CAPACITY } from './storageTestFixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { IDBKeyRange } from 'fake-indexeddb';
import { AccountFileSync, type AccountFileTransport } from './accountFiles';
import { AccountThingSync, type AccountSyncTransport, type AccountThing } from './accountSync';
import { AccountDiscussionCache } from './accountDiscussions';
import { exportAccountThings } from './accountExport';
import { localPostProjection } from './posts';
import { WorkspaceDatabase } from './storage';

function fixture() {
 const db = new WorkspaceDatabase(createQuotaFactory(), undefined, undefined, IDBKeyRange);
 const scope = { kind: 'account', origin: 'https://media.test', ownerId: 'owner', dataPlane: 'home' } as const;
 let now = Date.now(); const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
 const files = new AccountFileSync(db, scope, lease, () => now), sync = new AccountThingSync(db, scope, lease, () => now, undefined, files.contentHooks);
 const bytes = new TextEncoder().encode('exact device file'), uploads: any[] = [], writes: any[] = [], remote = new Map<string, AccountThing>();
 const receipts = new Map<string, any>();
 const upload: AccountFileTransport = {
  start: async request => { uploads.push(request); const id = 'account-' + request.requestId; receipts.set(id, {id, name: request.filename, contentType: request.contentType, size: request.sizeBytes, mediaKind: 'image'}); return {id,partSizeBytes:bytes.length,partCount:1}; },
  parts: async (_id, parts) => parts.map(part => ({...part,url:'https://storage.test/part',expiresAt:'2026-10-17',headers:{}})),
  put: async (_part, body) => { assert.deepEqual(body,bytes); }, complete: async id => receipts.get(id)
 };
 const content: AccountSyncTransport = {
  get: async id => { if (!remote.has(id)) throw {status:404}; return structuredClone(remote.get(id)!); },
  write: async op => {
   writes.push(structuredClone(op));
   const {attachmentIds,...body} = op.body;
   const row = {...body,id:op.id,author:{id:scope.ownerId},createdAt:new Date(now).toISOString(),updatedAt:new Date(++now).toISOString(),revision:1,
    attachments: (attachmentIds as string[] || []).map(id => receipts.get(id))} as unknown as AccountThing;
   remote.set(op.id,row); return row;
  }
 };
 const select = (purpose: 'post' | 'comment' = 'post') => files.things.saveFile({requestId:randomUUID(),name:'portrait.png',contentType:'image/png',bytes,purpose});
 return {db,scope,lease,files,sync,bytes,uploads,writes,remote,receipts,upload,content,select,tick(){now += 120000;}};
}

test('unsubmitted account media stays on device, can be discarded, and does not stall standalone uploads',async()=>{
 const f=fixture();try{
  const selection=await f.select();
  assert.equal((await f.files.sync(f.upload)).completed,0);assert.deepEqual(f.uploads,[]);
  await f.files.things.saveFile({requestId:randomUUID(),name:'portrait.png',contentType:'image/png',bytes:f.bytes,purpose:'file'});
  assert.equal((await f.files.sync(f.upload)).completed,1);assert.equal(f.uploads[0].purpose,'file');
  await f.files.discardSelection(selection.id);await f.files.discardSelection(selection.id);
  await assert.rejects(f.files.readFile(selection.id));assert.equal(f.uploads.length,1);
 }finally{await f.db.close();}
});

test('post and comment files bind atomically locally and wait for verified receipts before native account writes',async()=>{
 const f=fixture();try{
  const file=await f.select(), root=await f.sync.things.savePost({thingtime:['post'],crystal:{type:'image',images:[]},attachmentIds:[file.id]});
  assert.equal((await f.files.readFile(file.id)).row.targetId,root.id);
  await assert.rejects(f.files.discardSelection(file.id),/owning editor/);
  assert.equal((await f.sync.sync(f.content)).completed,0);assert.deepEqual(f.writes,[]);
  const replyFile=await f.select('comment'),reply=await f.sync.things.savePost({thingtime:['post','comment'],targetId:root.id,crystal:{type:'text',text:'Reply with a file'},attachmentIds:[replyFile.id]});
  const exported=await exportAccountThings({ids:[root.id,reply.id]}, {sync:f.sync,files:f.files,db:f.db,lease:f.lease,canRefresh:()=>false,remote:async()=>{throw Error('Unexpected network');}});
  assert.equal(exported.plan.files.length,2);for(const item of exported.plan.files)assert.deepEqual(await exported.plan.readLocalFile(item.id),f.bytes);
  await f.files.sync(f.upload);await f.sync.sync(f.content);
  assert.equal(f.uploads.length,2);assert.deepEqual(new Set(f.uploads.map(row=>row.purpose)),new Set(['post','comment']));
  assert.equal(f.writes.length,2);assert.equal(f.writes[0].id,root.id);assert.equal(f.writes[1].id,reply.id);
  assert.ok(f.writes.every(op=>op.body.attachmentIds.length===1&&op.body.attachmentIds[0].startsWith('account-')));
  assert.deepEqual(f.writes[1].body.acl,['tt:inherit']);
  assert.ok((await f.sync.status()).every(row=>row.state==='synced'));
  const local=(await f.sync.things.get(root.id))!,post=localPostProjection(local,await f.sync.things.snapshot(),f.scope.ownerId);
  assert.equal(post.attachments[0].id,file.id);assert.deepEqual((await f.files.readFile(file.id)).bytes,f.bytes);
  const after=await exportAccountThings({ids:[root.id,reply.id]}, {sync:f.sync,files:f.files,db:f.db,lease:f.lease,canRefresh:()=>false,remote:async()=>{throw Error('Unexpected network');}});
  assert.equal(after.plan.files.length,2);
 }finally{await f.db.close();}
});

test('wrong-purpose bindings roll back and a failed upload preserves both file and post locally',async()=>{
 const f=fixture();try{
  const file=await f.select('comment');
  await assert.rejects(f.sync.things.savePost({thingtime:['post'],crystal:{type:'text',text:'Invalid'},attachmentIds:[file.id]}),/another Thing/);
  assert.equal((await f.files.readFile(file.id)).row.targetId,undefined);assert.deepEqual(await f.sync.status(),[]);
  const valid=await f.select(),post=await f.sync.things.savePost({thingtime:['post'],crystal:{type:'text',text:'Preserved'},attachmentIds:[valid.id]});
  await f.files.sync({...f.upload,start:async()=>{throw {status:403};}});await f.sync.sync(f.content);
  assert.deepEqual(f.writes,[]);assert.equal((await f.sync.view(post.id))!.crystal.text,'Preserved');assert.deepEqual((await f.files.readFile(valid.id)).bytes,f.bytes);
 }finally{await f.db.close();}
});

test('lost content responses retain ordered attachment IDs and do not acknowledge a different binding',async()=>{
 const f=fixture();try{
  const a=await f.select(),b=await f.select(),post=await f.sync.things.savePost({thingtime:['post'],crystal:{type:'text',text:'Original'},attachmentIds:[a.id,b.id]});
  await f.files.sync(f.upload);
  await f.sync.sync({...f.content,write:async op=>{await f.content.write(op,new AbortController().signal);throw Error('Lost');},get:async id=>({...await f.content.get(id,new AbortController().signal),attachments:[]} as any)});
  assert.equal((await f.sync.status())[0].state,'pending');const frozen=structuredClone(f.writes[0]);
  await f.sync.things.savePost({id:post.id,thingtime:['post'],crystal:{text:'New edit'},attachmentIds:[b.id,a.id]},true);f.tick();
  await f.sync.sync(f.content);assert.deepEqual(f.writes[1],frozen);assert.deepEqual(f.writes[2].body.attachmentIds,[...frozen.body.attachmentIds].reverse());
  assert.equal((await f.sync.status())[0].state,'synced');
 }finally{await f.db.close();}
});


test('refusing a synced parent hides its file bytes and descendant media without destroying recovery',async()=>{
 const f=fixture();try{
  const file=await f.select(),root=await f.sync.things.savePost({thingtime:['post'],crystal:{type:'text',text:'Private root'},attachmentIds:[file.id]});
  const replyFile=await f.select('comment');await f.sync.things.savePost({thingtime:['post','comment'],targetId:root.id,crystal:{type:'text',text:'Private reply'},attachmentIds:[replyFile.id]});
  await f.files.sync(f.upload);await f.sync.sync(f.content);
  assert.deepEqual((await f.files.readFile(replyFile.id)).bytes,f.bytes);
  await new AccountDiscussionCache(f.db,f.scope,f.lease).forget(root.id);
  for(const id of [file.id,replyFile.id]){
   await assert.rejects(f.files.readFile(id),(error:any)=>error.status===404);
   assert.deepEqual((await f.files.things.readFile(id)).bytes,f.bytes,'recovery bytes remain scoped and intact');
  }
 }finally{await f.db.close();}
});


const removalTransport=(f:ReturnType<typeof fixture>,remove:any)=>({...f.upload,remove,
 get:async(id:string)=>({id,author:{id:f.scope.ownerId},thingtime:['attachment'],crystal:f.receipts.get(id),updatedAt:'2026-10-17T00:00:00.000Z'})});

test('bound removal completes locally before upload and preserves the remaining post selection',async()=>{
 const f=fixture();try{
  const a=await f.select(),b=await f.select(),post=await f.sync.things.savePost({thingtime:['post'],crystal:{type:'text',text:'Keep one'},attachmentIds:[a.id,b.id]});
  await assert.rejects(f.files.removeBound(a.id,'foreign'),/owning editor/);
  await f.files.removeBound(a.id,post.id);await f.files.removeBound(a.id,post.id);
  await assert.rejects(f.files.readFile(a.id));await f.files.sync(f.upload);await f.sync.sync(f.content);
  assert.equal(f.uploads.length,1);assert.equal(f.writes[0].body.attachmentIds.length,1);
  assert.deepEqual((await f.files.readFile(b.id)).bytes,f.bytes);
 }finally{await f.db.close();}
});

test('bound removal waits for an uncertain parent write and replays the identical durable deletion after a lost response',async()=>{
 const f=fixture();try{
  const a=await f.select(),post=await f.sync.things.savePost({thingtime:['post'],crystal:{type:'text',text:'Private'},attachmentIds:[a.id]});await f.files.sync(f.upload);
  await f.sync.sync({...f.content,write:async op=>{await f.content.write(op,new AbortController().signal);throw Error('Lost parent');},get:async()=>{throw Error('Offline');}});
  const frozen=structuredClone(f.writes[0]);await f.files.removeBound(a.id,post.id);const deletes:any[]=[];
  const transport=removalTransport(f,async(input:any)=>{deletes.push(input);if(deletes.length===1)throw Error('Lost deletion');return {deleted:true,deferred:false};});
  assert.equal((await f.files.sync(transport)).completed,0);assert.deepEqual(deletes,[]);await assert.rejects(f.files.readFile(a.id));
  f.tick();await f.sync.sync(f.content);assert.deepEqual(f.writes[1],frozen);
  await f.files.sync(transport);assert.equal(deletes.length,1);assert.equal(deletes[0].targetId,post.id);assert.equal(deletes[0].requestId,a.localAttachment.requestId);
  await f.db.transaction(f.scope,'readonly',f.lease,async tx=>assert.deepEqual(await tx.getBytes(a.id),f.bytes));
  f.tick();await f.files.sync(transport);assert.deepEqual(deletes[1],deletes[0]);
  await f.db.transaction(f.scope,'readonly',f.lease,async tx=>assert.equal(await tx.getBytes(a.id),undefined));
 }finally{await f.db.close();}
});

test('removal during an uncertain upload finishes that same upload before deleting its unbound account file',async()=>{
 const f=fixture();try{
  const a=await f.select(),post=await f.sync.things.savePost({thingtime:['post'],crystal:{type:'text',text:'Keep text'},attachmentIds:[a.id]});
  await f.files.sync({...f.upload,start:async input=>{await f.upload.start(input,new AbortController().signal);throw Error('Lost start');}});
  await f.files.removeBound(a.id,post.id);let deletes=0;f.tick();
  await f.files.sync(removalTransport(f,async(input:any)=>{assert.equal(input.targetId,post.id);deletes++;return {deleted:true,deferred:false};}));
  assert.equal(deletes,1);assert.equal(f.uploads.length,2);assert.deepEqual(f.uploads[0],f.uploads[1]);
  await f.sync.sync(f.content);assert.deepEqual(f.writes[0].body.attachmentIds,[]);assert.equal(f.writes[0].body.crystal.text,'Keep text');
 }finally{await f.db.close();}
});


test('bound deletion can be reviewed and restored at the exact device quota without discarding bytes',async()=>{
 const f=fixture();try{
  const a=await f.select(),post=await f.sync.things.savePost({thingtime:['post'],crystal:{type:'text',text:'Private'},attachmentIds:[a.id]});await f.files.sync(f.upload);await f.sync.sync(f.content);
  await f.db.transaction(f.scope,'readwrite',f.lease,async tx=>{let remaining=TEST_STORAGE_CAPACITY.bytes-(await tx.usage()).bytes,n=0;while(remaining){const size=Math.min(remaining,TEST_STORAGE_CAPACITY.binaryBytes);await tx.putBytes('fill-'+n++,new Uint8Array(size));remaining-=size;}});
  await f.files.removeBound(a.id,post.id);const base=removalTransport(f,async()=>{throw Error('Must review before deletion');});
  const transport={...base,get:async(id:string)=>{const row=await base.get(id);return {...row,crystal:{...row.crystal,title:'Changed on another device'}};},annotate:async()=>{},move:async()=>{}};
  await f.files.sync(transport);assert.equal((await f.files.status())[0].state,'conflict');
  const review=await f.files.inspectDeletion(transport,a.id);
  await assert.rejects(f.files.resolveDeletion(transport,{id:a.id,localRevision:review.localRevision+1,operationVersion:review.operationVersion,remoteUpdatedAt:review.remote.updatedAt,keep:'file'}),/changed/);
  await f.files.resolveDeletion(transport,{id:a.id,localRevision:review.localRevision,operationVersion:review.operationVersion,remoteUpdatedAt:review.remote.updatedAt,keep:'file'});
  assert.equal((await f.files.readFile(a.id)).row.targetId,post.id);assert.deepEqual((await f.files.readFile(a.id)).bytes,f.bytes);
 }finally{await f.db.close();}
});


test('deleting an unsent parent cancels its media and nested comments atomically without uploading',async()=>{
 const f=fixture();try{
  const file=await f.select(),post=await f.sync.things.savePost({thingtime:['post'],crystal:{type:'text',text:'Delete'},attachmentIds:[file.id]});
  const replyFile=await f.select('comment'),reply=await f.sync.things.savePost({thingtime:['post','comment'],targetId:post.id,crystal:{type:'text',text:'Reply'},attachmentIds:[replyFile.id]});
  await assert.rejects(f.sync.remove([file.id]),/owning editor/);
  const removed=await f.sync.remove([post.id]);assert.deepEqual(new Set(removed.deleted),new Set([post.id,file.id,reply.id,replyFile.id]));
  for(const id of [post.id,reply.id])assert.equal(await f.sync.view(id),null);
  for(const id of [file.id,replyFile.id]){await assert.rejects(f.files.readFile(id));await f.db.transaction(f.scope,'readonly',f.lease,async tx=>assert.equal(await tx.getBytes(id),undefined));}
  await f.files.sync(f.upload);await f.sync.sync(f.content);assert.deepEqual(f.uploads,[]);assert.deepEqual(f.writes,[]);
 }finally{await f.db.close();}
});

test('parent deletion rolls back all file cleanup when another child needs a dedicated adapter',async()=>{
 const f=fixture();try{
  const file=await f.select(),post=await f.sync.things.savePost({thingtime:['post'],crystal:{type:'text',text:'Keep'},attachmentIds:[file.id]});
  await f.db.transaction(f.scope,'readwrite',f.lease,tx=>tx.put('things','protected',{id:'protected',thingtime:['action-run'],targetId:post.id}));
  await assert.rejects(f.sync.remove([post.id]),/dedicated deletion/);
  assert.ok(await f.sync.view(post.id));assert.deepEqual((await f.files.readFile(file.id)).bytes,f.bytes);
 }finally{await f.db.close();}
});

test('parent deletion settles uncertain writes before its immutable delete and only then file cleanup',async()=>{
 const f=fixture();try{
  const file=await f.select(),post=await f.sync.things.savePost({thingtime:['post'],crystal:{type:'text',text:'Delete later'},attachmentIds:[file.id]});await f.files.sync(f.upload);
  await f.sync.sync({...f.content,write:async op=>{await f.content.write(op,new AbortController().signal);throw Error('Lost parent');},get:async()=>{throw Error('Offline');}});
  const frozen=structuredClone(f.writes[0]),order:string[]=[],deletes:any[]=[];
  await f.sync.remove([post.id]);assert.equal(await f.sync.view(post.id),null);await assert.rejects(f.files.readFile(file.id));
  const upload=removalTransport(f,async()=>{order.push('file');return {deleted:true,deferred:false};});
  const content={...f.content,remove:async(op:any)=>{deletes.push(op);order.push('post');if(deletes.length===1)throw Error('Lost deletion');f.remote.delete(post.id);}};
  await f.files.sync(upload);assert.deepEqual(order,[]);
  f.tick();await f.sync.sync(content);assert.deepEqual(f.writes[1],frozen);assert.deepEqual(order,['post']);
  await f.files.sync(upload);assert.deepEqual(order,['post']);assert.equal(deletes.length,1);
  f.tick();await f.sync.sync(content);assert.deepEqual(deletes[1],deletes[0]);
  await f.files.sync(upload);assert.deepEqual(order,['post','post','file']);assert.equal(f.remote.has(post.id),false);
 }finally{await f.db.close();}
});


test('a refused parent deletion preserves media through retry and restoring the account version',async()=>{
 const f=fixture();try{
  const file=await f.select(),post=await f.sync.things.savePost({thingtime:['post'],crystal:{type:'text',text:'Original'},attachmentIds:[file.id]});
  await f.files.sync(f.upload);await f.sync.sync(f.content);await f.sync.remove([post.id]);
  const remote=f.remote.get(post.id)!;remote.updatedAt=new Date(Date.parse(remote.updatedAt)+1000).toISOString();remote.crystal.text='Newer account version';
  let fileDeletes=0;
  const upload=removalTransport(f,async()=>{fileDeletes++;return {deleted:true,deferred:false};});
  const content={...f.content,remove:async()=>{throw {status:409};}};
  await f.files.sync(upload);await f.sync.sync(content);await f.files.sync(upload);
  assert.equal((await f.sync.status())[0].state,'conflict');assert.equal(fileDeletes,0);
  await f.sync.retry(post.id);await f.files.sync(upload);await f.sync.sync(content);await f.files.sync(upload);assert.equal(fileDeletes,0);
  const conflict=await f.sync.inspectConflict(content,post.id);
  await f.sync.resolveConflict(content,{id:post.id,keep:'remote',localRevision:conflict.localRevision,remoteUpdatedAt:conflict.remote.updatedAt});
  await f.files.sync(upload);assert.equal(fileDeletes,0);assert.deepEqual((await f.files.readFile(file.id)).bytes,f.bytes);
  assert.equal((await f.sync.view(post.id))!.crystal.text,'Newer account version');
 }finally{await f.db.close();}
});
