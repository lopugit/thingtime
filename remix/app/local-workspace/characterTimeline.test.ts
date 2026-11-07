import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { randomUUID } from 'node:crypto';
import { timelineScopeKey, parseTimelineEvent } from '../timeline/contract';
import { IndexedDbTimelineBackend } from '../timeline/indexedDb';
import { TimelineLocalStore } from '../timeline/localStore';
import { TimelineNoteStore } from '../timeline/noteStore';
import { TimelineBranchStore } from '../timeline/branchStore';
import { TimelineNameQueue } from '../timeline/nameQueue';
import { eventFixture, entryFixture } from '../timeline/testFixtures';
import { timelineConnectionForViewer } from '../timeline/connectionPool';
import { AccountTimeline, AccountTimelineStore, accountTimelineScope } from './accountTimeline';
import { AccountThingSync } from './accountSync';
import { WorkspaceDatabase, type WorkspaceScope } from './storage';
import { rootIdentity } from '../utils/rootIdentity';
import { bindLocalWorkspace, workspaceDatabase } from './runtime.client';
import { scopedTimelineStore, localTimelineBackend } from '../timeline/localBackend.client';

const scope = {kind:'account',origin:'https://character-history.example',ownerId:'actor',dataPlane:'home',delegatedBy:'principal'} as const;
const lease = {assertCurrent(){},onInvalidate:()=>()=>{}};

test('Character History caches and every command queue survive reopen without sharing a principal or direct sign-in partition', async () => {
 const factory = new IDBFactory();
 let backend = new IndexedDbTimelineBackend(factory);
 const timeline = accountTimelineScope(scope), key = timelineScopeKey(timeline);
 const event = eventFixture('same-event',{ownerId:scope.ownerId,actorId:scope.ownerId});
 const notes = new TimelineNoteStore(timeline,backend), branches = new TimelineBranchStore(timeline,backend), names = new TimelineNameQueue(timeline,backend);
 const note = {command:'add-note' as const,operationId:randomUUID(),eventId:event.id,thingId:event.thingId,text:'Principal A only'};
 const branch = {command:'create-branch' as const,operationId:randomUUID(),branchId:`branch-${randomUUID()}`,thingId:event.thingId,eventId:event.id,expectedRevision:0,name:'Private draft'};
 const name = {command:'name-version' as const,operationId:randomUUID(),eventId:event.id,thingId:event.thingId,name:'Device version',expectedRevision:0};
 try {
  await new TimelineLocalStore(timeline,backend).enqueue(event);
  await notes.enqueue(note);await branches.enqueue(branch);await names.enqueue(name,event);
  await backend.close();backend=new IndexedDbTimelineBackend(factory);
  assert.deepEqual(await new TimelineLocalStore(timeline,backend).pending(),[event]);
  assert.deepEqual(await new TimelineNoteStore(timeline,backend).pending(),[note]);
  assert.deepEqual(await new TimelineBranchStore(timeline,backend).pending(),[branch]);
  assert.equal((await new TimelineNameQueue(timeline,backend).queued())[0].command.operationId,name.operationId);
  for (const other of [{...timeline,delegatedBy:undefined},{...timeline,delegatedBy:'other-principal'},{...timeline,ownerId:'other-actor'},{...timeline,dataPlane:'other-plane'},{...timeline,apiOrigin:'https://other.example'}]) {
   assert.notEqual(timelineScopeKey(other),key);
   assert.deepEqual(await new TimelineLocalStore(other,backend).pending(),[]);
   assert.deepEqual(await new TimelineNoteStore(other,backend).pending(),[]);
   assert.deepEqual(await new TimelineBranchStore(other,backend).pending(),[]);
   assert.deepEqual(await new TimelineNameQueue(other,backend).queued(),[]);
  }
  // A direct Character login can retain the same remote event independently.
  const direct = {...timeline,delegatedBy:undefined};
  await new TimelineLocalStore(direct,backend).accept([entryFixture(event)]);
  assert.equal((await new TimelineLocalStore(timeline,backend).pending()).length,1);
  await new TimelineLocalStore(direct,backend).prune(0,0);
  assert.equal((await new TimelineLocalStore(timeline,backend).forThing(event.thingId)).length,1);
  assert.deepEqual(parseTimelineEvent(JSON.parse(JSON.stringify(event))),event);
  assert.throws(()=>parseTimelineEvent({...event,delegatedBy:scope.delegatedBy}),/Unknown|Invalid|Unexpected/i);
 } finally {await backend.close();}
});

test('existing authored Character versions rekey within their proven workspace without adopting an ambiguous shared cache', async () => {
 const factory = new IDBFactory(), db = new WorkspaceDatabase(factory,undefined,undefined,IDBKeyRange), backend = new IndexedDbTimelineBackend(factory);
 const sync = new AccountThingSync(db,scope,lease), history = new AccountTimeline(db,scope,lease);
 const timeline = accountTimelineScope(scope), legacy = {...timeline,delegatedBy:undefined};
 try {
  const thing = await sync.things.create({thingtime:['data'],crystal:{name:'Saved offline'}});
  const original = (await history.rows())[0].event;
  await db.transaction(scope,'readwrite',lease,async tx=>{
   for(const collection of ['timeline-events','timeline-index'])for(const {id,value} of await tx.list<any>(collection))await tx.put(collection,id,{...value,scope:timelineScopeKey(legacy)});
  });
  await new TimelineLocalStore(legacy,backend).enqueue(eventFixture('ambiguous-cache',{ownerId:scope.ownerId,actorId:scope.ownerId}));
  const store = new AccountTimelineStore(timeline,backend,history);
  assert.deepEqual(await store.pending(),[original]);
  assert.deepEqual((await store.forThing(thing.id)).map(row=>row.scope),[timelineScopeKey(timeline)]);
  await sync.things.update({id:thing.id,crystal:{name:'Edited offline'}});
  const rows = await history.rows();assert.equal(rows.length,2);
  assert.ok(rows.every(row=>row.scope===timelineScopeKey(timeline)));
  assert.deepEqual(rows.find(row=>row.event.id!==original.id)?.event.parentIds,[original.id]);
  await store.accept([entryFixture(original)]);
  assert.equal((await new TimelineLocalStore(legacy,backend).pending())[0].id,'ambiguous-cache');
  const another = {...scope,delegatedBy:'other-principal'};
  assert.deepEqual(await new AccountTimeline(db,another,lease).rows(),[]);
  await db.transaction(scope,'readwrite',lease,async tx=>{
   const row=await tx.get<any>('timeline-events',original.id);
   await tx.put('timeline-events',original.id,{...row,scope:timelineScopeKey({...timeline,delegatedBy:'other-principal'})});
  });
  await assert.rejects(history.entries([original.id]),/damaged|scope/i);
 } finally {await db.close();await backend.close();}
});

test('History viewer identity includes the principal and direct-account keys remain compatible', () => {
 const direct = {ownerId:'actor',apiOrigin:scope.origin,dataPlane:scope.dataPlane};
 assert.equal(timelineScopeKey(direct),JSON.stringify([scope.origin,scope.dataPlane,'actor']));
 const connection = {scope:accountTimelineScope(scope)};
 assert.equal(timelineConnectionForViewer(connection,'actor','home'),null);
 assert.equal(timelineConnectionForViewer(connection,'actor','home','other-principal'),null);
 assert.equal(timelineConnectionForViewer(connection,'actor','home','principal'),connection);
 for(const delegatedBy of ['', 'actor', null, 3])assert.throws(()=>timelineScopeKey({...direct,delegatedBy} as any));
});

test('the browser store rejects foreign principals and retires retained readers on account and plane changes', async () => {
 const previous={window:globalThis.window,indexedDB:globalThis.indexedDB,IDBKeyRange:globalThis.IDBKeyRange};
 const factory=new IDBFactory();Object.assign(globalThis,{indexedDB:factory,IDBKeyRange,window:{indexedDB:factory}});
 const principal:Extract<WorkspaceScope,{kind:'account'}>={kind:'account',origin:scope.origin,ownerId:scope.delegatedBy,dataPlane:'custom'};
 const bind=(value=principal)=>{rootIdentity.confirm(rootIdentity.read().generation);bindLocalWorkspace(false,rootIdentity.read().generation,value,false);};
 try {
  bind();const timeline=accountTimelineScope({...scope,dataPlane:'custom'}),store=scopedTimelineStore(timeline);
  await store.enqueue(eventFixture('scoped',{ownerId:scope.ownerId,actorId:scope.ownerId}));
  assert.equal((await store.pending()).length,1);
  const home=scopedTimelineStore(accountTimelineScope(scope));assert.deepEqual(await home.pending(),[]);
  assert.throws(()=>scopedTimelineStore({...timeline,delegatedBy:'foreign'}),/another account/);
  assert.throws(()=>scopedTimelineStore({...timeline,dataPlane:'other'}),/database/);
  assert.throws(()=>scopedTimelineStore({...timeline,apiOrigin:'https://other.example'}),/another account/);
  bind({...principal,ownerId:'other-principal'});await assert.rejects(store.pending(),/workspace changed/i);
  bind();assert.equal((await scopedTimelineStore(timeline).pending()).length,1);
  rootIdentity.changed();bind();await assert.rejects(home.pending(),/workspace changed/i);
  bindLocalWorkspace(true,rootIdentity.read().generation);
  assert.throws(()=>scopedTimelineStore(timeline),/another account/);
 } finally {
  bindLocalWorkspace(true,rootIdentity.read().generation);await workspaceDatabase().close();await localTimelineBackend().close();Object.assign(globalThis,previous);
 }
});
