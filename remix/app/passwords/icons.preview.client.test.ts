import test from 'node:test';
import assert from 'node:assert/strict';
import { openPasswordPreviewIcon,clearPasswordPreviewIcons,passwordPreviewThumbnail } from './icons.client';
import { passwordRequest } from './client';

test('automatic preview negotiates separately; shared jobs/cache stay owner/origin/revision scoped and cancelled consumers do not cancel peers',{timeout:10000},async t=>{
 const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),previousLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
 const location={origin:'https://preview-icons.test'};
 Object.defineProperty(globalThis,'window',{configurable:true,value:{location}});Object.defineProperty(globalThis,'location',{configurable:true,value:location});
 t.after(()=>{clearPasswordPreviewIcons('owner');clearPasswordPreviewIcons('other');if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else Reflect.deleteProperty(globalThis,'window');if(previousLocation)Object.defineProperty(globalThis,'location',previousLocation);else Reflect.deleteProperty(globalThis,'location');});
 let version='1.5.0',posts=0,release:(()=>void)|null=null,wrongOwner=false;
 t.mock.method(globalThis,'fetch',async(input,init)=>{
  const url=String(input);
  if(!url.startsWith('/api/v1/passwords'))return Response.json({schemaVersion:1,origin:location.origin,features:{'api.passwords':{version}}});
  if(init?.method!=='POST')return Response.json({ok:true,ownerId:'owner',entries:[]});
  posts++;const body=JSON.parse(String(init.body));assert.deepEqual(Object.keys(body).sort(),['expectedOwnerId','id','operation','revision']);assert.equal(body.operation,'website-icon');assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
  if(release===null)await new Promise<void>(resolve=>release=resolve);
  return new Response('PNG-fixture',{headers:{'Content-Type':'image/png','X-Thingtime-Owner-Id':wrongOwner?'foreign':body.expectedOwnerId}});
 });
 const entry={id:'entry',revision:1,websiteIcon:true};
 await assert.rejects(openPasswordPreviewIcon('owner',entry,new AbortController().signal),/incompatible/);assert.equal(posts,0);
 await passwordRequest('owner'); // Existing flows still work against api.passwords1.5.
 version='1.6.0';await assert.rejects(openPasswordPreviewIcon('owner',entry,new AbortController().signal),/incompatible/);
 const first=new AbortController(),second=new AbortController();
 const a=openPasswordPreviewIcon('owner',entry,first.signal),b=openPasswordPreviewIcon('owner',entry,second.signal);
 const deadline=Date.now()+5000;while(!release&&Date.now()<deadline)await new Promise(resolve=>setImmediate(resolve));assert.ok(release,'First supported icon request started');first.abort();await assert.rejects(a,{name:'AbortError'});release!();
 assert.equal(await(await b)!.text(),'PNG-fixture');assert.equal(posts,1);
 assert.equal(await(await openPasswordPreviewIcon('owner',entry,new AbortController().signal))!.text(),'PNG-fixture');assert.equal(posts,1);
 await openPasswordPreviewIcon('other',entry,new AbortController().signal);assert.equal(posts,2);
 await openPasswordPreviewIcon('owner',{...entry,revision:2},new AbortController().signal);assert.equal(posts,3);
 clearPasswordPreviewIcons('owner');await openPasswordPreviewIcon('owner',entry,new AbortController().signal);assert.equal(posts,4);
 wrongOwner=true;await assert.rejects(openPasswordPreviewIcon('owner',{...entry,revision:3},new AbortController().signal),/account changed/);
});

test('preview network work is bounded and an aborted queued request never dispatches', {timeout:10000},async t=>{
 const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),oldLocation=Object.getOwnPropertyDescriptor(globalThis,'location'),location={origin:'https://preview-queue.test'};
 Object.defineProperty(globalThis,'window',{configurable:true,value:{location}});Object.defineProperty(globalThis,'location',{configurable:true,value:location});
 t.after(()=>{clearPasswordPreviewIcons('queue');if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else Reflect.deleteProperty(globalThis,'window');if(oldLocation)Object.defineProperty(globalThis,'location',oldLocation);else Reflect.deleteProperty(globalThis,'location');});
 const releases:(()=>void)[]=[];let requests=0;
 t.mock.method(globalThis,'fetch',async(input)=>{
  if(!String(input).startsWith('/api/v1/passwords'))return Response.json({schemaVersion:1,origin:location.origin,features:{'api.passwords':{version:'1.6.0'}}});
  requests++;await new Promise<void>(resolve=>releases.push(resolve));return new Response(null,{status:204,headers:{'X-Thingtime-Owner-Id':'queue'}});
 });
 const controllers=Array.from({length:5},()=>new AbortController()),tasks=controllers.map((controller,index)=>openPasswordPreviewIcon('queue',{id:`item-${index}`,revision:1,websiteIcon:true},controller.signal));
 const deadline=Date.now()+5000;while(releases.length<4&&Date.now()<deadline)await new Promise(resolve=>setImmediate(resolve));assert.equal(releases.length,4);assert.equal(requests,4);
 controllers[4].abort();await assert.rejects(tasks[4],{name:'AbortError'});releases.forEach(release=>release());await Promise.all(tasks.slice(0,4));assert.equal(requests,4);
});

test('thumbnail conversion rejects unknown signatures and closes a decoded image after cancellation',async t=>{
 const source=Uint8Array.from([137,80,78,71,13,10,26,10]);
 let finish!:(image:ImageBitmap)=>void,closed=0,called=0;
 const previous=Object.getOwnPropertyDescriptor(globalThis,'createImageBitmap');
 Object.defineProperty(globalThis,'createImageBitmap',{configurable:true,value:async()=>{called++;return new Promise<ImageBitmap>(resolve=>finish=resolve);}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'createImageBitmap',previous);else Reflect.deleteProperty(globalThis,'createImageBitmap');});
 await assert.rejects(passwordPreviewThumbnail(new Blob(['<svg/>'],{type:'image/png'}),new AbortController().signal),/Invalid raster/);assert.equal(called,0);
 const controller=new AbortController(),pending=passwordPreviewThumbnail(new Blob([source],{type:'image/png'}),controller.signal);
 while(!finish)await new Promise(resolve=>setImmediate(resolve));controller.abort();finish({width:1,height:1,close:()=>closed++} as ImageBitmap);
 await assert.rejects(pending,{name:'AbortError'});assert.equal(closed,1);
});
