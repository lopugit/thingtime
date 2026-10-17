import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';
import { AccountThingSync } from './accountSync';
import { AccountTimeline, AccountTimelineStore, accountTimelineScope } from './accountTimeline';
import { AccountTimelineVersions } from './accountTimelineVersions';
import { IndexedDbTimelineBackend } from '../timeline/indexedDb';
import { parsePublishedVersionPreview, type VersionRequest } from '../timeline/publishedVersion';
import { eventFixture, entryFixture } from '../timeline/testFixtures';
import { thingContentSnapshot } from '../timeline/thingContent';
import { parseTimelineEntry } from '../timeline/contract';
const scope={kind:'account',origin:'https://thingtime.example',ownerId:'owner',dataPlane:'home'} as const;
function fixture(injected?:WorkspaceDatabase){
 const factory=new IDBFactory(),db=injected??new WorkspaceDatabase(factory),backend=new IndexedDbTimelineBackend(factory);
 let active=true;const lease:WorkspaceLease={assertCurrent(){if(!active)throw new Error('Retired workspace');},onInvalidate:()=>()=>{}};
 const sync=new AccountThingSync(db,scope,lease),history=new AccountTimeline(db,scope,lease),store=new AccountTimelineStore(accountTimelineScope(scope),backend,history),versions=new AccountTimelineVersions(db,scope,lease,sync.things,store);
 const preview=async(eventId:string,thingId:string,mode:VersionRequest['mode']='restore',extra:Partial<VersionRequest>={})=>{
  const request:VersionRequest={command:'preview-version',eventId,mode,componentMode:'recorded',choices:{},componentChoices:{},...extra};
  const result=await versions.request(request);assert.ok('preview' in result);
  const value=parsePublishedVersionPreview(result.preview,eventId,thingId,request);
  return {value,apply:{...request,command:'apply-version',operationId:randomUUID(),expectedHeadId:value.expectedHeadId,expectedComponents:value.components!.fingerprint,...(value.recoveryFingerprint?{expectedRecovery:value.recoveryFingerprint}:{})} as VersionRequest};
 };
 return {db,backend,sync,history,store,versions,preview,retire:()=>{active=false;},close:async()=>{await backend.close();await db.close();}};
}
test('account restore is an atomic device edit with immutable retry identity and no invented receipt',async()=>{
 const f=fixture();try{
  const thing=await f.sync.things.create({thingtime:['data'],crystal:{name:'Original',left:1,right:1}}),[first]=await f.store.pending();
  await f.sync.things.update({id:thing.id,crystal:{name:'Later'}});
  const p=await f.preview(first.id,thing.id),result=await f.versions.request(p.apply);assert.ok('entry' in result);
  assert.equal(result.savedLocally,true);assert.equal(result.entry.receipt,null);assert.equal(result.entry.event.source,'client');assert.equal(result.entry.event.mode,'draft');
  assert.equal(result.entry.event.id,`version-${p.apply.operationId}`);assert.equal(result.entry.event.operation,'restore');
  assert.equal((await f.sync.things.get(thing.id)).crystal.name,'Original');assert.throws(()=>parseTimelineEntry(result.entry),/receipt/);
  await f.sync.things.update({id:thing.id,crystal:{name:'After restore'}});
  assert.deepEqual(await f.versions.request(p.apply),result);assert.equal((await f.sync.things.get(thing.id)).crystal.name,'After restore');
  await assert.rejects(f.versions.request({...p.apply,mode:'merge'}),/already used/);
  await assert.rejects(f.versions.request({...p.apply,operationId:randomUUID()}),/changed/);
  assert.equal((await f.sync.status())[0].state,'pending');
  await f.sync.remove([thing.id]);
  assert.deepEqual(await f.versions.request(p.apply),result,'committed replay survives a later deletion without restoring it again');
  await assert.rejects(f.sync.things.get(thing.id),/not in this workspace/);
 }finally{await f.close();}
});
test('account undo retains independent edits, requires overlap choices and fences retired workspaces',async()=>{
 const f=fixture();try{
  const thing=await f.sync.things.create({thingtime:['data'],crystal:{name:'Original',left:1,right:1}});
  await f.sync.things.update({id:thing.id,crystal:{left:2}});
  const edit=(await f.history.rows()).find(row=>(row.event.after?.value as any)?.crystal?.left===2)!;
  await f.sync.things.update({id:thing.id,crystal:{right:2}});
  const p=await f.preview(edit.event.id,thing.id,'undo');await f.versions.request(p.apply);
  assert.deepEqual((await f.sync.things.get(thing.id)).crystal,{name:'Original',left:1,right:2});
  await assert.rejects(f.preview(edit.event.id,thing.id,'undo'),/Nothing to undo/);
  await f.sync.things.update({id:thing.id,crystal:{left:3}});
  const conflict=await f.preview(edit.event.id,thing.id,'undo');assert.equal(conflict.value.conflicts.length,1);
  await assert.rejects(f.versions.request(conflict.apply),/overlapping/);
  const chosen=await f.preview(edit.event.id,thing.id,'undo',{choices:{'["crystal","left"]':'incoming'}});await f.versions.request(chosen.apply);
  f.retire();await assert.rejects(f.versions.request(chosen.apply),/Retired/);
 }finally{await f.close();}
});


test('cached server versions restore offline from an exact retained current basis, including component copies',async()=>{
 const f=fixture();try{
  const remote={id:'retained-account-data',thingtime:['data'],crystal:{name:'Current'},author:{id:scope.ownerId},acl:['tt:user'],visibility:'private',createdAt:'2026-10-17T00:00:00.000Z',updatedAt:'2026-10-17T00:00:01.000Z',revision:1};
  await f.sync.remember(remote);
  const first=eventFixture('retained-first',{ownerId:scope.ownerId,actorId:scope.ownerId,thingId:remote.id,source:'api',mode:'revision',clientId:null,after:thingContentSnapshot({...remote,crystal:{name:'Earlier'}})});
  const head=eventFixture('retained-current',{...first,id:'retained-current',parentIds:[first.id],after:thingContentSnapshot(remote)});
  await f.store.accept([entryFixture(first,1),entryFixture(head,2)]);
  const p=await f.preview(first.id,remote.id);assert.equal(p.value.expectedHeadId,head.id);
  await f.versions.request(p.apply);assert.equal((await f.sync.things.get(remote.id)).crystal.name,'Earlier');
  await f.store.prune(0,0);assert.ok((await f.history.entries([first.id]))[0].receipt,'the reviewed basis is retained independently of evictable cache');
  const component=await f.sync.things.create({thingtime:['component'],crystal:{name:'Card',componentKey:'restore-card',version:1,render:{tag:'p',children:'Original component'}}});
  const page=await f.sync.things.create({thingtime:['webpage'],crystal:{name:'Page',blocks:[{id:'card',type:'component',component:component.id}]}});
  const source=(await f.history.rows({thingId:page.id}))[0];
  await f.sync.things.update({id:component.id,crystal:{render:{tag:'p',children:'Changed component'}}});
  await f.sync.things.update({id:page.id,crystal:{name:'Changed page'}});
  const plan=await f.preview(source.event.id,page.id);assert.equal(plan.value.components!.copyCount,1);
  await f.versions.request(plan.apply);
  const restored=await f.sync.things.get(page.id),copyId=(restored.crystal.blocks as any[])[0].component;
  assert.notEqual(copyId,component.id);assert.equal(((await f.sync.things.get(copyId)).crystal.render as any).children,'Original component');
  assert.equal(((await f.sync.things.get(component.id)).crystal.render as any).children,'Changed component');
  assert.ok((await f.sync.status()).some(row=>row.id===copyId&&row.state==='pending'));
 }finally{await f.close();}
});


class FailingHistoryDatabase extends WorkspaceDatabase {
 fail=false;
 override transaction<T>(scope:WorkspaceScope,mode:IDBTransactionMode,lease:WorkspaceLease,run:(tx:WorkspaceTransaction)=>Promise<T>){
  return super.transaction(scope,mode,lease,tx=>run({...tx,put:async(collection,id,value)=>{
   if(this.fail&&collection==='timeline-events'&&id.startsWith('version-'))throw new Error('Injected History quota failure');
   await tx.put(collection,id,value);
  }}));
 }
}
test('failed account History capture rolls back content and sync intent, and concurrent retries commit once',async()=>{
 const db=new FailingHistoryDatabase(new IDBFactory()),f=fixture(db);try{
  const thing=await f.sync.things.create({thingtime:['data'],crystal:{name:'Original'}}),[source]=await f.store.pending();
  await f.sync.things.update({id:thing.id,crystal:{name:'Later'}});
  const plan=await f.preview(source.id,thing.id),content=await f.sync.things.snapshot(),status=await f.sync.status(),events=await f.history.rows();
  db.fail=true;await assert.rejects(f.versions.request(plan.apply),/quota failure/);
  assert.deepEqual(await f.sync.things.snapshot(),content);assert.deepEqual(await f.sync.status(),status);assert.deepEqual(await f.history.rows(),events);
  db.fail=false;const [one,two]=await Promise.all([f.versions.request(plan.apply),f.versions.request(plan.apply)]);assert.deepEqual(one,two);
  assert.equal((await f.history.rows()).filter(row=>row.event.id===`version-${plan.apply.operationId}`).length,1);
  const cancelled=new AbortController();cancelled.abort();await assert.rejects(f.versions.request(plan.apply,cancelled.signal),/abort/i);
 }finally{await f.close();}
});


test('a never-sent account deletion can recover offline without a remote receipt',async()=>{
 const f=fixture();try{
  const thing=await f.sync.things.create({thingtime:['data'],crystal:{name:'Recover me'}});
  await f.sync.remove([thing.id]);
  const deletion=(await f.history.rows({thingId:thing.id})).find(row=>row.event.operation==='delete')!;
  const p=await f.preview(deletion.event.id,thing.id,'restore',{recover:true});
  assert.equal(p.value.recovery,true);
  const result=await f.versions.request(p.apply);assert.ok('entry' in result);
  assert.equal(result.entry.receipt,null);assert.equal(result.entry.event.operation,'create');
  assert.equal(result.entry.event.label,'Recovered deleted Thing');
  assert.equal((await f.sync.things.get(thing.id)).crystal.name,'Recover me');
  assert.deepEqual((await f.sync.view(thing.id))!.acl,['tt:user']);
  assert.equal((await f.sync.status())[0].state,'pending');
  assert.deepEqual(await f.versions.request(p.apply),result);
 }finally{await f.close();}
});


test('accepted deleted history recovers its original identity privately, but a newer accepted head refuses stale recovery',async()=>{
 const f=fixture();try{
  const doc={id:'deleted-account-data',thingtime:['data'],crystal:{name:'Before deletion'},acl:['tt:public'],folderId:'missing-folder'};
  const source=eventFixture('deleted-source',{ownerId:scope.ownerId,actorId:scope.ownerId,thingId:doc.id,source:'api',mode:'revision',clientId:null,after:thingContentSnapshot(doc)});
  const deletion=eventFixture('deleted-head',{...source,id:'deleted-head',operation:'delete',before:source.after,after:null,parentIds:[source.id]});
  await f.store.accept([entryFixture(source,1),entryFixture(deletion,2)]);
  const p=await f.preview(source.id,doc.id,'restore',{recover:true});assert.equal(p.value.expectedHeadId,deletion.id);
  await f.versions.request(p.apply);
  const restored=await f.sync.view(doc.id);assert.equal(restored!.crystal.name,'Before deletion');assert.deepEqual(restored!.acl,['tt:user']);assert.equal(restored!.folderId??null,null);
  const other={...source,id:'stale-deletion-source',thingId:'recreated-elsewhere'},old={...deletion,id:'stale-deletion',thingId:other.thingId,parentIds:[other.id]},newer={...other,id:'newer-create',parentIds:[old.id]};
  await f.store.accept([entryFixture(other,3),entryFixture(old,4),entryFixture(newer,5)]);
  await assert.rejects(f.preview(old.id,other.thingId,'restore',{recover:true}),/recorded deletion/);
 }finally{await f.close();}
});

test('recovery quota failure rolls back deletion intent and component copies as one transaction',async()=>{
 const db=new FailingHistoryDatabase(new IDBFactory()),f=fixture(db);try{
  const component=await f.sync.things.create({thingtime:['component'],crystal:{name:'Recovery card',componentKey:'recover-card',version:1,render:{tag:'p',children:'Recorded text'}}});
  const page=await f.sync.things.create({thingtime:['webpage'],crystal:{name:'Deleted page',blocks:[{id:'card',type:'component',component:component.id}]}});
  await f.sync.remove([page.id]);
  const deletion=(await f.history.rows({thingId:page.id})).find(row=>row.event.operation==='delete')!;
  const p=await f.preview(deletion.event.id,page.id,'restore',{recover:true});assert.equal(p.value.components!.copyCount,1);
  const content=await f.sync.things.snapshot(),status=await f.sync.status(),events=await f.history.rows();
  db.fail=true;await assert.rejects(f.versions.request(p.apply),/quota failure/);
  assert.deepEqual(await f.sync.things.snapshot(),content);assert.deepEqual(await f.sync.status(),status);assert.deepEqual(await f.history.rows(),events);
  db.fail=false;await f.versions.request(p.apply);
  const copy=((await f.sync.things.get(page.id)).crystal.blocks as any[])[0].component;assert.notEqual(copy,component.id);
  assert.equal(((await f.sync.things.get(copy)).crystal.render as any).children,'Recorded text');
 }finally{await f.close();}
});
