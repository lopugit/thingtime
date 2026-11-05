import assert from 'node:assert/strict';
import test from 'node:test';
import { accountThemeTransport } from './themeTransport.client';
import { accountAlgorithmTransport } from './algorithmTransport.client';
import { bindLocalWorkspace, accountWorkspaceLease } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { writeCatalogueStream, type CatalogueIdentity } from '../catalogue/catalogueStream';
async function stream(identity:CatalogueIdentity) {
 const chunks:Uint8Array[]=[];
 await writeCatalogueStream({...identity,version:1,generation:'fixture'},(async function*(){yield{id:'id',value:{id:'id'}};})(),async bytes=>{chunks.push(bytes);});
 return new Response(new ReadableStream({start(c){chunks.forEach(chunk=>c.enqueue(chunk));c.close();}}),{headers:{'Content-Type':'application/x-ndjson'}});
}
for(const domain of ['themes','algorithms'] as const) test(`${domain} catalogue is admitted, fenced and completed only after valid EOF`,async()=>{
 const origin=`https://${domain}-catalogue.example`,scope={kind:'account',origin,ownerId:'owner',dataPlane:'home',delegatedBy:'principal'} as const;
 const prior={window:globalThis.window,fetch:globalThis.fetch};let version='1.0.0',character='1.0.0',calls=0,response:Response,after:(()=>void)|undefined;
 const requests:RequestInit[]=[],events:string[]=[];
 Object.assign(globalThis,{window:{location:{origin},dispatchEvent:(e:Event)=>{events.push(e.type);return true;}},fetch:async(url:string,init:RequestInit)=>{
  if(url.includes('capabilities'))return Response.json({schemaVersion:1,origin,features:{[`api.${domain}-sync`]:{version},'api.auth-characters':{version:character},'api.mongodb-endpoint':{version:'1.1.0'}}});
  calls++;requests.push(init);after?.();return response;
 }});
 const bind=(confirmed=true)=>{rootIdentity.confirm(rootIdentity.read().generation);bindLocalWorkspace(false,rootIdentity.read().generation,{...scope,ownerId:scope.delegatedBy,delegatedBy:undefined},confirmed);return(domain==='themes'?accountThemeTransport:accountAlgorithmTransport)(scope,accountWorkspaceLease(scope));};
 let complete=0;const sink={entry:async()=>{},complete:async()=>{complete++;}},signal=()=>new AbortController().signal;
 const identity:CatalogueIdentity={domain,origin,ownerId:'owner',dataPlane:'home',storagePlane:'home'};
 try {
  await assert.rejects(bind(false).catalogue!(sink,signal()),/offline/);assert.equal(calls,0);
  await assert.rejects(bind().catalogue!(sink,signal()),/incompatible/);assert.equal(calls,0);
  version=domain==='themes'?'1.7.0':'1.5.0';character='0.9.0';await assert.rejects(bind().catalogue!(sink,signal()),/incompatible/);assert.equal(calls,0);character='1.0.0';
  response=await stream(identity);assert.equal((await bind().catalogue!(sink,signal())).entries,1);assert.equal(complete,1);
  const init=requests.at(-1)!;assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal((init.headers as any)['X-Thingtime-Character'],'owner');assert.equal((init.headers as any)['X-Thingtime-Expected-Data-Plane'],'home');assert.deepEqual(JSON.parse(String(init.body)),{operation:'catalogue',expectedOwnerId:'owner'});
  for(const changed of [{ownerId:'other'},{dataPlane:'custom-'+ 'a'.repeat(64)},{origin:'https://other.example'},{domain:domain==='themes'?'algorithms':'themes'}]) {
   response=await stream({...identity,...changed} as CatalogueIdentity);await assert.rejects(bind().catalogue!(sink,signal()));assert.equal(complete,1);
  }
  assert.ok(events.includes('thingtime:root-data-refresh'));
  response=new Response('{"type":"start"}\n',{headers:{'Content-Type':'application/x-ndjson'}});await assert.rejects(bind().catalogue!(sink,signal()));assert.equal(complete,1);
  const valid=await stream(identity);response=new Response((await valid.text()).replace('"storagePlane":"home"','"storagePlane":"other"'),{headers:{'Content-Type':'application/x-ndjson'}});await assert.rejects(bind().catalogue!(sink,signal()));assert.equal(complete,1);
  response=await stream(identity);const during=new AbortController();await assert.rejects(bind().catalogue!({...sink,entry:async()=>{during.abort();}},during.signal));assert.equal(complete,1);
  response=new Response('private diagnostic',{status:503});await assert.rejects(bind().catalogue!(sink,signal()),(e:any)=>e.status===503&&!e.message.includes('diagnostic'));
  response=Response.json({code:'DATA_PLANE_CHANGED'},{status:409});await assert.rejects(bind().catalogue!(sink,signal()),/confirmation changed/);
  response=new Response('',{status:429,headers:{'Retry-After':'7'}});await assert.rejects(bind().catalogue!(sink,signal()),(e:any)=>e.status===429&&e.retryAfterMs===7000);
  response=await stream(identity);const c=new AbortController();c.abort();const before=calls;await assert.rejects(bind().catalogue!(sink,c.signal));assert.equal(calls,before);
  response=await stream(identity);const transport=bind();after=()=>bindLocalWorkspace(false,rootIdentity.read().generation,{...scope,ownerId:scope.delegatedBy,delegatedBy:undefined},false);await assert.rejects(transport.catalogue!(sink,signal()));assert.equal(requests.at(-1)!.signal!.aborted,true);assert.equal(complete,1);
 } finally {Object.assign(globalThis,prior);}
});
