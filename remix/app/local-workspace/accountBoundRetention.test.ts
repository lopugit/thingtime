import { createQuotaFactory, TEST_STORAGE_CAPACITY } from './storageTestFixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBKeyRange } from 'fake-indexeddb';
import { AccountFileSync, type AccountFileRetentionTransport } from './accountFiles';
import { AccountThingSync } from './accountSync';
import { WorkspaceDatabase } from './storage';
import { AccountDiscussionCache } from './accountDiscussions';
import { exportAccountThings } from './accountExport';
import { bundleFromPlan } from '../utils/thingTransfer/browser';
import { LocalThings } from './things';
import { serializeTransfer } from '../utils/thingTransfer/format';

function fixture(comment = false) {
 const db = new WorkspaceDatabase(createQuotaFactory(), undefined, undefined, IDBKeyRange);
 const scope = { kind: 'account', origin: 'https://retention.test', ownerId: 'owner', dataPlane: 'home' } as const;
 let now = Date.now(); const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
 const files = new AccountFileSync(db, scope, lease, () => now), sync = new AccountThingSync(db, scope, lease, () => now, undefined, files.contentHooks);
 const bytes = new TextEncoder().encode('retained original');
 const attachments = ['first','second'].map(id => ({id,name:id+'.png',contentType:'image/png',size:bytes.length,mediaKind:'image'}));
 const parent: any = {id:'post',author:{id:'owner'},thingtime:comment?['post','comment']:['post'],crystal:{type:'text',text:'Original'},attachments,createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),acl:comment?['tt:inherit']:['tt:user'],visibility:'private',...(comment?{targetId:'root'}:{})};
 const transport = {
  retention: async (id: string, _signal: AbortSignal, bound?: boolean) => {assert.equal(bound,true); return {size:bytes.length,cacheKey:'a'.repeat(64)+':original',file:{ownerId:'owner',targetId:parent.id,purpose:comment?'comment':'post',updatedAt:parent.updatedAt,folderId:null,attachment:attachments.find(file=>file.id===id)}};},
  bytes: async () => bytes
 };
 const retain = (source = parent, remote: AccountFileRetentionTransport = transport) => files.retainPost(remote, source, admit => sync.remember(source, now, admit));
 return {db,scope,lease,files,sync,bytes,attachments,parent,transport,retain,tick(updateParent=true){now+=1000;if(updateParent)parent.updatedAt=new Date(now).toISOString();}};
}

test('owned bound originals and parent commit atomically, export exact bytes and never invent an upload request',async()=>{
 for(const comment of [false,true]){
  const f=fixture(comment);try{
   if(comment){const root={...f.parent,id:'root',thingtime:['post'],targetId:undefined,attachments:[]};await f.files.retainPost(f.transport,root,admit=>f.sync.remember(root,Date.now(),admit));}
   await f.retain();const rows=(await f.files.library(true)).things;assert.equal(rows.length,2);assert.equal((await f.files.library()).things.length,0);
   assert.deepEqual(rows.sort((a,b)=>a.localAttachment.order-b.localAttachment.order).map(row=>row.localAttachment.accountFileId),['first','second']);
   for(const row of rows){assert.equal(row.targetId,'post');assert.equal(row.localAttachment.requestId,undefined);assert.deepEqual((await f.files.readFile(row.id)).bytes,f.bytes);}
   const before=await f.sync.view('post');await f.retain();assert.deepEqual(await f.sync.view('post'),before,'unchanged retention cannot churn content revisions or refresh the UI forever');
   await f.db.transaction(f.scope,'readonly',f.lease,async tx=>{for(const {value} of await tx.list<any>('account-files')){assert.equal(value.source,'account');assert.equal(value.request.requestId,undefined);assert.equal(value.state,'synced');}});
   const exported=await exportAccountThings({ids:['post']},{...f,canRefresh:()=>false,remote:async()=>{throw Error('Unexpected remote export');}});
   const result=await bundleFromPlan(exported.plan);
   assert.equal(result.manifest.files.length,2);for(const file of result.manifest.files)assert.deepEqual(result.files.get(file.id),f.bytes);
  }finally{await f.db.close();}
 }
});

test('retained post exports use pending edits and intentional removals without waiting for sync, and round-trip independent copies',async()=>{
 const f=fixture();try{
  await f.retain();const files=(await f.files.library(true)).things.sort((a,b)=>a.localAttachment.order-b.localAttachment.order);
  await f.files.removeBound(files[1].id,'post');
  await f.sync.things.savePost({id:'post',thingtime:['post'],crystal:{type:'text',text:'Latest offline text'},attachmentIds:[files[0].id]},true);
  const exported=await exportAccountThings({ids:['post']},{...f,canRefresh:()=>false,remote:async()=>{throw Error('Unexpected network');}}),bundle=await bundleFromPlan(exported.plan);
  assert.equal(bundle.manifest.things[0].crystal.text,'Latest offline text');assert.deepEqual(bundle.manifest.files.map(row=>row.name),['first.png']);
  assert.doesNotMatch(serializeTransfer(bundle.manifest),/"postAttachmentIds"|"accountAttachmentIds"|"author"|"acl"|"localAttachment"|"revision"/);
  for(const target of [new LocalThings(f.db,{kind:'anonymous'},f.lease),f.sync.things]){
   const imported=await target.import(bundle.manifest,null,bundle.files);assert.notEqual(imported.roots[0],'post');
   const again=await target.export(imported.roots);assert.equal(again.manifest.things[0].crystal.text,'Latest offline text');
   assert.equal(again.files.size,1);for(const bytes of again.files.values())assert.deepEqual(bytes,f.bytes);
  }
  assert.equal((await f.sync.view('post'))!.syncState,'pending');
 }finally{await f.db.close();}
});

test('only a complete retained binding permits offline post export; missing records never become a partial success',async()=>{
 const f=fixture();try{
  const deps={...f,canRefresh:()=>false,remote:async()=>{throw Error('Unexpected network');}};
  await f.sync.remember(f.parent);
  await assert.rejects(exportAccountThings({ids:['post']},deps),/Complete export content/);
  await f.retain();assert.equal((await exportAccountThings({ids:['post']},deps)).plan.files.length,2);
  const file=(await f.files.library(true)).things[0];
  await f.db.transaction(f.scope,'readwrite',f.lease,async tx=>{await tx.delete('account-files',file.id);await tx.delete('things',file.id);await tx.deleteBytes(file.id);});
  await assert.rejects(exportAccountThings({ids:['post']},deps),/Complete post files/);
  assert.equal((await exportAccountThings({ids:['post'],includeFiles:false},deps)).plan.files.length,0,'explicit content-only downloads do not require file bytes');
 }finally{await f.db.close();}
});

test('reviewing a conflict preserves the complete local binding for export when keeping device content',async()=>{
 const f=fixture();try{
  await f.retain();const ids=(await f.files.library(true)).things.map(row=>row.id);
  await f.sync.things.savePost({id:'post',thingtime:['post'],crystal:{type:'text',text:'Keep device edit'},attachmentIds:ids},true);
  const remote={...f.parent,updatedAt:new Date(Date.parse(f.parent.updatedAt)+1000).toISOString(),crystal:{type:'text',text:'Changed elsewhere'},attachments:[{...f.attachments[0],id:'different-account-file'}]};
  const transport={get:async()=>remote,write:async()=>{throw {status:409};}};
  await f.sync.sync(transport);const review=await f.sync.inspectConflict(transport,'post');
  await f.sync.resolveConflict(transport,{id:'post',keep:'local',localRevision:review.localRevision,remoteUpdatedAt:review.remote.updatedAt});
  const exported=await exportAccountThings({ids:['post']},{...f,canRefresh:()=>false,remote:async()=>{throw Error('Unexpected network');}});
  const bundle=await bundleFromPlan(exported.plan);assert.equal(bundle.manifest.things[0].crystal.text,'Keep device edit');assert.equal(bundle.files.size,2);
  for(const bytes of bundle.files.values())assert.deepEqual(bytes,f.bytes);
 }finally{await f.db.close();}
});

test('a retained reply with an uncached parent keeps the complete authorized remote export path',async()=>{
 const f=fixture(true);try{
  await f.retain();const things=[{id:'post',thingtime:['post','comment'],targetId:'root',crystal:f.parent.crystal},{id:'root',thingtime:['post'],crystal:{type:'text',text:'Uncached parent'}}];
  const response={ok:true,plan:{roots:['post'],things,files:f.attachments.map(file=>({id:file.id,targetId:'post',name:file.name,mime:file.contentType,bytes:file.size}))}};
  const deps={...f,canRefresh:()=>false,remote:async()=>response};
  await assert.rejects(exportAccountThings({ids:['post']},deps),/Complete export content/);
  deps.canRefresh=()=>true;assert.deepEqual((await exportAccountThings({ids:['post']},deps)).plan.things,response.plan.things);
  assert.equal(await f.sync.view('root'),null,'an export-only parent must not become an owned editable Thing');
 }finally{await f.db.close();}
});

test('partial bytes, wrong bindings, revocation and quota failure leave neither parent nor partial files',async()=>{
 for(const mode of ['bytes','binding','revoked','quota']){
  const f=fixture();try{
   const transport={...f.transport,retention:async(id:string,signal:AbortSignal,bound?:boolean)=>{const row=await f.transport.retention(id,signal,bound);if(mode==='binding')row.file.targetId='foreign';return row;},bytes:async(id:string)=>{if(id==='second'&&mode==='bytes')throw Error('Interrupted');if(mode==='revoked')throw {status:404};return f.bytes;}};
   if(mode==='quota')await f.db.transaction(f.scope,'readwrite',f.lease,async tx=>{for(let i=0;i<4;i++)await tx.putBytes('fill-'+i,new Uint8Array(TEST_STORAGE_CAPACITY.binaryBytes));});
   await assert.rejects(f.retain(f.parent,transport));
   assert.equal(await f.sync.view('post'),null);assert.deepEqual((await f.files.library(true)).things,[]);assert.deepEqual(await f.files.status(),[]);
  }finally{await f.db.close();}
 }
});

test('dirty parent and a refusal arriving during retention cannot admit stale files or erase editing',async()=>{
 for(const mode of ['edit','refusal']){
  const f=fixture();try{
   await f.retain();f.tick();f.parent.attachments=[...f.attachments].reverse();
   const outcome=await f.files.retainPost(f.transport,f.parent,async admit=>{
    if(mode==='edit')await f.sync.things.savePost({id:'post',thingtime:['post'],crystal:{type:'text',text:'Device edit'},attachmentIds:(await f.files.library(true)).things.sort((a,b)=>a.localAttachment.order-b.localAttachment.order).map(row=>row.id)},true);
    else await new AccountDiscussionCache(f.db,f.scope,f.lease).forget('post');
    return f.sync.remember(f.parent,Date.now()-10000,admit);
   });
   if(mode==='edit'){assert.equal(outcome?.crystal.text,'Device edit');assert.deepEqual((await f.files.library(true)).things.sort((a,b)=>a.localAttachment.order-b.localAttachment.order).map(row=>row.localAttachment.accountFileId),['first','second']);}
   else {assert.equal(outcome,undefined);for(const row of (await f.files.library(true)).things)await assert.rejects(f.files.readFile(row.id));}
  }finally{await f.db.close();}
 }
});

test('new complete bindings replace clean cached membership and retained removal uses an existing-ID receipt',async()=>{
 const f=fixture();try{
  await f.retain();const original=(await f.files.library(true)).things;f.tick(false);f.parent.attachments=[f.attachments[1]];await f.retain();
  const exported=await exportAccountThings({ids:['post']},{...f,canRefresh:()=>false,remote:async()=>{throw Error('Unexpected network');}});
  assert.deepEqual(exported.plan.files.map((file:any)=>file.name),['second.png'],'complete binding retention refreshes its proof even when the parent body version is unchanged');
  await assert.rejects(f.files.readFile(original.find(row=>row.localAttachment.accountFileId==='first')!.id));
  const row=(await f.files.library(true)).things[0];assert.equal(row.localAttachment.order,0);await f.files.removeBound(row.id,'post');let deletion:any;
  const remote={...f.transport,get:async()=>({id:'second',author:{id:'owner'},thingtime:['attachment'],crystal:f.attachments[1],updatedAt:f.parent.updatedAt}),remove:async(input:any)=>{deletion=input;return {deleted:true as const,deferred:false};},start:async()=>{throw Error('No uploads');},parts:async()=>[],put:async()=>{},complete:async()=>{throw Error('No uploads');}};
  await f.files.sync(remote);assert.deepEqual(deletion,{id:'second',targetId:'post',expectedUpdatedAt:f.parent.updatedAt,retainReceipt:true});await assert.rejects(f.files.readFile(row.id));assert.equal((await f.files.library(true)).aliases.get('second'),null);
 }finally{await f.db.close();}
});
