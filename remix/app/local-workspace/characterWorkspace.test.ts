import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { useApi } from '../hooks/useApi';
import { useWorkspaceUser } from '../hooks/useWorkspaceUser';
import { CharacterScope } from '../components/Characters/CharacterScope';
import { accountWorkspaceWorker } from './accountApi.client';
import { characterDraftWorkspace } from './characterDrafts.client';
import { bindLocalWorkspace, workspaceDatabase } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { accountTimelineScope, AccountTimeline } from './accountTimeline';
import { enqueueActionOutcomeRecovery, localTimelineBackend } from '../timeline/localBackend.client';
import { TimelineLocalStore } from '../timeline/localStore';
import { actionOutcomeFixture } from '../timeline/testFixtures';

test('the real Character API hook saves posts, files, editable Things and History offline in one retired principal/actor worker', async () => {
 const previous={window:globalThis.window,fetch:globalThis.fetch,indexedDB:globalThis.indexedDB,IDBKeyRange:globalThis.IDBKeyRange};
 const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'), events=new EventTarget(), factory=new IDBFactory();
 const principal={kind:'account' as const,origin:'https://character-workspace.example',ownerId:'principal',dataPlane:'home'};
 const actor={id:'actor',username:'actor',displayName:'Offline Character',isCharacter:true};
 const scope={...principal,ownerId:actor.id,delegatedBy:principal.ownerId};
 const routers:ReturnType<typeof createMemoryRouter>[]=[];let calls=0;
 Object.assign(globalThis,{indexedDB:factory,IDBKeyRange,window:{indexedDB:factory,location:{origin:principal.origin},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events)},fetch:async()=>{calls++;throw Error('Offline content must not send HTTP');}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:false}});
 const bind=(ownerId=principal.ownerId)=>{rootIdentity.confirm(rootIdentity.read().generation);bindLocalWorkspace(false,rootIdentity.read().generation,{...principal,ownerId},false);};
 const apiFor=(ownerId=principal.ownerId, inherited:typeof actor | null=actor, selected:typeof actor | null | undefined=undefined)=>{
  let api:any;
  function Probe(){api=useApi(undefined,selected as any).v1;return null;}
  const router=createMemoryRouter([{id:'root',path:'/',element:React.createElement(CharacterScope.Provider,{value:inherited as any},React.createElement(Probe))}],{hydrationData:{loaderData:{root:{user:null,dataPlane:'home',offlineWorkspace:{ownerId,dataPlane:'home'}}}}});
  routers.push(router);renderToString(React.createElement(RouterProvider,{router}));return api;
 };
 try {
  bind();const api=apiFor(), worker=accountWorkspaceWorker(scope), drafts=characterDraftWorkspace(principal,actor.id);
  assert.equal(drafts.files,worker.files);assert.equal(drafts.draftClient,worker.draftClient);
  const file=await api.attachments.saveLocalFile({requestId:crypto.randomUUID(),name:'note.txt',contentType:'text/plain',bytes:new Blob(['Character attachment']),purpose:'post'});
  const post=await api.things.create({type:'text',text:'Saved without a login refresh',visibility:'private',attachmentIds:[file.attachment.id]});
  assert.equal(post.savedLocally,true);assert.equal(post.post.author.id,actor.id);
  assert.deepEqual(post.post.acl,['tt:user']);assert.equal(post.post.attachments[0].id,file.attachment.id);
  assert.equal((await api.things.get({id:post.id})).post.text,'Saved without a login refresh');
  const selectedFromPrincipal=apiFor(principal.ownerId,null,actor);
  const reply=await selectedFromPrincipal.things.comment({id:post.id,text:'An explicit Character reply',characterId:actor.id});
  assert.equal(reply.savedLocally,true);assert.equal(reply.comment.author.id,actor.id);
  assert.equal((await api.things.get({id:reply.id})).post.text,'An explicit Character reply');
  const principalFromActor=apiFor(principal.ownerId,actor,null);
  const own=await principalFromActor.things.create({type:'text',text:'Principal content stays separate',visibility:'private'});
  assert.equal(own.post.author.id,principal.ownerId);
  await assert.rejects(principalFromActor.things.comment({id:post.id,text:'Cannot borrow another partition'}),/not saved on this device/i);
  const thing=await api.things.create({thingtime:['data'],crystal:{name:'Editable Character content',value:1}});
  await api.things.update({id:thing.id,crystal:{name:'Editable Character content',value:2}});
  const historyScope=accountTimelineScope(scope), history=new AccountTimeline(worker.db,scope,worker.lease);
  const versions=await history.rows({thingId:thing.id});assert.equal(versions.length,2);
  assert.equal(api.timeline.canExportLocally(historyScope),true);
  assert.equal(api.timeline.canExportLocally({...historyScope,delegatedBy:undefined}),false);
  const exported=await api.timeline.exportVersion(historyScope,versions[1].event.id);
  assert.equal(exported.export.event.ownerId,actor.id);assert.equal('delegatedBy' in exported.export.event,false);
  assert.ok((await accountWorkspaceWorker(principal).sync.things.snapshot()).every(row=>row.id!==post.id && row.id!==reply.id),'no actor content enters the principal workspace');
  await workspaceDatabase().close();
  const reopened=apiFor();assert.equal((await reopened.things.get({id:post.id})).post.author.id,actor.id);
  const bytes=await reopened.attachments.readLocalFile({id:file.attachment.id},{format:'blob'});assert.equal(await bytes.blob.text(),'Character attachment');
  bind('another-principal');await assert.rejects(api.things.get({id:post.id}),/workspace changed/i);
  await assert.rejects(selectedFromPrincipal.things.comment({id:post.id,text:'Retired selection'}),/workspace changed/i);
  const foreign=apiFor('another-principal');assert.equal((await foreign.things.list({device:true})).things.length,0);
  await assert.rejects(foreign.things.get({id:post.id}),/offline|confirm/i);
  bindLocalWorkspace(true,rootIdentity.read().generation);
  let anonymous:any;
  function AnonymousProbe(){anonymous=useApi(undefined,useWorkspaceUser()).v1;return null;}
  const guestRouter=createMemoryRouter([{id:'root',path:'/',element:React.createElement(AnonymousProbe)}],{hydrationData:{loaderData:{root:{user:null}}}});
  routers.push(guestRouter);renderToString(React.createElement(RouterProvider,{router:guestRouter}));
  const guestPost=await anonymous.things.create({type:'text',text:'Anonymous local post'});
  const guestReply=await anonymous.things.comment({id:guestPost.id,text:'Anonymous quick reply',characterId:guestPost.post.author.id});
  assert.equal(guestReply.comment.author.localOnly,true);
  assert.equal((await anonymous.things.get({id:guestReply.id})).post.text,'Anonymous quick reply');
  assert.equal(calls,0);
 } finally {
  routers.forEach(router=>router.dispose());bindLocalWorkspace(true,rootIdentity.read().generation);await workspaceDatabase().close();Object.assign(globalThis,previous);
  if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete (globalThis as any).navigator;
 }
});

test('late Action receipts retain their originating principal without entering a direct Character login cache', async () => {
 const previous=globalThis.window, events=new EventTarget();
 Object.assign(globalThis,{window:{indexedDB:new IDBFactory(),dispatchEvent:events.dispatchEvent.bind(events)}});
 const event=actionOutcomeFixture(),scope={apiOrigin:'https://character-recovery.example',ownerId:event.ownerId,dataPlane:'home'};
 try {
  await enqueueActionOutcomeRecovery(scope.apiOrigin,{formatVersion:1,event,dataPlane:'home',proof:'header.payload.signature'},'original-principal');
  assert.deepEqual(await new TimelineLocalStore({...scope,delegatedBy:'original-principal'},localTimelineBackend()).pending(),[event]);
  assert.deepEqual(await new TimelineLocalStore({...scope,delegatedBy:'next-principal'},localTimelineBackend()).pending(),[]);
  assert.deepEqual(await new TimelineLocalStore(scope,localTimelineBackend()).pending(),[]);
 } finally {await localTimelineBackend().close();globalThis.window=previous;}
});
