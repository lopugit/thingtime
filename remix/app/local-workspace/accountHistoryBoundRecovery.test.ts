import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { AccountFileSync, type AccountFileTransport } from './accountFiles';
import type { FileMetadataTransport } from './accountFileMetadata';
import { AccountThingSync, type AccountSyncTransport, type AccountThing } from './accountSync';
import { AccountTimeline, AccountTimelineStore, accountTimelineScope } from './accountTimeline';
import { AccountTimelineVersions } from './accountTimelineVersions';
import { IndexedDbTimelineBackend } from '../timeline/indexedDb';
import { WorkspaceDatabase } from './storage';
import { LocalActions } from './actions';
import type { VersionRequest } from '../timeline/publishedVersion';

async function fixture(initialSync = true) {
 const factory = new IDBFactory(), db = new WorkspaceDatabase(factory), backend = new IndexedDbTimelineBackend(factory);
 const scope = {kind:'account',origin:'https://recovery.test',ownerId:'recovery-owner',dataPlane:'home'} as const;
 let active = true, now = Date.now();
 const lease = {assertCurrent(){if(!active)throw Error('Retired workspace');},onInvalidate:()=>()=>{}};
 const files = new AccountFileSync(db,scope,lease,()=>now), sync = new AccountThingSync(db,scope,lease,()=>now,undefined,files.contentHooks);
 const history = new AccountTimeline(db,scope,lease), store = new AccountTimelineStore(accountTimelineScope(scope),backend,history);
 const versions = new AccountTimelineVersions(db,scope,lease,sync.things,store,[],(id,signal)=>files.verifyRecoveryBytes(id,signal));
 const bytes = new TextEncoder().encode('exact private recovery bytes '+randomUUID());
 const uploads:any[] = [], writes:any[] = [], remote = new Map<string,AccountThing>(), receipts = new Map<string,any>(), bindings = new Map<string,string>();
 const upload:AccountFileTransport & Pick<FileMetadataTransport,'get'> = {
  start:async request=>{uploads.push(structuredClone(request));const id='account-'+request.requestId;
   receipts.set(id,{id,name:request.filename,contentType:request.contentType,size:request.sizeBytes,mediaKind:'image'});
   return {id,partSizeBytes:bytes.length,partCount:1};},
  parts:async (_id,parts)=>parts.map(part=>({...part,url:'https://storage.test/part',expiresAt:'2026-11-10',headers:{}})),
  put:async (_part,body)=>assert.deepEqual(body,bytes),complete:async id=>receipts.get(id),
  get:async id=>({id,author:{id:scope.ownerId},thingtime:['attachment'],targetId:bindings.get(id)||null,crystal:receipts.get(id),updatedAt:'2026-11-10T00:00:00.000Z'}),
  remove:async()=>({deleted:true,deferred:false})
 };
 const content:AccountSyncTransport = {
  get:async id=>{const row=remote.get(id);if(!row)throw {status:404};return structuredClone(row);},
  write:async op=>{writes.push(structuredClone(op));const old=remote.get(op.id),attachmentIds=(op.body.attachmentIds as string[])||[];
   if(op.method==='create'&&old)throw {status:409};if(op.method==='update'&&!old)throw {status:404};
   for(const id of attachmentIds)bindings.set(id,op.id);
   const row={...op.body,id:op.id,author:{id:scope.ownerId},createdAt:old?.createdAt||new Date(now).toISOString(),updatedAt:new Date(++now).toISOString(),revision:1,accountAttachmentIds:attachmentIds,attachments:attachmentIds.map(id=>receipts.get(id))} as unknown as AccountThing;
   remote.set(op.id,row);return row;},
  remove:async op=>{if(!remote.has(op.id))throw {status:404};remote.delete(op.id);}
 };
 const file=await files.things.saveFile({requestId:randomUUID(),name:'portrait.png',contentType:'image/png',bytes,purpose:'post'});
 const post=await sync.things.savePost({thingtime:['post'],crystal:{type:'text',text:'Recover this private post'},attachmentIds:[file.id]});
 if(initialSync){await files.sync(upload);await sync.sync(content);}
 const originalRemoteId=uploads.length&&[...receipts.keys()][0];
 if(initialSync){assert.ok(originalRemoteId);assert.equal(remote.has(post.id),true);}
 const recover=async(id=post.id,writer=versions)=>{
  const deletion=(await history.rows({thingId:id})).find(row=>row.event.operation==='delete')!;
  const request:VersionRequest={command:'preview-version',eventId:deletion.event.id,mode:'restore',componentMode:'recorded',recover:true,choices:{},componentChoices:{}};
  const result=await versions.request(request);assert.ok('preview' in result);
  return writer.request({...request,command:'apply-version',operationId:randomUUID(),expectedHeadId:result.preview.expectedHeadId,expectedComponents:result.preview.components!.fingerprint,expectedRecovery:result.preview.recoveryFingerprint});
 };
 return {db,backend,scope,lease,files,sync,history,store,versions,bytes,upload,content,uploads,writes,remote,post,file,originalRemoteId,recover,
  tick(){now+=120_000;},retire(){active=false;},close:async()=>{active=true;await backend.close();await db.close();}};
}

for (const completed of [false,true]) test(`bound account History recovery ${completed?'after':'before'} remote parent deletion preserves exact bytes and binding`,async()=>{
 const f=await fixture();try{
  await f.sync.remove([f.post.id]);
  if(completed){await f.sync.sync(f.content);assert.equal(f.remote.has(f.post.id),false);await f.files.sync(f.upload);}
  const result=await f.recover();assert.ok('entry' in result);
  assert.deepEqual((await f.files.things.readFile(f.file.id)).bytes,f.bytes);
  assert.equal((await f.files.things.readFile(f.file.id)).row.targetId,f.post.id);
  assert.equal((await f.sync.things.get(f.post.id)).crystal.text,'Recover this private post');
  await f.files.sync(f.upload);await f.sync.sync(f.content);
  assert.equal(f.uploads.length,completed?2:1,'only an acknowledged cascade needs a new upload identity');
  const restored=(await f.remote.get(f.post.id))!;
  assert.deepEqual(restored.acl,['tt:user']);
  assert.deepEqual(restored.accountAttachmentIds,[completed?'account-'+f.uploads[1].requestId:f.originalRemoteId]);
  assert.deepEqual((await f.files.things.readFile(f.file.id)).bytes,f.bytes);
  await f.files.sync(f.upload);assert.equal(f.uploads.length,completed?2:1,'settled file does not upload twice');
 }finally{await f.close();}
});

test('a frozen bound parent delete cannot be replaced by History recovery or a stale identity',async()=>{
 const f=await fixture();let release!:()=>void,started!:()=>void;
 try{
  await f.sync.remove([f.post.id]);
  const ready=new Promise<void>(resolve=>{started=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
  const run=f.sync.sync({...f.content,remove:async op=>{started();await held;return f.content.remove!(op,new AbortController().signal);}});
  await ready;
  await assert.rejects(f.recover(),/Wait for the account deletion/);
  assert.equal(await f.sync.view(f.post.id),null);
  await f.db.transaction(f.scope,'readonly',{assertCurrent(){},onInvalidate:()=>()=>{}},async tx=>assert.deepEqual(await tx.getBytes(f.file.id),f.bytes));
  f.retire();await assert.rejects(f.recover(),/Retired workspace/);
  release();await assert.rejects(run,/Retired workspace/);
 }finally{release?.();await f.close();}
});

test('unsent parent recovery reuses the original file request; explicit editor removal then purges its bytes',async()=>{
 const f=await fixture(false);try{
  await f.sync.remove([f.post.id]);
  assert.equal(await f.sync.view(f.post.id),null);
  await assert.rejects(f.files.readFile(f.file.id),/not in this workspace|not stored|deleted|not available/i);
  await f.files.sync(f.upload);await f.sync.sync(f.content);
  assert.deepEqual(f.uploads,[]);
  await f.recover();
  assert.deepEqual((await f.files.readFile(f.file.id)).bytes,f.bytes);
  await f.files.sync(f.upload);await f.sync.sync(f.content);
  assert.equal(f.uploads.length,1);
  await f.files.removeBound(f.file.id,f.post.id);
  await f.sync.sync(f.content);await f.files.sync(f.upload);await f.sync.sync(f.content);
  await f.db.transaction(f.scope,'readonly',{assertCurrent(){},onInvalidate:()=>()=>{}},async tx=>assert.equal(await tx.getBytes(f.file.id),undefined));
 }finally{await f.close();}
});

test('recovered bound content can be deleted again without accumulating a second retained file',async()=>{
 const f=await fixture();try{
  await f.sync.remove([f.post.id]);await f.sync.sync(f.content);await f.files.sync(f.upload);
  await f.db.transaction(f.scope,'readonly',f.lease,async tx=>{const state=await tx.get<any>('thing-sync',f.post.id);assert.equal(state?.recoveryCoverage,true);assert.deepEqual(state?.recoveryFileIds,[f.file.id]);});
  await f.recover();
  await f.db.transaction(f.scope,'readonly',f.lease,async tx=>{const state=await tx.get<any>('thing-sync',f.post.id);assert.equal(state?.recoveryCoverage,undefined,'a live post cannot carry stale deletion proof');assert.equal(state?.recoveryFileIds,undefined);});
  await f.files.sync(f.upload);await f.sync.sync(f.content);
  await f.sync.remove([f.post.id]);await f.sync.sync(f.content);await f.files.sync(f.upload);
  await f.db.transaction(f.scope,'readonly',f.lease,async tx=>assert.equal((await tx.get<any>('thing-sync',f.post.id))?.recoveryCoverage,true,'a second delete proves its own complete retention'));
  assert.equal(await f.sync.view(f.post.id),null);
  await f.db.transaction(f.scope,'readonly',{assertCurrent(){},onInvalidate:()=>()=>{}},async tx=>{
   assert.deepEqual(await tx.getBytes(f.file.id),f.bytes);
   assert.equal((await tx.list('account-files')).filter(row=>row.id===f.file.id).length,1);
  });
  await f.recover();await f.files.sync(f.upload);await f.sync.sync(f.content);
  assert.equal(f.uploads.length,3);
  assert.deepEqual((await f.files.readFile(f.file.id)).bytes,f.bytes);
 }finally{await f.close();}
});

test('History recovery of a parent restores its deleted comment child and both bound files atomically',async()=>{
 const f=await fixture();try{
  const childBytes=new TextEncoder().encode('exact child bytes');
  const childFile=await f.files.things.saveFile({requestId:randomUUID(),name:'reply.png',contentType:'image/png',bytes:childBytes,purpose:'comment'});
  const child=await f.sync.things.savePost({thingtime:['post','comment'],targetId:f.post.id,crystal:{type:'text',text:'Retained reply'},attachmentIds:[childFile.id]});
  // The test transport checks each payload's exact bytes at PUT time.
  const childUpload={...f.upload,start:async (request:any,signal:any)=>({...await f.upload.start(request,signal),partSizeBytes:childBytes.length}),put:async (_part:any,body:any)=>assert.deepEqual(body,childBytes)};
  await f.files.sync(childUpload);await f.sync.sync(f.content);
  await f.sync.remove([f.post.id]);
  assert.equal(await f.sync.view(child.id),null);
  await f.sync.sync(f.content);await f.files.sync(childUpload);
  await f.recover();
  assert.equal((await f.sync.things.get(child.id)).targetId,f.post.id);
  assert.equal((await f.sync.things.get(child.id)).crystal.text,'Retained reply');
  assert.deepEqual((await f.files.readFile(f.file.id)).bytes,f.bytes);
  assert.deepEqual((await f.files.readFile(childFile.id)).bytes,childBytes);
  await f.files.sync({...f.upload,put:async(_part:any,body:any)=>assert.ok(Buffer.from(body).equals(Buffer.from(f.bytes))||Buffer.from(body).equals(Buffer.from(childBytes)))},undefined,5);
  await f.sync.sync(f.content);
  assert.equal(f.remote.get(child.id)?.targetId,f.post.id);
  assert.equal(f.remote.get(child.id)?.accountAttachmentIds?.length,1);
  assert.equal(f.remote.get(f.post.id)?.accountAttachmentIds?.length,1);
 }finally{await f.close();}
});

test('a refused child mid-cascade leaves the parent and file bytes intact and rolls back grouped recovery',async()=>{
 const f=await fixture();try{
  const child=await f.sync.things.savePost({thingtime:['post','comment'],targetId:f.post.id,crystal:{type:'text',text:'Changed child'}});
  await f.sync.sync(f.content);
  await f.sync.remove([f.post.id]);
  const before=f.remote.get(child.id)!;
  f.remote.set(child.id,{...before,updatedAt:new Date(Date.parse(before.updatedAt)+1).toISOString()});
  const deletes:any[]=[];
  await f.sync.sync({...f.content,remove:async op=>{deletes.push(op.id);if(op.id===child.id)throw {status:409};return f.content.remove!(op,new AbortController().signal);}});
  assert.deepEqual(deletes,[child.id]);
  assert.equal(f.remote.has(f.post.id),true);
  await assert.rejects(f.recover(),/Wait for the account deletion|linked Thing/i);
  assert.equal(await f.sync.view(f.post.id),null);
  assert.equal(await f.sync.view(child.id),null);
  await f.db.transaction(f.scope,'readonly',{assertCurrent(){},onInvalidate:()=>()=>{}},async tx=>assert.deepEqual(await tx.getBytes(f.file.id),f.bytes));
 }finally{await f.close();}
});

test('a refused attachment cleanup cannot be bypassed by parent History recovery',async()=>{
 const f=await fixture();try{
  await f.sync.remove([f.post.id]);await f.sync.sync(f.content);
  await f.files.sync({...f.upload,remove:async()=>{throw {status:403};}});
  await assert.rejects(f.recover(),/file needs account deletion review/i);
  assert.equal(await f.sync.view(f.post.id),null);
  await f.db.transaction(f.scope,'readonly',{assertCurrent(){},onInvalidate:()=>()=>{}},async tx=>assert.deepEqual(await tx.getBytes(f.file.id),f.bytes));
  assert.equal(f.uploads.length,1);
 }finally{await f.close();}
});

test('an expired file-delete callback cannot erase newer recovered bytes or upload intent',async()=>{
 const f=await fixture();let release!:()=>void,started!:()=>void;
 try{
  await f.sync.remove([f.post.id]);await f.sync.sync(f.content);
  const ready=new Promise<void>(resolve=>{started=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
  const stale=f.files.sync({...f.upload,remove:async()=>{started();await held;return {deleted:true,deferred:false};}},undefined,1);
  await ready;f.tick();
  await f.recover();
  release();await stale;
  assert.deepEqual((await f.files.readFile(f.file.id)).bytes,f.bytes);
  await f.files.sync(f.upload);await f.sync.sync(f.content);
  assert.equal(f.uploads.length,2);
  assert.deepEqual(f.remote.get(f.post.id)?.accountAttachmentIds,['account-'+f.uploads[1].requestId]);
 }finally{release?.();await f.close();}
});

test('a dispatched file DELETE cannot make History reuse its old receipt when the parent was never created remotely',async()=>{
 const f=await fixture(false);let release!:()=>void,started!:()=>void;
 try{
  await f.files.sync(f.upload);
  const oldId='account-'+f.uploads[0].requestId;
  await f.sync.remove([f.post.id]);
  await f.sync.sync(f.content);
  assert.equal(f.remote.has(f.post.id),false);
  await f.db.transaction(f.scope,'readwrite',f.lease,async tx=>{const row=await tx.get<any>('account-files',f.file.id);row.deletingLocal.localAttachment.accountFileId=oldId;await tx.put('account-files',f.file.id,row);});
  const ready=new Promise<void>(resolve=>{started=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
  const stale=f.files.sync({...f.upload,remove:async()=>{started();await held;return {deleted:true,deferred:false};}},undefined,1);
  await ready;f.tick();
  const result=await f.recover();assert.ok('entry' in result);
  const local=await f.files.readFile(f.file.id);
  assert.deepEqual(local.bytes,f.bytes);
  assert.equal(local.row.localAttachment.accountFileId,undefined,'the deleted account receipt is not a restored local binding');
  release();await stale;
  await f.files.sync(f.upload);await f.sync.sync(f.content);
  assert.equal(f.uploads.length,2,'a potentially committed old DELETE requires a fresh upload identity');
  assert.notEqual('account-'+f.uploads[1].requestId,oldId);
  assert.deepEqual(f.remote.get(f.post.id)?.accountAttachmentIds,['account-'+f.uploads[1].requestId]);
  assert.deepEqual((await f.files.readFile(f.file.id)).bytes,f.bytes);
 }finally{release?.();await f.close();}
});

test('parent recovery does not resurrect an attachment removed through its editor before deletion',async()=>{
 const f=await fixture();try{
  await f.files.removeBound(f.file.id,f.post.id);
  await f.sync.things.savePost({id:f.post.id,thingtime:['post'],crystal:{type:'text',text:'Recover this private post'},attachmentIds:[]},true);
  await f.sync.sync(f.content);await f.files.sync(f.upload);await f.sync.sync(f.content);
  await f.db.transaction(f.scope,'readonly',{assertCurrent(){},onInvalidate:()=>()=>{}},async tx=>assert.equal(await tx.getBytes(f.file.id),undefined));
  await f.sync.remove([f.post.id]);await f.sync.sync(f.content);
  await f.recover();await f.sync.sync(f.content);
  assert.deepEqual(f.remote.get(f.post.id)?.accountAttachmentIds,[]);
  assert.equal(f.uploads.length,1);
  await assert.rejects(f.files.readFile(f.file.id));
 }finally{await f.close();}
});

test('uploaded but never-bound file gets a fresh request after its parent was cancelled',async()=>{
 const f=await fixture(false);try{
  await f.files.sync(f.upload);
  assert.equal(f.uploads.length,1);
  await f.sync.remove([f.post.id]);
  await f.sync.sync(f.content);
  const removed:any[]=[];
  await f.files.sync({...f.upload,remove:async input=>{removed.push(input);return {deleted:true,deferred:false};}});
  assert.equal(removed.length,1);
  assert.equal(removed[0].targetId,undefined,'an upload never bound by a parent cannot claim that server target');
  await f.recover();
  await f.files.sync(f.upload);await f.sync.sync(f.content);
  assert.equal(f.uploads.length,2);
  assert.notEqual(f.uploads[0].requestId,f.uploads[1].requestId);
  assert.deepEqual(f.remote.get(f.post.id)?.accountAttachmentIds,['account-'+f.uploads[1].requestId]);
  assert.deepEqual((await f.files.readFile(f.file.id)).bytes,f.bytes);
 }finally{await f.close();}
});

test('a persisted pre-upgrade file delete keeps its original target binding',async()=>{
 const f=await fixture();try{
  await f.sync.remove([f.post.id]);await f.sync.sync(f.content);
  await f.db.transaction(f.scope,'readwrite',{assertCurrent(){},onInvalidate:()=>()=>{}},async tx=>{
   const row=await tx.get<any>('account-files',f.file.id);assert.ok(row?.deleteRequested);
   delete row.deleteTargetBound;
   await tx.put('account-files',f.file.id,row);
  });
  const removals:any[]=[];
  await f.files.sync({...f.upload,remove:async input=>{removals.push(input);return {deleted:true,deferred:false};}});
  assert.equal(removals.length,1);
  assert.equal(removals[0].targetId,f.post.id,'legacy frozen deletion identity must retain its target');
  await f.recover();await f.files.sync(f.upload);await f.sync.sync(f.content);
  assert.deepEqual((await f.files.readFile(f.file.id)).bytes,f.bytes);
 }finally{await f.close();}
});

test('recovering an Action with a device run child never replays its execution receipt',async()=>{
 const f=await fixture();try{
  const action=await f.sync.things.create({thingtime:['action'],crystal:{name:'Recover inert Action',version:1,capabilities:[],steps:[{op:'return',value:'recorded once'}]}});
  await f.sync.sync(f.content);
  const actions=new LocalActions(f.db,f.scope,f.lease,f.sync);
  const result=await actions.run({action:action.id});assert.equal(result.status,'ok');assert.equal(result.result,'recorded once');
  assert.equal((await actions.runs({action:action.id})).runs.length,1);
  const writesBefore=f.writes.length;
  await f.sync.remove([action.id]);await f.sync.sync(f.content);
  assert.equal(await f.sync.view(action.id),null);
  assert.equal((await actions.runs({action:action.id})).runs.length,0);
  assert.equal((await f.history.rows({thingId:action.id})).some(row=>row.event.operation==='delete'),true);
  const restored=await f.recover(action.id);assert.ok('entry' in restored);
  await f.sync.sync(f.content);
  assert.equal(f.remote.get(action.id)?.crystal.name,'Recover inert Action');
  assert.equal((await actions.runs({action:action.id})).runs.length,0,'a saved execution receipt must remain historical, not live or replayed');
  assert.equal(f.writes.slice(writesBefore).some(write=>write.id===result.runId),false,'account sync must never mint server run evidence');
  assert.deepEqual(f.remote.get(action.id)?.crystal.steps,[{op:'return',value:'recorded once'}]);
 }finally{await f.close();}
});

test('legacy post deletion without complete file-retention proof refuses partial History recovery',async()=>{
 const f=await fixture(false);try{
  await f.sync.remove([f.post.id]);
  await f.db.transaction(f.scope,'readwrite',f.lease,async tx=>{
   // Before the coverage marker, never-sent parents had no retained sync row
   // and an unstarted file could be discarded without a target reference.
   await tx.delete('thing-sync',f.post.id);
   await tx.delete('account-files',f.file.id);
   await tx.deleteBytes(f.file.id);
  });
  await assert.rejects(f.recover(),/older post deletion cannot prove every attached file was retained/i);
  assert.equal(await f.sync.view(f.post.id),null);
  assert.equal((await f.history.rows({thingId:f.post.id})).some(row=>row.event.operation==='delete'),true);
  assert.equal(f.remote.size,0);
 }finally{await f.close();}
});

test('new post deletion refuses recovery if an unsent retained file record disappears',async()=>{
 const f=await fixture(false);try{
  await f.sync.remove([f.post.id]);
  await f.db.transaction(f.scope,'readwrite',f.lease,tx=>tx.delete('account-files',f.file.id));
  await assert.rejects(f.recover(),/file captured by this post deletion is no longer completely retained/i);
  assert.equal(await f.sync.view(f.post.id),null);
  await f.db.transaction(f.scope,'readonly',f.lease,async tx=>assert.deepEqual(await tx.getBytes(f.file.id),f.bytes));
 }finally{await f.close();}
});

test('new text-only post has explicit empty retention proof and recovers normally',async()=>{
 const f=await fixture(false);try{
  const textOnly=await f.sync.things.savePost({thingtime:['post'],crystal:{type:'text',text:'No files to lose'}});
  await f.sync.remove([textOnly.id]);
  await f.db.transaction(f.scope,'readonly',f.lease,async tx=>{const state=await tx.get<any>('thing-sync',textOnly.id);assert.equal(state?.recoveryCoverage,true);assert.deepEqual(state?.recoveryFileIds,[]);});
  const result=await f.recover(textOnly.id);assert.ok('entry' in result);
  assert.equal((await f.sync.things.get(textOnly.id)).crystal.text,'No files to lose');
 }finally{await f.close();}
});

test('late parent create receipt keeps deleted child and file recovery metadata through the cascade',async()=>{
 const f=await fixture(false);let release!:()=>void,started!:()=>void;
 try{
  const childFile=await f.files.things.saveFile({requestId:randomUUID(),name:'pending-child.png',contentType:'image/png',bytes:f.bytes,purpose:'comment'});
  const child=await f.sync.things.savePost({thingtime:['post','comment'],targetId:f.post.id,crystal:{type:'text',text:'Pending child'},attachmentIds:[childFile.id]});
  await f.files.sync(f.upload,undefined,5);
  const ready=new Promise<void>(resolve=>{started=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
  const inFlight=f.sync.sync({...f.content,write:async(op,signal)=>{if(op.id===f.post.id){started();await held;}return f.content.write(op,signal);}},undefined,1);
  await ready;await f.sync.remove([f.post.id]);
  release();await inFlight;
  await f.db.transaction(f.scope,'readonly',f.lease,async tx=>{const state=await tx.get<any>('thing-sync',f.post.id);assert.deepEqual(state?.cascadeChildIds,[child.id]);assert.deepEqual(state?.recoveryFileIds,[f.file.id]);assert.equal(state?.recoveryCoverage,true);});
  await f.sync.sync(f.content);await f.files.sync(f.upload,undefined,5);
  assert.equal(f.remote.has(f.post.id),false);
  await f.recover();await f.files.sync(f.upload,undefined,5);await f.sync.sync(f.content);
  assert.equal(f.remote.get(child.id)?.targetId,f.post.id);
  assert.equal(f.remote.get(f.post.id)?.accountAttachmentIds?.length,1);
  assert.equal(f.remote.get(child.id)?.accountAttachmentIds?.length,1);
  assert.deepEqual((await f.files.readFile(f.file.id)).bytes,f.bytes);
  assert.deepEqual((await f.files.readFile(childFile.id)).bytes,f.bytes);
 }finally{release?.();await f.close();}
});

test('reviewed keep-local deletion retains child and file recovery metadata',async()=>{
 const f=await fixture();try{
  const child=await f.sync.things.savePost({thingtime:['post','comment'],targetId:f.post.id,crystal:{type:'text',text:'Reviewed child'}});
  await f.sync.sync(f.content);await f.sync.remove([f.post.id]);
  const remote=f.remote.get(f.post.id)!;
  const changed={...remote,updatedAt:new Date(Date.parse(remote.updatedAt)+1).toISOString()};f.remote.set(f.post.id,changed);
  await f.sync.sync({...f.content,remove:async op=>{if(op.id===f.post.id)throw {status:409};return f.content.remove!(op,new AbortController().signal);}});
  const conflicted=await f.db.transaction(f.scope,'readonly',f.lease,tx=>tx.get<any>('thing-sync',f.post.id));
  assert.equal(conflicted?.state,'conflict');assert.deepEqual(conflicted?.cascadeChildIds,[child.id]);
  await f.sync.resolveConflict(f.content,{id:f.post.id,keep:'local',localRevision:f.post.revision,remoteUpdatedAt:changed.updatedAt});
  await f.db.transaction(f.scope,'readonly',f.lease,async tx=>{const state=await tx.get<any>('thing-sync',f.post.id);assert.deepEqual(state?.cascadeChildIds,[child.id]);assert.deepEqual(state?.recoveryFileIds,[f.file.id]);assert.equal(state?.recoveryCoverage,true);});
  await f.sync.sync(f.content);await f.files.sync(f.upload);
  await f.recover();await f.files.sync(f.upload);await f.sync.sync(f.content);
  assert.equal(f.remote.get(child.id)?.targetId,f.post.id);
  assert.deepEqual((await f.files.readFile(f.file.id)).bytes,f.bytes);
 }finally{await f.close();}
});

test('reviewed keep-remote cancels deletion and clears its one-use recovery proof',async()=>{
 const f=await fixture();try{
  await f.sync.remove([f.post.id]);
  const remote=f.remote.get(f.post.id)!;
  const changed={...remote,updatedAt:new Date(Date.parse(remote.updatedAt)+1).toISOString()};f.remote.set(f.post.id,changed);
  await f.sync.sync({...f.content,remove:async()=>{throw {status:409};}});
  await f.sync.resolveConflict(f.content,{id:f.post.id,keep:'remote',localRevision:f.post.revision,remoteUpdatedAt:changed.updatedAt});
  await f.db.transaction(f.scope,'readonly',f.lease,async tx=>{const state=await tx.get<any>('thing-sync',f.post.id);assert.equal(state?.deleted,undefined);assert.equal(state?.cascadeChildIds,undefined);assert.equal(state?.recoveryCoverage,undefined);assert.equal(state?.recoveryFileIds,undefined);});
  assert.equal((await f.sync.things.get(f.post.id)).crystal.text,'Recover this private post');
  assert.deepEqual((await f.files.readFile(f.file.id)).bytes,f.bytes);
 }finally{await f.close();}
});

test('image post and image comment recover only with their exact restored bound media context',async()=>{
 const f=await fixture(false);try{
  await f.sync.things.savePost({id:f.post.id,thingtime:['post'],crystal:{type:'image',text:'Image parent',images:[]},attachmentIds:[f.file.id]},true);
  const childFile=await f.files.things.saveFile({requestId:randomUUID(),name:'image-child.png',contentType:'image/png',bytes:f.bytes,purpose:'comment'});
  const child=await f.sync.things.savePost({thingtime:['post','comment'],targetId:f.post.id,crystal:{type:'image',text:'Image child',images:[]},attachmentIds:[childFile.id]});
  await f.files.sync(f.upload,undefined,5);await f.sync.sync(f.content);
  await f.sync.remove([f.post.id]);await f.sync.sync(f.content);await f.files.sync(f.upload,undefined,5);
  await f.recover();
  const restoredParent=await f.sync.things.get(f.post.id);
  assert.equal(restoredParent.crystal.type,'image');
  assert.equal(Object.prototype.hasOwnProperty.call(restoredParent,'postAttachments'),false,'validation facts are not persisted as Thing data');
  assert.equal((await f.sync.things.get(child.id)).crystal.type,'image');
  assert.deepEqual((await f.files.readFile(f.file.id)).bytes,f.bytes);
  assert.deepEqual((await f.files.readFile(childFile.id)).bytes,f.bytes);
  await f.files.sync(f.upload,undefined,5);await f.sync.sync(f.content);
  assert.equal(f.remote.get(f.post.id)?.accountAttachmentIds?.length,1);
  assert.equal(f.remote.get(child.id)?.accountAttachmentIds?.length,1);
 }finally{await f.close();}
});

test('wrong-purpose retained row cannot authorize image-post recovery',async()=>{
 const f=await fixture(false);try{
  await f.sync.things.savePost({id:f.post.id,thingtime:['post'],crystal:{type:'image',text:'Image parent',images:[]},attachmentIds:[f.file.id]},true);
  await f.sync.remove([f.post.id]);
  await f.db.transaction(f.scope,'readwrite',f.lease,async tx=>{const row=await tx.get<any>('account-files',f.file.id);row.request.purpose='file';await tx.put('account-files',f.file.id,row);});
  const before=(await f.history.rows({thingId:f.post.id})).map(row=>row.event.id);
  await assert.rejects(f.recover(),/retained file purpose, target, or metadata changed/i);
  assert.equal(await f.sync.view(f.post.id),null);
  await assert.rejects(f.files.readFile(f.file.id));
  assert.deepEqual((await f.history.rows({thingId:f.post.id})).map(row=>row.event.id),before,'failed apply cannot change History');
  await f.db.transaction(f.scope,'readonly',f.lease,async tx=>assert.ok((await tx.get<any>('thing-sync',f.post.id))?.deleted,'failed apply keeps its tombstone'));
  await f.db.transaction(f.scope,'readonly',f.lease,async tx=>assert.deepEqual(await tx.getBytes(f.file.id),f.bytes));
 }finally{await f.close();}
});

for(const field of ['filename','contentType','sizeBytes','sha256'] as const) test(`changed retained ${field} cannot authorize image-post recovery`,async()=>{
 const f=await fixture(false);try{
  await f.sync.things.savePost({id:f.post.id,thingtime:['post'],crystal:{type:'image',text:'Image parent',images:[]},attachmentIds:[f.file.id]},true);
  await f.sync.remove([f.post.id]);
  await f.db.transaction(f.scope,'readwrite',f.lease,async tx=>{const row=await tx.get<any>('account-files',f.file.id);
   if(field==='sha256')row.sha256='0'.repeat(64);else if(field==='sizeBytes')row.request.sizeBytes+=1;else row.request[field]='changed';
   await tx.put('account-files',f.file.id,row);
  });
  const before=(await f.history.rows({thingId:f.post.id})).map(row=>row.event.id);
  await assert.rejects(f.recover(),/retained file purpose, target, or metadata changed|complete attached file bytes are not retained|retained attached file bytes changed/i);
  assert.equal(await f.sync.view(f.post.id),null);
  assert.deepEqual((await f.history.rows({thingId:f.post.id})).map(row=>row.event.id),before);
  await f.db.transaction(f.scope,'readonly',f.lease,async tx=>{assert.ok((await tx.get<any>('thing-sync',f.post.id))?.deleted);assert.deepEqual(await tx.getBytes(f.file.id),f.bytes);});
 }finally{await f.close();}
});

test('same-size corrupted retained bytes refuse recovery without changing tombstones, bytes, or History',async()=>{
 const f=await fixture(false);try{
  await f.sync.remove([f.post.id]);
  const changed=Uint8Array.from(f.bytes);changed[0]^=1;
  await f.db.transaction(f.scope,'readwrite',f.lease,tx=>tx.putBytes(f.file.id,changed));
  const before=(await f.history.rows({thingId:f.post.id})).map(row=>row.event.id);
  await assert.rejects(f.recover(),/retained attached file bytes changed after deletion/i);
  assert.equal(await f.sync.view(f.post.id),null);
  assert.deepEqual((await f.history.rows({thingId:f.post.id})).map(row=>row.event.id),before);
  await f.db.transaction(f.scope,'readonly',f.lease,async tx=>{assert.ok((await tx.get<any>('thing-sync',f.post.id))?.deleted);assert.deepEqual(await tx.getBytes(f.file.id),changed);});
 }finally{await f.close();}
});

test('same-size binary replacement after checksum preflight refuses the atomic recovery',async()=>{
 const f=await fixture(false);try{
  await f.sync.remove([f.post.id]);
  const changed=Uint8Array.from(f.bytes);changed[0]^=1;
  const writer=new AccountTimelineVersions(f.db,f.scope,f.lease,f.sync.things,f.store,[],async(id,signal)=>{
   await f.files.verifyRecoveryBytes(id,signal);
   await f.db.transaction(f.scope,'readwrite',f.lease,tx=>tx.putBytes(f.file.id,changed));
  });
  const before=(await f.history.rows({thingId:f.post.id})).map(row=>row.event.id);
  await assert.rejects(f.recover(f.post.id,writer),/complete attached file bytes are not retained/i);
  assert.equal(await f.sync.view(f.post.id),null);
  assert.deepEqual((await f.history.rows({thingId:f.post.id})).map(row=>row.event.id),before);
  await f.db.transaction(f.scope,'readonly',f.lease,async tx=>{assert.ok((await tx.get<any>('thing-sync',f.post.id))?.deleted);assert.deepEqual(await tx.getBytes(f.file.id),changed);});
 }finally{await f.close();}
});

test('stored-file History recovery refuses missing checksum preflight and retired identity',async()=>{
 const f=await fixture(false);try{
  await f.sync.remove([f.post.id]);
  const unverified=new AccountTimelineVersions(f.db,f.scope,f.lease,f.sync.things,f.store);
  await assert.rejects(f.recover(f.post.id,unverified),/complete attached file bytes are not retained/i);
  const retiring=new AccountTimelineVersions(f.db,f.scope,f.lease,f.sync.things,f.store,[],async(id,signal)=>{await f.files.verifyRecoveryBytes(id,signal);f.retire();});
  await assert.rejects(f.recover(f.post.id,retiring),/Retired workspace/);
 }finally{await f.close();}
});

test('linked-only History recovery does not require a stored-byte checksum proof',async()=>{
 const f=await fixture(false);try{
  await f.files.removeBound(f.file.id,f.post.id);
  const link=await f.files.things.saveLinkedFile({requestId:randomUUID(),url:'https://example.invalid/a.png',purpose:'post',mediaKind:'file'});
  await f.sync.things.savePost({id:f.post.id,thingtime:['post'],crystal:{type:'text',text:'Linked recovery'},attachmentIds:[link.id]},true);
  await f.sync.remove([f.post.id]);
  const unverified=new AccountTimelineVersions(f.db,f.scope,f.lease,f.sync.things,f.store);
  const result=await f.recover(f.post.id,unverified);assert.ok('entry' in result);
  assert.equal((await f.files.things.get(link.id)).targetId,f.post.id);
  assert.equal((await f.sync.things.get(f.post.id)).crystal.text,'Linked recovery');
 }finally{await f.close();}
});

for(const fault of ['foreign target','missing binary'] as const) test(`${fault} refuses a deleted parent without partial History recovery`,async()=>{
 const f=await fixture(false);try{
  await f.sync.remove([f.post.id]);
  await f.db.transaction(f.scope,'readwrite',f.lease,async tx=>{
   if(fault==='foreign target'){
    const row=await tx.get<any>('account-files',f.file.id);row.deletingLocal.targetId='another-parent';await tx.put('account-files',f.file.id,row);
   }else await tx.deleteBytes(f.file.id);
  });
  const before=(await f.history.rows({thingId:f.post.id})).map(row=>row.event.id);
  await assert.rejects(f.recover(),/file captured by this post deletion is no longer completely retained|complete attached file bytes are not retained/i);
  assert.equal(await f.sync.view(f.post.id),null);
  assert.deepEqual((await f.history.rows({thingId:f.post.id})).map(row=>row.event.id),before);
  await f.db.transaction(f.scope,'readonly',f.lease,async tx=>{assert.ok((await tx.get<any>('thing-sync',f.post.id))?.deleted);assert.equal(!!await tx.getBytes(f.file.id),fault==='foreign target');});
 }finally{await f.close();}
});
