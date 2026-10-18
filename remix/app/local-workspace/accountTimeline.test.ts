import { createQuotaFactory, TEST_STORAGE_CAPACITY } from './storageTestFixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBKeyRange } from 'fake-indexeddb';
import { WorkspaceDatabase, type WorkspaceScope, type WorkspaceLease, type WorkspaceTransaction } from './storage';
import { AccountThingSync } from './accountSync';
import { AccountTimeline, AccountTimelineStore, accountTimelineScope } from './accountTimeline';
import { IndexedDbTimelineBackend } from '../timeline/indexedDb';
import { TimelineSync } from '../timeline/sync';
import { entryFixture } from '../timeline/testFixtures';
import { capturedComponentBindings } from '../timeline/componentBindings';
const scope={kind:'account',origin:'https://history.example',ownerId:'owner',dataPlane:'home'} as const;
const lease={assertCurrent(){},onInvalidate:()=>()=>{}};
test('account edits and deletion retain each device version atomically',async()=>{
 const db=new WorkspaceDatabase(createQuotaFactory());const sync=new AccountThingSync(db,scope,lease);
 try{
  const row=await sync.things.create({thingtime:['data'],crystal:{name:'First'}});
  await sync.things.update({id:row.id,crystal:{name:'Second'}});await sync.remove([row.id]);
  await db.transaction(scope,'readonly',lease,async tx=>{
   const events=await tx.list<any>('timeline-events');assert.equal(events.length,3);
   assert.ok(events.every(({value})=>value.event.ownerId===scope.ownerId&&value.event.mode==='draft'&&value.event.source==='client'));
   assert.deepEqual(new Set(events.map(({value})=>value.event.operation)),new Set(['create','update','delete']));
  });
 }finally{await db.close();}
});

const setup = () => {
 const factory=createQuotaFactory(), db=new WorkspaceDatabase(factory,undefined,undefined,IDBKeyRange);
 const history=new AccountTimeline(db,scope,lease), backend=new IndexedDbTimelineBackend(factory);
 return {factory,db,history,backend,sync:new AccountThingSync(db,scope,lease),store:new AccountTimelineStore(accountTimelineScope(scope),backend,history)};
};

test('intermediate versions, audience changes and canonical relationships survive a cold reopen',async()=>{
 const f=setup();
 try {
  const row=await f.sync.things.create({thingtime:['data'],crystal:{name:'First'}});
  await f.sync.things.update({id:row.id,crystal:{name:'Second'},acl:['tt:public']} as any);
  await f.sync.remove([row.id]);
  const events=await f.store.pending();
  assert.equal(events.length,3);assert.deepEqual(events.map(event=>event.operation),['create','update','delete']);
  assert.deepEqual(events.map(event=>event.parentIds),[[],[events[0].id],[events[1].id]]);
  assert.deepEqual((events[1].before!.value as any).acl,['tt:user']);assert.deepEqual((events[1].after!.value as any).acl,['tt:public']);
  assert.equal((events[1].before!.value as any).crystal.name,'First');assert.equal((events[1].after!.value as any).crystal.name,'Second');
  assert.equal(events[2].after,null);assert.ok(events.every(event=>event.ownerId==='owner'&&event.actorId==='owner'&&event.clientId===events[0].clientId&&event.source==='client'&&event.mode==='draft'));
  assert.ok((await f.history.rows()).every(row=>row.receipt===null));
  await f.db.close();const reopened=new WorkspaceDatabase(f.factory);
  try {assert.deepEqual((await new AccountTimeline(reopened,scope,lease).entries(events.map(event=>event.id))).map(row=>row.event),events);}finally{await reopened.close();}
 }finally{await f.db.close();}
});

test('component definitions are immutable snapshots and sync before the page using them',async()=>{
 const f=setup();
 try {
  const component=await f.sync.things.create({thingtime:['component'],crystal:{name:'Card',componentKey:'card',version:1,render:{tag:'p',children:'Original'}}});
  const blocks=[{id:'card',type:'component',component:'card'}];
  const page=await f.sync.things.create({thingtime:['webpage'],crystal:{name:'Page',blocks}});
  const version=(await f.store.forThing(page.id))[0].event;
  await f.sync.things.update({id:component.id,crystal:{render:{tag:'p',children:'Changed'}}});
  const dependencies=await f.store.entries(version.dependencies.map(ref=>ref.eventId));
  assert.equal(capturedComponentBindings(version,dependencies.map(row=>row.event),blocks).components.card?.crystal.render.children,'Original');
  const pending=await f.store.pending();
  for(const ref of version.dependencies)assert.ok(pending.findIndex(event=>event.id===ref.eventId)<pending.findIndex(event=>event.id===version.id));
  assert.ok(dependencies.every(row=>row.event.mode==='draft'&&row.event.ownerId===scope.ownerId&&row.event.source==='client'));
 }finally{await f.db.close();}
});

test('normal History sync retries exact identities and cache clearing preserves authored versions',async()=>{
 const f=setup();
 try {
  const row=await f.sync.things.create({thingtime:['data'],crystal:{name:'First'}});
  await f.sync.things.update({id:row.id,crystal:{name:'Second'}});
  const events=await f.store.pending(), committed=new Map<string,ReturnType<typeof entryFixture>>(), calls:string[]=[];
  let loseReply=true;
  const sync=new TimelineSync(f.store,{push:async event=>{
   calls.push(event.id);if(!committed.has(event.id))committed.set(event.id,entryFixture(event,committed.size+1));
   if(loseReply){loseReply=false;throw new Error('Lost reply');}return committed.get(event.id)!;
  },page:async()=>{throw new Error('Unused');}});
  await assert.rejects(sync.pushPending(),/Lost reply/);assert.equal((await f.store.pending()).length,2);
  assert.equal(await sync.pushPending(),2);assert.deepEqual(calls,[events[0].id,events[0].id,events[1].id]);
  assert.equal((await f.store.pending()).length,0);
  await f.store.prune(0,0);assert.equal((await f.backend.read(f.store.key)).length,0);
  assert.deepEqual(new Set((await f.store.forThing(row.id)).map(row=>row.event.id)),new Set(events.map(event=>event.id)));
  assert.ok((await f.history.rows()).every(row=>row.receipt!==null));
  await assert.rejects(f.store.accept([entryFixture({...events[0],label:'Changed'},1)]),/different History content/);
  await assert.rejects(f.store.accept([entryFixture(events[0],99)]),/receipt identity/);
  assert.equal((await f.history.entries([events[0].id]))[0].receipt!.position,1);
 }finally{await f.db.close();}
});

test('an event failure rolls back the Thing and its sync intent in the same transaction',async()=>{
 class FailingHistoryDatabase extends WorkspaceDatabase {
  override transaction<T>(scope:WorkspaceScope,mode:IDBTransactionMode,lease:WorkspaceLease,run:(tx:WorkspaceTransaction)=>Promise<T>){
   return super.transaction(scope,mode,lease,tx=>run({...tx,put:async(collection,id,value)=>{
    if(collection==='timeline-index')throw new Error('History write failed');await tx.put(collection,id,value);
   }}));
  }
 }
 const db=new FailingHistoryDatabase(createQuotaFactory(),undefined,undefined,IDBKeyRange);
 try {
  await assert.rejects(new AccountThingSync(db,scope,lease).things.create({thingtime:['data'],crystal:{name:'Atomic'}}),/History write failed/);
  await db.transaction(scope,'readonly',lease,async tx=>{
   for(const collection of ['things','thing-sync','timeline-events','timeline-links','timeline-index','timeline-meta'])assert.deepEqual(await tx.list(collection),[]);
   assert.deepEqual(await tx.usage(),{records:0,bytes:0});
  });
 }finally{await db.close();}
});

test('reserved receipt space allows acknowledgement at the full workspace byte quota',async()=>{
 const f=setup();
 try {
  await f.sync.things.create({thingtime:['data'],crystal:{name:'Retain me'}});
  const [event]=await f.store.pending();
  await f.db.transaction(scope,'readwrite',lease,async tx=>{
   let available=TEST_STORAGE_CAPACITY.bytes-(await tx.usage()).bytes,index=0;
   while(available){const size=Math.min(available,TEST_STORAGE_CAPACITY.binaryBytes);await tx.putBytes(`filler-${index++}`,new Uint8Array(size));available-=size;}
  });
  await assert.rejects(f.sync.things.create({thingtime:['data'],crystal:{name:'Over quota'}}),/full|quota|limit/i);
  await f.store.accept([entryFixture(event)]);
  assert.equal((await f.history.entries([event.id]))[0].receipt!.position,1);
 }finally{await f.db.close();}
});

test('simultaneous tabs serialize ancestry and retired or foreign scopes cannot access device history',async()=>{
 const f=setup(), secondDb=new WorkspaceDatabase(f.factory), second=new AccountThingSync(secondDb,scope,lease);
 try {
  const row=await f.sync.things.create({thingtime:['data'],crystal:{name:'Initial'}});
  await Promise.all([f.sync.things.update({id:row.id,crystal:{name:'Tab one'}}),second.things.update({id:row.id,crystal:{name:'Tab two'}})]);
  const events=await f.store.pending();assert.equal(events.length,3);assert.deepEqual(events[2].parentIds,[events[1].id]);assert.deepEqual(events[2].before,events[1].after);
  for(const other of [{...scope,ownerId:'other'},{...scope,origin:'https://other.example'},{...scope,dataPlane:'custom'}]){
   assert.equal((await new AccountTimeline(f.db,other,lease).rows()).length,0);
  }
  assert.throws(()=>new AccountTimeline(f.db,{kind:'anonymous'} as any,lease),/cannot enter account/);
  const retired=new AccountTimeline(f.db,scope,{assertCurrent(){throw new Error('Retired');},onInvalidate:()=>()=>{}});
  await assert.rejects(retired.rows(),/Retired/);await assert.rejects(retired.accept([entryFixture(events[0])]),/Retired/);
 }finally{await secondDb.close();await f.db.close();}
});

test('remote reads and acknowledgements do not invent device edits; reviewed replacement retains both versions',async()=>{
 const f=setup();
 try {
  const created=await f.sync.things.create({thingtime:['data'],crystal:{name:'Original'}});
  let remote={...created,author:{id:scope.ownerId},acl:['tt:user'],visibility:'private',updatedAt:new Date(Date.now()+1000).toISOString()};
  const transport={get:async()=>structuredClone(remote),write:async()=>structuredClone(remote)};
  await f.sync.sync(transport);await f.sync.remember(remote);assert.equal((await f.history.rows()).length,1);
  await f.sync.things.update({id:created.id,crystal:{name:'Local edit'}});
  remote={...remote,crystal:{name:'Other device'},updatedAt:new Date(Date.now()+2000).toISOString()};
  await f.sync.sync({...transport,write:async()=>{throw {status:409};}});
  const review=await f.sync.inspectConflict(transport,created.id);
  await f.sync.resolveConflict(transport,{id:created.id,keep:'remote',localRevision:review.localRevision,remoteUpdatedAt:remote.updatedAt});
  const versions=await f.store.pending();assert.equal(versions.length,3);
  assert.equal((versions[2].before!.value as any).crystal.name,'Local edit');assert.equal((versions[2].after!.value as any).crystal.name,'Other device');
  assert.deepEqual(versions[2].parentIds,[versions[1].id]);assert.equal(versions[2].mode,'draft');
  assert.equal((await f.sync.status())[0].state,'synced');
 }finally{await f.db.close();}
});
