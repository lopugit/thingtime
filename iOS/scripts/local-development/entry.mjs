// Development-only genuine Nitro host. No .env, account or production config.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
const work=process.env.THINGTIME_LOCAL_WORK,origin=process.env.THINGTIME_LOCAL_ORIGIN;
const parser=process.env.UNDICI_NO_WASM_SIMD;
const selected=new URL(origin);
assert.equal(selected.protocol,'http:');assert.equal(selected.hostname,'127.0.0.1');assert.equal(selected.pathname,'/');
assert(selected.port&&Number(selected.port)>1024&&!selected.username&&!selected.password);
assert.equal(parser,'1','Pinned mobile runtime bootstrap parser setting required');
// Node shares this native app process: retain only nonsensitive OS launch context.
// Clear all application/provider/account/API configuration, including fallback env.
const osKeys=new Set(['HOME','TMPDIR','PATH','USER','LOGNAME','LANG','LC_ALL','LC_CTYPE','SHELL','__CF_USER_TEXT_ENCODING','CFFIXED_USER_HOME','XPC_SERVICE_NAME','XPC_FLAGS','DYLD_ROOT_PATH','DYLD_LIBRARY_PATH','DYLD_FRAMEWORK_PATH','__XPC_DYLD_FRAMEWORK_PATH','__XPC_DYLD_LIBRARY_PATH']);
for(const key of Object.keys(process.env))if(!osKeys.has(key)&&!key.startsWith('SIMULATOR_')&&!key.startsWith('OS_ACTIVITY_'))delete process.env[key];
const preservedOSKeys=Object.keys(process.env).sort();
fs.mkdirSync(work,{recursive:true});process.chdir(work);
Object.assign(process.env,{NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:selected.port,NITRO_PORT:selected.port,UNDICI_NO_WASM_SIMD:parser});
const receipt=path.join(work,'runtime.json');
const report={node:process.version,platform:process.platform,arch:process.arch,origin:selected.origin,apiStarted:false,localAccountApiSupported:false,cloudFallback:false,preservedOSKeys,applicationConfigurationCleared:true,externalUndiciRequests:0,externalUndiciRequestsScope:'Node startup acceptance only; not an OS or all-lifecycle network proof'};
channel('undici:request:create').subscribe(({request})=>{if(new URL(request.origin).origin!==selected.origin)report.externalUndiciRequests++;});
try{
 const {middleware}=await import('./.output/server/index.mjs');assert.equal(typeof middleware,'function');
 const server=http.createServer(middleware);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(selected.port),'127.0.0.1',resolve);});
 assert.equal(server.address().address,'127.0.0.1');report.apiStarted=true;
 const response=await fetch(selected.origin+'/.well-known/thingtime-capabilities.json',{redirect:'error',signal:AbortSignal.timeout(10000)});
 assert.equal(response.status,200);const manifest=await response.json();assert.equal(manifest.origin,selected.origin);assert.equal(manifest.schemaVersion,1);assert(manifest.features['api.capabilities']);
 report.manifest={schemaVersion:manifest.schemaVersion,origin:manifest.origin,features:Object.keys(manifest.features).length,operations:manifest.operations.length};
 const document=await fetch(selected.origin+'/',{redirect:'error',signal:AbortSignal.timeout(10000)});const html=await document.text();assert.equal(document.status,200);assert(html.includes('<div id="root"'));
 report.document={status:document.status,hasViteRoot:true};
 const asset=html.match(/(?:src|href)="([^"]*\/assets\/[^"\s]+\.js)"/);assert(asset,'Canonical Vite entry asset missing');
 const script=await fetch(new URL(asset[1],selected),{redirect:'error',signal:AbortSignal.timeout(10000)});assert.equal(script.status,200);assert((await script.text()).length>0);report.entryAssetPassed=true;
 const account=await fetch(selected.origin+'/api/v1/auth/me',{redirect:'error',signal:AbortSignal.timeout(10000)});const unavailable=await account.json();
 assert.equal(account.status,503);assert.equal(unavailable.code,'LOCAL_API_NOT_CONFIGURED');assert.equal(report.externalUndiciRequests,0);report.accountApi={status:account.status,code:unavailable.code};
 report.ready=true;fs.writeFileSync(receipt,JSON.stringify(report,null,2));
}catch(error){report.ready=false;report.error={name:error.name,message:error.message,code:error.code};fs.writeFileSync(receipt,JSON.stringify(report,null,2));}
setInterval(()=>{},1000);
