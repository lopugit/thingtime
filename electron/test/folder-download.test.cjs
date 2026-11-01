'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { createServer } = require('node:http'), { once } = require('node:events');
const { ResourceGovernor } = require('../lib/folder-resource-governor.cjs');
const { governedDownload } = require('../lib/folder-transfer-process.cjs');
const { stageFolderDownload } = require('../lib/folder-download.cjs');
const fingerprint = { algorithm:'sha256-parts-v1',partSizeBytes:8388608,partCount:1,sha256:'a'.repeat(64) };
function fixture() {
    const context={ownerId:'owner',apiOrigin:'http://127.0.0.1:28735',appOrigin:'http://127.0.0.1:28735'};
    const cloudFile={id:'file',revision:'revision',name:'file.bin',folderId:null,trashed:false,content:{attachmentId:'attachment',version:'b'.repeat(64),size:4,fingerprint}};
    const scope={ownerId:'owner',origin:context.apiOrigin,deviceId:'device',dataPlane:'home',rootId:'connection'};
    const transfer={scope,rootId:'root',operation:{id:'operation',mutation:{kind:'copy',from:'remote',path:'file.bin',source:{kind:'file',id:'file',version:'revision',size:4,fingerprint,path:'file.bin'}}}};
    const target={version:1,ownerId:'owner',attachmentId:'attachment',contentVersion:cloudFile.content.version,size:4,offset:0,length:4,fingerprint,url:context.apiOrigin+'/storage',expiresAt:new Date(Date.now()+60000).toISOString(),headers:{Range:'bytes=0-3'}};
    const input={requestId:'request',ownerId:'owner',deviceId:'device',rootId:'root',transfer,cloudFile,target,offset:0,length:4,resourceScope:'connection',resourceLimits:{cpuPercent:10,downloadBytesPerSecond:1024}};
    return {context,input,cloudFile};
}
function options(f) {
    const calls=[]; let authority=true;
    return { calls, revoke:()=>{authority=false;}, value:{...f,signal:new AbortController().signal,authorize:async()=>{if(!authority)throw Error('revoked');},assertCurrent:()=>{},
        json:async path=>path.startsWith('/api/v1/attachments/content?')?({ok:true,target:f.input.target}):({ok:true,file:f.cloudFile}), download:async()=>({bytes:Buffer.alloc(4,7),sha256:'c'.repeat(64)}),
        requestNative:async request=>{calls.push(request);return {...request,roots:[],staging:{received:request.action==='stage-begin'?0:4}};} } };
}
test('signed cloud range stays host-to-native and preserves canonical staging identity',async()=>{
 const f=fixture(),o=options(f);const result=await stageFolderDownload(o.value);
 assert.equal(result.staging.received,4);assert.deepEqual(o.calls.map(x=>x.action),['stage-begin','stage-range']);
 assert.equal(o.calls[1].transfer.operation.id,'operation');assert.equal(o.calls[1].resourceScope,'connection');assert.ok(o.calls[1].bytes.every(x=>x===0),'transient bytes not cleared');
});
test('target fields, source changes, expired grants and malformed ranges fail before staging writes',async()=>{
 for(const mutate of [f=>f.input.target.ownerId='other',f=>f.input.target.offset=1,f=>f.input.target.fingerprint={...fingerprint,sha256:'d'.repeat(64)},f=>f.input.target.url='https://user:password@invalid.test',f=>f.input.target.expiresAt=new Date(0).toISOString(),f=>f.input.target.expiresAt=new Date(Date.now()+61000).toISOString(),f=>f.input.target.headers.Authorization='forbidden']){
  const f=fixture();mutate(f);const o=options(f);await assert.rejects(stageFolderDownload(o.value));assert.equal(o.calls.some(x=>x.action==='stage-range'),false);
 }
 const f=fixture(),o=options(f);o.value.download=async()=>{o.revoke();return{bytes:Buffer.alloc(4),sha256:'c'.repeat(64)}};
 await assert.rejects(stageFolderDownload(o.value));assert.equal(o.calls.length,1);
});
test('renderer hints cannot select the signed storage destination',async()=>{
 const f=fixture(),o=options(f),trusted=structuredClone(f.input.target);
 f.input.target.url='https://renderer-controlled.invalid/forged';
 o.value.json=async path=>path.startsWith('/api/v1/attachments/content?')?{ok:true,target:trusted}:{ok:true,file:f.cloudFile};
 let used;o.value.download=async(_governor,target)=>{used=target.url;return{bytes:Buffer.alloc(4),sha256:'c'.repeat(64)}};
 await stageFolderDownload(o.value);assert.equal(used,trusted.url);assert.notEqual(used,f.input.target.url);
});
test('original accepted range receipt is replayed before source or target IO',async()=>{
 const f=fixture(),o=options(f);o.value.requestNative=async request=>({...request,roots:[],staging:{received:4}});
 o.value.json=async()=>{throw Error('must not read changed source');};o.value.download=async()=>{throw Error('must not resend');};
 assert.equal((await stageFolderDownload(o.value)).staging.received,4);
});
test('task-owned child GET validates signed Range, length and digest and paces concurrent downloads',async()=>{
 let requests=0;const server=createServer((request,response)=>{requests++;assert.equal(request.headers.cookie,undefined);assert.equal(request.headers.authorization,undefined);assert.equal(request.headers.range,'bytes=0-511');response.writeHead(206,{'Content-Range':'bytes 0-511/512','Content-Length':'512'});response.end(Buffer.alloc(512,3));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
 const target={url:'http://127.0.0.1:'+server.address().port,headers:{Range:'bytes=0-511'},offset:0,length:512,size:512,expiresAt:new Date(Date.now()+60000).toISOString()};
 const governor=new ResourceGovernor({downloadBytesPerSecond:1024,transferConcurrency:2,cpuPercent:100}),signal=AbortSignal.timeout(5000),start=performance.now();
 const results=await Promise.all([1,2].map(()=>governedDownload(governor,target,signal,()=>{})));
 assert.equal(requests,2);assert.ok(performance.now()-start>=900);assert.ok(results.every(x=>x.bytes.length===512&&x.sha256===require('node:crypto').createHash('sha256').update(x.bytes).digest('hex')));assert.equal(governor.snapshot().cpuStatus,'measured');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('child rejects redirects, encoded ranges, wrong ranges and truncated or oversized payloads',async()=>{
 const server=createServer((request,response)=>{
  if(request.url==='/redirect'){response.writeHead(302,{Location:'/ok'});response.end();return;}
  const headers={'Content-Range':request.url==='/wrong-range'?'bytes 1-4/5':'bytes 0-3/4'};
  if(request.url==='/encoded')headers['Content-Encoding']='gzip';
  response.writeHead(206,headers);response.write(Buffer.alloc(request.url==='/short'?3:request.url==='/long'?5:4));response.end();
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const governor=new ResourceGovernor({cpuPercent:100}),signal=AbortSignal.timeout(5000);
  for(const kind of ['redirect','encoded','wrong-range','short','long'])await assert.rejects(governedDownload(governor,{url:'http://127.0.0.1:'+server.address().port+'/'+kind,headers:{Range:'bytes=0-3'},offset:0,length:4,size:4,expiresAt:new Date(Date.now()+60000).toISOString()},signal,()=>{}));
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
