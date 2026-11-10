'use strict';
// This is a Node-mode fixture. It never starts Electron's application/UI path,
// uses only synthetic buffers, and runs behind the verified OS network boundary.
const assert=require('node:assert/strict'),http=require('node:http'),{once}=require('node:events');
const root=process.env.TT_RESOURCE_MODULE_ROOT;
const {ResourceGovernor}=require(root+'/lib/folder-resource-governor.cjs');
const {governedFetch,governedHash,governedDownload}=require(root+'/lib/folder-transfer-process.cjs');
(async()=>{
 const server=http.createServer(async(req,res)=>{
  assert.equal(req.headers.cookie,undefined);assert.equal(req.headers.authorization,undefined);
  if(req.method==='GET'){assert.equal(req.headers.range,'bytes=0-511');res.writeHead(206,{'Content-Range':'bytes 0-511/512','Content-Length':'512'});res.end(Buffer.alloc(512,3));return;}
  let size=0;for await(const chunk of req)size+=chunk.length;assert.equal(size,512);res.end();
 });
 server.listen(Number(process.env.TT_RESOURCE_FIXTURE_PORT),'127.0.0.1');await once(server,'listening');
 try{
  const governor=new ResourceGovernor({uploadBytesPerSecond:1024,downloadBytesPerSecond:1024,transferConcurrency:2,cpuPercent:100}),signal=AbortSignal.timeout(10000),url='http://127.0.0.1:'+server.address().port;
  assert.equal((await governedHash(governor,Buffer.from('fixture'),signal)).length,64);
  let start=performance.now();const puts=await Promise.all([1,2].map(()=>governedFetch(governor,globalThis.fetch,url,{signal,headers:{},body:Buffer.alloc(512)})));
  assert.ok(puts.every(x=>x.ok));assert.ok(performance.now()-start>=900);
  const target={url,headers:{Range:'bytes=0-511'},offset:0,length:512,size:512,expiresAt:new Date(Date.now()+60000).toISOString()};
  start=performance.now();const ranges=await Promise.all([1,2].map(()=>governedDownload(governor,target,signal,()=>{})));
  assert.ok(performance.now()-start>=900);for(const range of ranges){assert.equal(range.bytes.length,512);assert.equal(range.sha256,require('node:crypto').createHash('sha256').update(range.bytes).digest('hex'));}
  const cancel=new AbortController(),blocked=governedDownload(governor,target,cancel.signal,()=>{});start=performance.now();setTimeout(()=>cancel.abort(),20);
  await assert.rejects(blocked);assert.ok(performance.now()-start<300);
  assert.equal(governor.snapshot().cpuStatus,'measured');console.log('RESOURCE_TRANSFER_PROCESS_VERIFIED');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(()=>{console.error('RESOURCE_TRANSFER_PROCESS_REFUSED');process.exitCode=1;});
