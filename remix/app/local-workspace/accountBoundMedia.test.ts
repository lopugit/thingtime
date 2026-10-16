import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { AccountFileSync, type AccountFileTransport } from './accountFiles';
import { AccountThingSync, type AccountSyncTransport, type AccountThing } from './accountSync';
import { AccountDiscussionCache } from './accountDiscussions';
import { exportAccountThings } from './accountExport';
import { localPostProjection } from './posts';
import { WorkspaceDatabase } from './storage';

function fixture() {
 const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange);
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
 return {db,scope,lease,files,sync,bytes,uploads,writes,remote,upload,content,select,tick(){now += 120000;}};
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
