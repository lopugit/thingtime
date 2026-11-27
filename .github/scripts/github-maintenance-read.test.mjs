import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createGithubMaintenanceRead } from './github-maintenance-read.mjs';
const repository='example/private', path=`/repos/${repository}/git/ref/heads/main`, secret='synthetic-secret-sentinel';
const json=(status,value,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
function fixture(sequence,extra={}) {
 let calls=0,clock=1700000000000;const sleeps=[],seen=[];
 const read=createGithubMaintenanceRead({repository,token:secret,now:()=>clock,wait:async ms=>{sleeps.push(ms);clock+=ms;},fetcher:async(url,init)=>{seen.push({url,init});const value=sequence[Math.min(calls++,sequence.length-1)];if(value instanceof Error)throw value;return typeof value==='function'?value():value;},...extra});
 return {read,sleeps,seen,get calls(){return calls;},advance:ms=>{clock+=ms;}};
}
test('explicit primary quota response honors reset before one successful GET retry',async()=>{
 const f=fixture([json(403,{message:'API rate limit exceeded for installation'},{'x-ratelimit-remaining':'0','x-ratelimit-reset':'1700000002'}),json(200,{object:{sha:'a'.repeat(40)}})]);
 assert.equal((await f.read(path)).object.sha,'a'.repeat(40));assert.deepEqual(f.sleeps,[3000]);assert.equal(f.calls,2);assert.equal(f.seen[0].init.method,'GET');assert.equal(f.seen[0].init.redirect,'manual');
});
test('Retry-After seconds and HTTP-date are respected; waits beyond budget fail without early retry',async()=>{
 for(const header of ['2',new Date(1700000002000).toUTCString()]){const f=fixture([json(429,{message:secret},{'retry-after':header}),json(200,{ok:true})]);await f.read(path);assert.deepEqual(f.sleeps,[2000]);}
 const f=fixture([json(403,{message:'secondary rate limit'},{'retry-after':'121'})]);await assert.rejects(f.read(path),/secondary-rate-limit.*wait-exceeds-budget/);assert.equal(f.calls,1);assert.deepEqual(f.sleeps,[]);
});
test('ordinary permission 403 fails immediately and diagnostics exclude raw provider text, token and path',async()=>{
 const f=fixture([json(403,{message:`Resource not accessible by integration ${secret}`,url:`https://attacker/${secret}`},{'retry-after':'2'})]);
 await assert.rejects(f.read(path),e=>{assert.match(e.message,/endpoint=main-ref status=403 code=permission-denied/);assert.ok(!JSON.stringify(e.diagnostic).includes(secret));assert.ok(!e.message.includes(secret));assert.ok(!e.message.includes(repository));return true;});assert.equal(f.calls,1);assert.deepEqual(f.sleeps,[]);
});
test('transient service/network errors have finite retries; raw exception text is redacted',async()=>{
 const f=fixture([json(502,{message:secret}),new Error(secret),json(200,{ok:true})]);assert.equal((await f.read(path)).ok,true);assert.deepEqual(f.sleeps,[1000,2000]);
 const failed=fixture([new Error(secret)]);await assert.rejects(failed.read(path),e=>{assert.match(e.message,/network-error/);assert.ok(!e.message.includes(secret));return true;});assert.equal(failed.calls,4);assert.equal(failed.sleeps.length,3);
});
test('one absolute budget applies across separate provenance requests and repeated failures',async()=>{
 const f=fixture([json(200,{ok:true})],{budgetMs:5000});await f.read(path);f.advance(5000);await assert.rejects(f.read(path),/deadline-exceeded.*budget-exhausted/);assert.equal(f.calls,1);
 const rate=fixture([json(403,{message:'API rate limit exceeded'},{'retry-after':'3'})],{budgetMs:5000});await assert.rejects(rate.read(path),/wait-exceeds-budget/);assert.equal(rate.calls,2);assert.deepEqual(rate.sleeps,[3000]);
});
test('pre-aborted request and cancellation during wait stop without another fetch',async()=>{
 const controller=new AbortController();controller.abort();const f=fixture([json(200,{ok:true})],{signal:controller.signal});await assert.rejects(f.read(path),/code=aborted/);assert.equal(f.calls,0);
 const during=new AbortController();const retry=fixture([json(429,{message:'rate'})],{signal:during.signal,wait:async()=>{during.abort();throw new Error(secret);}});await assert.rejects(retry.read(path),/code=aborted/);assert.equal(retry.calls,1);
});
test('only exact canonical same-repository provenance GET paths can carry token',async()=>{
 const f=fixture([()=>json(200,{ok:true})]);
 for(const refused of ['https://attacker/',`/repos/attacker/other/git/ref/heads/main`,`${path}?leak=${secret}`,`/repos/${repository}/contents/secret?ref=${'a'.repeat(40)}`])await assert.rejects(f.read(refused),/route-refused/);
 assert.equal(f.calls,0);
 await f.read(`/repos/${repository}/compare/${'a'.repeat(40)}...${'b'.repeat(40)}`);await f.read(`/repos/${repository}/contents/ops/preview-maintenance/example/manifest.json?ref=${'a'.repeat(40)}`);assert.equal(f.calls,2);
});
async function server(work){const app=createServer();app.listen(0,'127.0.0.1');await once(app,'listening');try{await work(app,`http://127.0.0.1:${app.address().port}`);}finally{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}}
test('real HTTP quota response is classified and retried without expanding read authority',async()=>server(async(app,origin)=>{
 let calls=0;app.on('request',(request,response)=>{calls++;assert.equal(request.method,'GET');assert.equal(request.headers.authorization,`Bearer ${secret}`);response.writeHead(calls===1?403:200,{'Content-Type':'application/json',...(calls===1?{'x-ratelimit-remaining':'0','retry-after':'1'}:{})});response.end(JSON.stringify(calls===1?{message:'API rate limit exceeded for installation'}:{object:{sha:'a'.repeat(40)}}));});
 const sleeps=[];const read=createGithubMaintenanceRead({repository,token:secret,wait:async ms=>{sleeps.push(ms);},fetcher:(url,init)=>{assert.equal(url,`https://api.github.com${path}`);return fetch(origin,init);}});assert.equal((await read(path)).object.sha,'a'.repeat(40));assert.equal(calls,2);assert.deepEqual(sleeps,[1000]);
}));
test('real HTTP redirect never follows or reflects a secret-bearing Location',async()=>server(async(app,origin)=>{
 let calls=0;app.on('request',(_request,response)=>{calls++;response.writeHead(302,{Location:`${origin}/private/${secret}`});response.end(secret);});
 const read=createGithubMaintenanceRead({repository,token:secret,fetcher:(_url,init)=>fetch(origin,init)});await assert.rejects(read(path),e=>{assert.match(e.message,/redirect-refused/);assert.ok(!e.message.includes(secret));return true;});assert.equal(calls,1);
}));
test('real HTTP headers-fast/body-stall remains inside the same absolute budget',async()=>server(async(app,origin)=>{
 app.on('request',(_request,response)=>{response.writeHead(200,{'Content-Type':'application/json'});response.flushHeaders();response.write('{');});
 const read=createGithubMaintenanceRead({repository,token:secret,budgetMs:60,fetcher:(_url,init)=>fetch(origin,init)});const start=Date.now();await assert.rejects(read(path),/deadline-exceeded.*budget-exhausted/);assert.ok(Date.now()-start<1000);
}));

test('real HTTP cancellation aborts pending fetch without retry or provider-body output',async()=>server(async(app,origin)=>{
 let calls=0;const controller=new AbortController();app.on('request',()=>{calls++;controller.abort();});
 const read=createGithubMaintenanceRead({repository,token:secret,signal:controller.signal,fetcher:(_url,init)=>fetch(origin,init)});
 const timer=setTimeout(()=>controller.abort(),2000);try{await assert.rejects(read(path),/code=aborted/);}finally{clearTimeout(timer);}assert.equal(calls,1);
}));
