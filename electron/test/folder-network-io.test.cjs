'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createServer}=require('node:http'),{once}=require('node:events');
const {networkWait,put}=require('../lib/folder-network-io.cjs');
const {ResourceGovernor}=require('../lib/folder-resource-governor.cjs');
test('network idle watchdog remains bounded and cancels actual stalled IO',async()=>{
 let closed=false;
 await assert.rejects(networkWait(new Promise(()=>{}),new AbortController().signal,()=>{closed=true;},10),{name:'TimeoutError',code:'ETIMEDOUT'});
 assert.equal(closed,true);
 const cancel=new AbortController(),pending=networkWait(new Promise(()=>{}),cancel.signal,()=>{},1000);cancel.abort();await assert.rejects(pending,{name:'AbortError'});
});
test('a valid slow PUT can exceed network idle time while intentional pacing is excluded',async()=>{
 let received=0;const server=createServer(async(request,response)=>{for await(const part of request)received+=part.length;response.end();});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
 const governor=new ResourceGovernor({uploadBytesPerSecond:312.5}),signal=AbortSignal.timeout(3000),start=performance.now();
 const response=await put('http://127.0.0.1:'+server.address().port,{},governor.body(Buffer.alloc(100),signal),100,signal,()=>{},150);
 assert.equal(response.status,200);assert.equal(received,100);assert.ok(performance.now()-start>=300);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
