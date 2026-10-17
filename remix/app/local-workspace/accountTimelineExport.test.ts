import assert from 'node:assert/strict';
import test from 'node:test';
import {IDBFactory} from 'fake-indexeddb';
import {AccountThingSync} from './accountSync';
import {AccountTimeline,AccountTimelineStore,accountTimelineScope} from './accountTimeline';
import {WorkspaceDatabase} from './storage';
import {IndexedDbTimelineBackend} from '../timeline/indexedDb';
import {TimelineNoteStore} from '../timeline/noteStore';
import {entryFixture,eventFixture} from '../timeline/testFixtures';
import {parseTimelineEntry,TIMELINE_EVENT_MAX_BYTES} from '../timeline/contract';
import {exportAccountTimelineVersion} from './accountTimelineExport';
import {parseTimelineVersionExport} from '../timeline/exportVersion';

const scope={kind:'account',origin:'https://history.example',ownerId:'owner',dataPlane:'home'} as const;
const setup=()=>{
 const factory=new IDBFactory(),db=new WorkspaceDatabase(factory),backend=new IndexedDbTimelineBackend(factory);
 let active=true;
 const lease={assertCurrent(){if(!active)throw new Error('Workspace retired');},onInvalidate:()=>()=>{}};
 const history=new AccountTimeline(db,scope,lease),store=new AccountTimelineStore(accountTimelineScope(scope),backend,history),notes=new TimelineNoteStore(store.scope,backend);
 return {factory,db,backend,lease,history,store,notes,sync:new AccountThingSync(db,scope,lease),retire:()=>{active=false;},close:async()=>{await backend.close();await db.close();}};
};
const content=(name:string)=>({adapter:'thing-content',version:1,value:{crystal:{name},extended:null,tags:[],geo:null,acl:['tt:user'],folderId:null}});

test('unacknowledged edits export exact earlier data after reload without fabricated receipts or mutations',async()=>{
 const f=setup();try{
  const thing=await f.sync.things.create({thingtime:['data'],crystal:{name:'Original'}});
  const [first]=await f.store.pending();await f.sync.things.update({id:thing.id,crystal:{name:'Later'}});
  const pending=await f.store.pending(),status=await f.sync.status();await f.close();
  const db=new WorkspaceDatabase(f.factory),backend=new IndexedDbTimelineBackend(f.factory),store=new AccountTimelineStore(f.store.scope,backend,new AccountTimeline(db,scope,f.lease)),notes=new TimelineNoteStore(store.scope,backend);
  try{
   const result=await exportAccountTimelineVersion(first.id,{store,notes,lease:f.lease});
   assert.deepEqual(result.export.event,first);assert.equal(result.export.receipt,null);assert.equal((result.export.content.value as any).crystal.name,'Original');
   assert.deepEqual(result.export.context,{source:'device',complete:false});assert.throws(()=>parseTimelineEntry({event:first,receipt:null}),/receipt/);
   assert.throws(()=>parseTimelineVersionExport(result,{ownerId:scope.ownerId,id:first.id},true),/receipt/);
   assert.deepEqual(await store.pending(),pending);assert.deepEqual(await new AccountThingSync(db,scope,f.lease).status(),status);
   f.retire();assert.throws(result.assertAvailable,/retired/);
  }finally{await backend.close();await db.close();}
 }finally{await f.close();}
});

test('cached accepted versions and compact ancestry export without borrowing current Things',async()=>{
 const f=setup();try{
  const full=eventFixture('remote',{ownerId:'owner',actorId:'owner',thingId:'remote-thing',source:'api',clientId:null,mode:'revision',after:content('Saved')});
  const move=eventFixture('move',{...full,id:'move',operationId:'move-operation',parentIds:[full.id],operation:'update',before:content('Saved'),after:{adapter:'folder-placement',version:1,value:{folderId:'recorded-folder'}}});
  await f.store.accept([entryFixture(full,1),entryFixture(move,2)]);
  const result=await exportAccountTimelineVersion(move.id,f);
  assert.deepEqual(result.export.receipt,entryFixture(move,2).receipt);assert.equal((result.export.content.value as any).crystal.name,'Saved');assert.equal((result.export.content.value as any).folderId,'recorded-folder');
  const entry=parseTimelineEntry(result.export?{event:result.export.event,receipt:result.export.receipt}:null);assert.deepEqual(entry.event,move);
  await f.store.prune(0,0);await assert.rejects(exportAccountTimelineVersion(move.id,f),/not retained/);
 }finally{await f.close();}
});

test('device archive context contains only canonical retained notes and naming effects',async()=>{
 const f=setup();try{
  const thing=await f.sync.things.create({thingtime:['data'],crystal:{name:'Named'}}),[event]=await f.store.pending();
  await f.store.accept([entryFixture(event,1)]);
  const note={formatVersion:1 as const,id:'note-'+crypto.randomUUID(),ownerId:scope.ownerId,eventId:event.id,thingId:thing.id,author:'owner' as const,text:'Retained note',createdAt:event.occurredAt};
  await f.notes.accept([note]);
  const name={formatVersion:1 as const,id:event.id+'/name',ownerId:scope.ownerId,eventId:event.id,thingId:thing.id,name:'Remembered',revision:1,createdAt:event.occurredAt,updatedAt:event.occurredAt};
  const effect=eventFixture('name-effect',{ownerId:scope.ownerId,actorId:scope.ownerId,thingId:thing.id,mode:'effect',operation:'effect',source:'api',clientId:null,after:{adapter:'timeline-version-name',version:1,value:name},dependencies:[{thingId:thing.id,eventId:event.id}]});
  await f.store.accept([entryFixture(effect,2)]);
  const result=await exportAccountTimelineVersion(event.id,f);assert.deepEqual(result.export.notes,[note]);assert.deepEqual(result.export.name,name);assert.equal(result.export.context?.complete,false);
  await assert.rejects(exportAccountTimelineVersion(effect.id,f),/Only saved/);
 }finally{await f.close();}
});

test('invalid identity, missing ancestry, oversized content, abort and retired readers fail clearly',async()=>{
 const f=setup();try{
  const thing=await f.sync.things.create({thingtime:['data'],crystal:{name:'Private'}}),[event]=await f.store.pending();
  await assert.rejects(exportAccountTimelineVersion('bad\nid',f),/Invalid/);
  const controller=new AbortController();controller.abort();await assert.rejects(exportAccountTimelineVersion(event.id,f,controller.signal),/abort/i);
  const result=await exportAccountTimelineVersion(event.id,f);
  assert.throws(()=>parseTimelineVersionExport(result,{ownerId:'other',id:event.id}),/another version/);
  assert.throws(()=>parseTimelineVersionExport({...result.export,receipt:null,context:undefined},{ownerId:'owner',id:event.id}),/JSON values|receipt/);
  assert.throws(()=>parseTimelineVersionExport({...result.export,event:{...event,source:'api',mode:'revision',clientId:null}},{ownerId:'owner',id:event.id}),/receipt/);
  assert.throws(()=>parseTimelineVersionExport({...result.export,notes:[{ownerId:'other'}]},{ownerId:'owner',id:event.id}),/Timeline note/);
  assert.throws(()=>parseTimelineVersionExport({...result.export,padding:'x'.repeat(TIMELINE_EVENT_MAX_BYTES)},{ownerId:'owner',id:event.id}),/budget/);
  const compact=eventFixture('orphan',{...event,id:'orphan',thingId:thing.id,parentIds:['missing'],operation:'update',before:content('Before'),after:{adapter:'folder-placement',version:1,value:{folderId:null}}});
  await f.store.enqueue(compact);await assert.rejects(exportAccountTimelineVersion(compact.id,f),/Earlier versions/);
  f.retire();await assert.rejects(exportAccountTimelineVersion(event.id,f),/retired/);
 }finally{await f.close();}
});

test('offline archives retain acknowledged names across reload without exporting pending projections or resurrecting clears',async()=>{
 const {TimelineNameQueue}=await import('../timeline/nameQueue');
 const f=setup();try{
  const event=eventFixture('named-remote',{ownerId:'owner',actorId:'owner',thingId:'named-thing',source:'api',clientId:null,mode:'revision',after:content('Named')});
  await f.store.accept([entryFixture(event,1)]);
  const name={formatVersion:1 as const,id:event.id+'/name',ownerId:'owner',eventId:event.id,thingId:event.thingId,name:'Accepted account name',revision:1,createdAt:event.occurredAt,updatedAt:event.occurredAt};
  const names=new TimelineNameQueue(f.store.scope,f.backend);await names.accept([name],[event.id],Date.now());
  const effect=eventFixture('retained-name',{ownerId:'owner',actorId:'owner',thingId:event.thingId,source:'api',clientId:null,mode:'effect',operation:'effect',after:{adapter:'timeline-version-name',version:1,value:name},dependencies:[{thingId:event.thingId,eventId:event.id}]});
  await f.store.accept([entryFixture(effect,2)]);
  await names.enqueue({command:'name-version',operationId:crypto.randomUUID(),eventId:event.id,thingId:event.thingId,name:'Pending local name',expectedRevision:1},event);
  await f.backend.close();
  const reopened=new IndexedDbTimelineBackend(f.factory);try{
   const retained=new TimelineNameQueue(f.store.scope,reopened);
   assert.equal((await retained.view([event.id])).get(event.id)?.name,'Pending local name');
   assert.deepEqual((await exportAccountTimelineVersion(event.id,{...f,names:retained})).export.name,name);
   await retained.accept([], [event.id],Date.now()+1000);
   const archive=(await exportAccountTimelineVersion(event.id,{...f,names:retained})).export;
   assert.equal(archive.name,null);assert.deepEqual(archive.context,{source:'device',complete:false});assert.equal((await retained.queued()).length,1);
   const foreign=new TimelineNameQueue({...f.store.scope,ownerId:'other'},reopened);
   await assert.rejects(exportAccountTimelineVersion(event.id,{...f,names:foreign}),/another workspace/);
  }finally{await reopened.close();}
 }finally{await f.close();}
});
