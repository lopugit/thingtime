import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { draftRequest } from '../drafts/draftClient';
import { rootIdentity } from '../utils/rootIdentity';
import { characterDraftWorkspace } from './characterDrafts.client';
import { bindLocalWorkspace, accountWorkspaceLease, workspaceDatabase } from './runtime.client';
import { workspaceScopeKey } from './storage';

test('Character drafts complete locally in principal/actor/plane partitions and sync independently', async () => {
 const previous = {window:globalThis.window,fetch:globalThis.fetch,indexedDB:globalThis.indexedDB,IDBKeyRange:globalThis.IDBKeyRange};
 const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis,'navigator');
 const events = new EventTarget(), calls: {url:string;init:RequestInit}[] = [];
 const principal = {kind:'account',origin:'https://character-drafts.example',ownerId:'owner',dataPlane:'home'} as const;
 let online = false, failWrites = false;
 const remote = new Map<string,any>();
 Object.assign(globalThis, {indexedDB:new IDBFactory(),IDBKeyRange,window:{location:{origin:principal.origin},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events)},
  fetch:async (url:string,init:RequestInit) => {
   calls.push({url,init});
   if(url.includes('capabilities')) return Response.json({schemaVersion:1,origin:principal.origin,features:{'api.auth-characters':{version:'1.0.0'},'api.drafts':{version:'1.1.0'},'api.mongodb-endpoint':{version:'1.1.0'}}});
   assert.equal(init.redirect,'error'); assert.equal(init.credentials,'same-origin');
   const headers = new Headers(init.headers), actor = headers.get('X-Thingtime-Character');
   assert.ok(actor); assert.equal(headers.get('X-Thingtime-Expected-Actor'),actor);
   assert.equal(headers.get('X-Thingtime-Expected-Data-Plane'),'home');
   if(init.method==='POST') {
    if(failWrites)return Response.json({ok:false,error:'Draft transport unavailable'},{status:503});
    const input = JSON.parse(String(init.body)); assert.equal(input.expectedActor,actor);
    const draft = {...input.content,id:input.id,mode:input.mode,revision:input.revision+1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    remote.set(`${actor}:${input.id}`,draft); return Response.json({ok:true,draft});
   }
   return Response.json({ok:true,drafts:[],nextCursor:null});
  }
 });
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{get onLine(){return online;}}});
 const bind = (scope:any = principal,confirmed=true) => {rootIdentity.confirm(rootIdentity.read().generation);bindLocalWorkspace(false,rootIdentity.read().generation,scope,confirmed);};
 const content = (name:string) => ({name,surface:'post',context:'post:new:',snapshot:JSON.stringify({text:name}),attachmentIds:[]});
 const save = (actor:string,name:string) => draftRequest<any>(actor,{operation:'save',id:'shared-id',writeId:`write-${name.replace(/ /g,"-")}`,revision:0,content:content(name)});
 const read = async (actor:string) => (await draftRequest<any>(actor,undefined,{id:'shared-id'})).draft;
 const poll = async (accept:()=>Promise<boolean>) => {for(let i=0;i<100;i++){if(await accept())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Draft pump did not settle');};
 try {
  bind();
  assert.equal((await save('actor-a','Actor A')).draft.revision,1);
  await save('actor-b','Actor B'); await save('owner','Owner');
  assert.equal((await read('actor-a')).name,'Actor A'); assert.equal((await read('actor-b')).name,'Actor B'); assert.equal((await read('owner')).name,'Owner');
  assert.equal(calls.length,0);
  const first = characterDraftWorkspace(principal,'actor-a');
  assert.notEqual(workspaceScopeKey(first.scope),workspaceScopeKey({...principal,ownerId:'actor-a'}));
  assert.deepEqual(await workspaceDatabase().accountScopes(principal,accountWorkspaceLease(principal)),[principal]);
  assert.deepEqual(await workspaceDatabase().accountScopes(first.scope,first.lease),[first.scope]);
  bind({...principal,ownerId:'other-owner'}); assert.deepEqual((await draftRequest<any>('actor-a')).drafts,[]);
  await save('actor-a','Other owner');
  await assert.rejects(first.client.request(),/workspace changed/i);
  bind({...principal,dataPlane:'other-plane'}); assert.deepEqual((await draftRequest<any>('actor-a')).drafts,[]);
  bind({...principal,ownerId:'actor-a'}); assert.deepEqual((await draftRequest<any>('actor-a')).drafts,[],'independent Character sign-in never adopts a delegated partition');
  bind(principal,false); assert.equal((await read('actor-a')).name,'Actor A');
  online=true; const resumed=characterDraftWorkspace(principal,'actor-a');resumed.wake();
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(calls.length,0,'unconfirmed root has no remote authority');
  bind(); failWrites=true;resumed.wake();
  await poll(async()=>calls.some(call=>call.init?.method==='POST'));
  assert.equal((await read('actor-a')).name,'Actor A','remote failure leaves the saved draft readable');
  // A different Character has an independent pump and is not held by A's retry.
  failWrites=false;const other=characterDraftWorkspace(principal,'actor-b');other.wake();
  await poll(async()=>(await other.drafts.status())[0]?.state==='synced');
  assert.equal(remote.get('actor-b:shared-id')?.snapshot,content('Actor B').snapshot);
  assert.equal(remote.has('actor-a:shared-id'),false);
  rootIdentity.changed();bind();await assert.rejects(resumed.client.request(),/workspace changed/i);
  bindLocalWorkspace(true,rootIdentity.read().generation);
  assert.throws(()=>characterDraftWorkspace(principal,'actor-a'),/workspace changed/i);
  await assert.rejects(draftRequest('actor-a'),/account changed/i);
 } finally {
  bindLocalWorkspace(true,rootIdentity.read().generation);await workspaceDatabase().close();Object.assign(globalThis,previous);
  if(navigatorDescriptor)Object.defineProperty(globalThis,'navigator',navigatorDescriptor);else delete (globalThis as any).navigator;
 }
});
