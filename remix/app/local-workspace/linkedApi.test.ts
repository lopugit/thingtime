import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { anonymousApi } from './api.client';
import { accountApi } from './accountApi.client';
import { accountThingTransport } from './accountTransport.client';
import { bindLocalWorkspace, workspaceDatabase } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';

test('normal anonymous and account Attach by URL is local, editable and removable with zero network requests',async()=>{
 const oldWindow=globalThis.window,oldFactory=globalThis.indexedDB,oldFetch=globalThis.fetch,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 const target=new EventTarget(),origin='https://linked-composer.test';let requests=0;
 const remote=async()=>{requests++;throw Error('Unexpected network');};
 Object.assign(globalThis,{window:{location:{origin},addEventListener:target.addEventListener.bind(target),removeEventListener:target.removeEventListener.bind(target),dispatchEvent:target.dispatchEvent.bind(target)},indexedDB:new IDBFactory(),fetch:remote});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:false}});
 try{
  for(const mode of ['anonymous','account']){
   rootIdentity.changed();const scope={kind:'account',origin,ownerId:'owner',dataPlane:'home'} as const;
   bindLocalWorkspace(mode==='anonymous',rootIdentity.read().generation,mode==='account'?scope:undefined);rootIdentity.confirm(rootIdentity.read().generation);
   const base={attachments:{link:remote,annotate:remote,remove:remote},things:{create:remote,get:remote,export:remote}};
   const api:any=mode==='anonymous'?anonymousApi(base):accountApi(base,{id:'owner'},'home');
   const linked=await api.attachments.link({url:'https://example.invalid/direct.png',mediaKind:'file'});
   assert.match(linked.attachment.id,/^local-link-/);assert.equal(linked.attachment.url,'https://example.invalid/direct.png');
   await api.attachments.annotate({id:linked.attachment.id,title:'Offline title'});
   await api.attachments.remove({id:linked.attachment.id});
   await assert.rejects(api.attachments.annotate({id:linked.attachment.id,title:'Missing'}));
   await assert.rejects(api.attachments.link({url:'https://user:password@example.invalid/private.png'}));
   assert.equal(requests,0);
   rootIdentity.changed();bindLocalWorkspace(true,rootIdentity.read().generation);await assert.rejects(api.attachments.link({url:'https://example.invalid/stale.png'}),/workspace changed/i);
  }
 }finally{bindLocalWorkspace(true,rootIdentity.read().generation);await workspaceDatabase().close();Object.assign(globalThis,{window:oldWindow,indexedDB:oldFactory,fetch:oldFetch});if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete(globalThis as any).navigator;}
});

test('URL registration and durable removal negotiate exact capabilities and pin account authority',async()=>{
 const saved={window:globalThis.window,fetch:globalThis.fetch};
 try{
  for(const [index,linkVersion,deleteVersion] of [[0,'1.0.0','1.8.0'],[1,'1.1.0','1.7.0'],[2,'1.1.0','1.8.0']] as const){
   const origin=`https://linked-transport-${index}.test`,scope={kind:'account',origin,ownerId:'owner',dataPlane:'home'} as const,calls:{url:string;init:RequestInit}[]=[];
   rootIdentity.changed();bindLocalWorkspace(false,rootIdentity.read().generation,scope);rootIdentity.confirm(rootIdentity.read().generation);
   Object.assign(globalThis,{window:{location:{origin},dispatchEvent(){}},fetch:async(url:string,init:RequestInit)=>{
    if(url.includes('capabilities'))return Response.json({schemaVersion:1,origin,features:{'api.attachment-link':{version:linkVersion},'api.attachment-delete':{version:deleteVersion},'api.mongodb-endpoint':{version:'1.1.0'}}});
    calls.push({url,init});return Response.json({ok:true,attachment:{id:'receipt'},updatedAt:'2026-10-23T00:00:00Z',deleted:true,deferred:false});
   }});
   const transport=accountThingTransport(scope,{assertCurrent(){},onInvalidate:()=>()=>{}}).files,signal=new AbortController().signal;
   const link={requestId:'stable-request',url:'https://example.invalid/link.png',purpose:'post' as const,mediaKind:'file' as const};
   if(index===0){await assert.rejects(transport.link!(link,signal),/incompatible/);assert.equal(calls.length,0);continue;}
   await transport.link!(link,signal);assert.equal(calls[0].url,'/api/v1/attachments/link');assert.deepEqual(JSON.parse(calls[0].init.body as string),link);
   const deletion={id:'receipt',requestId:'stable-request',targetId:'post',expectedUpdatedAt:'2026-10-23T00:00:00Z',linked:true as const};
   if(index===1){await assert.rejects(transport.remove!(deletion,signal),/incompatible/);assert.equal(calls.length,1);continue;}
   await transport.remove!(deletion,signal);const {linked:_,...body}=deletion;assert.deepEqual(JSON.parse(calls[1].init.body as string),body);
   for(const call of calls){const headers=new Headers(call.init.headers);assert.equal(headers.get('X-Thingtime-Expected-Actor'),'owner');assert.equal(headers.get('X-Thingtime-Expected-Data-Plane'),'home');assert.equal(call.init.credentials,'same-origin');assert.equal(call.init.redirect,'error');}
  }
 }finally{bindLocalWorkspace(true,rootIdentity.read().generation);Object.assign(globalThis,saved);}
});
