import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const reportPath=process.env.PROBE_REPORT;
const work=fs.mkdtempSync(path.join(os.tmpdir(),'thingtime-ios-api-'));
const dbPort=Number('__DB_PORT__');
assert(Number.isInteger(dbPort)&&dbPort>1024&&dbPort<65536&&dbPort!==27017);
// No copied environment, deployment credentials, selected DB header or auth cookie.
for(const key of Object.keys(process.env))delete process.env[key];
Object.assign(process.env,{NODE_ENV:'production',HOST:'127.0.0.1',HOME:work,TMPDIR:work,PATH:'/usr/bin:/bin',
  MONGODB_CONNECTION_STRING:`mongodb://127.0.0.1:${dbPort}/thingtime_ios_api_probe?directConnection=true&serverSelectionTimeoutMS=250&connectTimeoutMS=250`});
process.chdir(work);
const report={node:process.version,platform:process.platform,arch:process.arch,
  sourceSha256:'__ENTRY_SHA256__',apiStarted:false,storageTested:false,dataWritesAttempted:false,
  databaseFence:{host:'127.0.0.1',port:dbPort,defaultPort:false,unreachable:false},
  sqlite:{databaseOpened:false},requests:[]};
let server;
try{
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
      cause:error.cause?{name:error.cause.name,code:error.cause.code||null,message:error.cause.message}:null};
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
}catch(error){report.error={name:error.name,code:error.code||null,message:error.message,stack:error.stack};}
finally{
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));report.serverClosed=!server.listening;}
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
}
