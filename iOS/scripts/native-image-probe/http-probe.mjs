import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
const reportPath=process.env.PROBE_REPORT;
// This non-secret parser selection is installed by the pinned mobile runtime.
const runtime={mobile:process.versions.mobile,undici:process.versions.undici,
  parserSetting:process.env.UNDICI_NO_WASM_SIMD,
  wasmImplementation:/\[native code\]/.test(Function.prototype.toString.call(WebAssembly.Module))?'engine':'polyfill'};
const work=fs.mkdtempSync(path.join(os.tmpdir(),'thingtime-ios-api-'));
const dbPort=Number('__DB_PORT__');
assert(Number.isInteger(dbPort)&&dbPort>1024&&dbPort<65536&&dbPort!==27017);
// No copied environment, deployment credentials, selected DB header or auth cookie.
for(const key of Object.keys(process.env))delete process.env[key];
Object.assign(process.env,{NODE_ENV:'production',HOST:'127.0.0.1',HOME:work,TMPDIR:work,PATH:'/usr/bin:/bin',
  MONGODB_CONNECTION_STRING:`mongodb://127.0.0.1:${dbPort}/thingtime_ios_api_probe?directConnection=true&serverSelectionTimeoutMS=250&connectTimeoutMS=250`});
// Preserve exactly the runtime-provided setting; do not invent or override it.
if(runtime.parserSetting==='1')process.env.UNDICI_NO_WASM_SIMD=runtime.parserSetting;
process.chdir(work);
const report={node:process.version,platform:process.platform,arch:process.arch,
  sourceSha256:'__ENTRY_SHA256__',apiStarted:false,storageTested:false,dataWritesAttempted:false,
  databaseFence:{host:'127.0.0.1',port:dbPort,defaultPort:false,unreachable:false},
  sqlite:{databaseOpened:false},runtime,requests:[],fetchPassed:false};
let server,diagnostics;
try{
  assert.equal(runtime.parserSetting,'1','Pinned mobile runtime must supply its documented scalar parser selection');
  assert.equal(process.env.UNDICI_NO_WASM_SIMD,runtime.parserSetting);
  await new Promise((resolve,reject)=>{
    const socket=net.createConnection({host:'127.0.0.1',port:dbPort});
    socket.setTimeout(500,()=>{report.databaseFence.connectionOutcome='timeout';socket.destroy();resolve();});
    socket.once('connect',()=>{socket.destroy();reject(new Error('Database fence unexpectedly has a listener'));});
    socket.once('error',error=>{if(error.code==='ECONNREFUSED'){report.databaseFence.connectionOutcome='ECONNREFUSED';resolve();}else reject(error);});
  });
  report.databaseFence.unreachable=true;
  try{const sqlite=await import('node:sqlite');report.sqlite.available=typeof sqlite.DatabaseSync==='function';}
  catch(error){report.sqlite.available=false;report.sqlite.code=error.code||null;}
  const application=await import('./.output/server/index.mjs');
  assert.equal(typeof application.middleware,'function');
  report.nitroImported=true;
  server=http.createServer(application.middleware);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  report.apiStarted=true;
  const address=server.address();
  const origin=`http://127.0.0.1:${address.port}`;
  report.origin=origin;
  const pathname='/.well-known/thingtime-capabilities.json';
  let response;
  const fetchAttempt={transport:'fetch',method:'GET',path:pathname};
  report.requests.push(fetchAttempt);
  try{
    const fetched=await fetch(origin+pathname,{redirect:'error',signal:AbortSignal.timeout(10000)});
    response={status:fetched.status,contentType:fetched.headers.get('content-type')||'',body:await fetched.text()};
    fetchAttempt.status=response.status;
  }catch(error){
    fetchAttempt.error={name:error.name,message:error.message,code:error.code||null,
      cause:error.cause?{name:error.cause.name,code:error.cause.code||null,message:error.cause.message,stack:error.cause.stack}:null};
    const httpAttempt={transport:'node:http',method:'GET',path:pathname};
    report.requests.push(httpAttempt);
    response=await new Promise((resolve,reject)=>{
      const request=http.get(origin+pathname,{agent:false},incoming=>{
        const chunks=[];
        incoming.on('data',chunk=>chunks.push(chunk));incoming.on('error',reject);
        incoming.on('end',()=>resolve({status:incoming.statusCode,contentType:incoming.headers['content-type']||'',body:Buffer.concat(chunks).toString('utf8')}));
      });
      request.setTimeout(10000,()=>request.destroy(new Error('Native HTTP manifest request timed out')));
      request.once('error',reject);
    });
    httpAttempt.status=response.status;
  }
  const contentType=response.contentType;
  assert.equal(response.status,200);
  assert(contentType.includes('application/json'));
  const manifest=JSON.parse(response.body);
  assert.equal(manifest.origin,origin);
  assert.equal(manifest.schemaVersion,1);
  assert(Array.isArray(manifest.operations)&&manifest.operations.length>0);
  assert.equal(typeof manifest.features?.['api.things']?.version,'string');
  assert(manifest.operations.some(x=>x.feature==='api.capabilities'&&x.path===pathname&&x.methods.includes('GET')));
  report.manifest={origin:manifest.origin,schemaVersion:manifest.schemaVersion,
    featureCount:Object.keys(manifest.features).length,operationCount:manifest.operations.length,
    things:manifest.features['api.things'].version,search:manifest.features['api.things-search']?.version,
    originMatched:true,operationRegistered:true};
  report.manifestPassed=true;
  assert.equal(fetchAttempt.status,200,'Global Fetch must pass; direct HTTP fallback is diagnostic only');
  assert.equal(fetchAttempt.error,undefined);
  const streamed=Buffer.from('native-fetch-💙-chunked');
  diagnostics=http.createServer((request,response)=>{
    if(request.url==='/stream'){
      response.writeHead(200,{'Content-Type':'application/octet-stream'});
      response.write(streamed.subarray(0,14));
      response.end(streamed.subarray(14));
    }else if(request.url==='/gzip'){
      response.writeHead(200,{'Content-Encoding':'gzip','Content-Type':'text/plain'});
      response.end(gzipSync('native-fetch-gzip'));
    }else if(request.url==='/redirect'){
      response.writeHead(302,{Location:'/stream'});response.end();
    }else if(request.url==='/slow'){
      const timer=setTimeout(()=>response.end('too late'),500);
      response.once('close',()=>clearTimeout(timer));
    }else{response.writeHead(404);response.end();}
  });
  await new Promise((resolve,reject)=>{diagnostics.once('error',reject);diagnostics.listen(0,'127.0.0.1',resolve);});
  const fixtureOrigin=`http://127.0.0.1:${diagnostics.address().port}`;
  report.httpBehavior={fixture:'separate synthetic read-only HTTP server'};
  const repeated=await fetch(origin+pathname,{signal:AbortSignal.timeout(10000)});
  assert.equal(repeated.status,200);assert.equal((await repeated.json()).origin,origin);
  report.httpBehavior.repeatedRealManifest=true;
  const streamedResponse=await fetch(fixtureOrigin+'/stream',{signal:AbortSignal.timeout(10000)});
  assert.deepEqual(Buffer.from(await streamedResponse.arrayBuffer()),streamed);
  report.httpBehavior.chunkedBinaryUtf8=true;
  const zipped=await fetch(fixtureOrigin+'/gzip',{signal:AbortSignal.timeout(10000)});
  assert.equal(await zipped.text(),'native-fetch-gzip');report.httpBehavior.gzipDecoded=true;
  const followed=await fetch(fixtureOrigin+'/redirect',{signal:AbortSignal.timeout(10000)});
  assert(followed.redirected);assert.equal(followed.url,fixtureOrigin+'/stream');
  assert.deepEqual(Buffer.from(await followed.arrayBuffer()),streamed);report.httpBehavior.redirectFollow=true;
  const manual=await fetch(fixtureOrigin+'/redirect',{redirect:'manual',signal:AbortSignal.timeout(10000)});
  assert.equal(manual.status,302);await manual.arrayBuffer();report.httpBehavior.redirectManual=true;
  await assert.rejects(fetch(fixtureOrigin+'/redirect',{redirect:'error',signal:AbortSignal.timeout(10000)}),{name:'TypeError'});
  report.httpBehavior.redirectRefused=true;
  await assert.rejects(fetch(fixtureOrigin+'/slow',{signal:AbortSignal.timeout(20)}),{name:'TimeoutError'});
  report.httpBehavior.abortSignal=true;
  report.fetchPassed=true;
}catch(error){report.error={name:error.name,code:error.code||null,message:error.message,stack:error.stack};}
finally{
  if(diagnostics){diagnostics.closeAllConnections();await new Promise(resolve=>diagnostics.close(resolve));report.diagnosticServerClosed=!diagnostics.listening;}
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));report.serverClosed=!server.listening;}
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
}
