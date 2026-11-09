'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {randomBytes}=require('node:crypto');
const {MongoClient}=require('/opt/thingtime-browser/node_modules/mongodb');
const session=process.env.THINGTIME_AGENT_SESSION;
const origin='http://127.0.0.1:18731';
const rs='tt-agent-'+session;
const home='/home/pwuser';
const children=new Set();
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const environment={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:home,TMPDIR:'/tmp',NODE_PATH:'/opt/thingtime-browser/node_modules'};
const boot=(args,env)=>{const p=spawn(process.execPath,args,{cwd:home,env,stdio:'inherit'});children.add(p);p.on('exit',()=>children.delete(p));return p;};
const mongo=()=>new MongoClient('mongodb://127.0.0.1:27017/?directConnection=true',{serverSelectionTimeoutMS:750});
async function retry(fn, message){
 for(let i=0;i<140;i++){try{const answer=await fn();if(answer)return answer;}catch{}await wait(250);}
 throw new Error(message);
}
const ready=()=>retry(async()=>{
 const r=await fetch(origin+'/api/v1/health/nitro',{signal:AbortSignal.timeout(800)});
 const h=await r.json();
 if(r.ok&&h.ok&&h.state==='ready'&&h.storageAccounting?.state==='ready'&&h.testEnvironment?.mode==='isolated-agent-test'&&h.testEnvironment?.sessionId===session)return h;
},'isolated app/replica did not become ready');
const api=(path,data)=>fetch(origin+path,{method:'POST',redirect:'error',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
async function main(){
 assert.match(session,/^[a-f0-9-]{36}$/);
 assert.ok(Object.values(os.networkInterfaces()).flat().every(i=>i.internal));
 const mongoLog=fs.openSync('/tmp/recovery-mongo.log','w',0o600);
 const md=spawn('/usr/local/bin/mongod',['--bind_ip','127.0.0.1','--port','27017','--dbpath',home+'/qa/db','--replSet',rs,'--wiredTigerCacheSizeGB','0.25','--quiet'],{env:environment,stdio:['ignore',mongoLog,mongoLog]});
 fs.closeSync(mongoLog);
 children.add(md);md.on('exit',()=>children.delete(md));
 await retry(async()=>{const c=mongo();try{return (await c.db('admin').command({ping:1})).ok;}finally{await c.close();}},'isolated Mongo did not listen');
 const c=mongo();
 try{
  await c.db('admin').command({replSetInitiate:{_id:rs,members:[{_id:0,host:'127.0.0.1:27017'}]}});
  await retry(async()=>{const h=await c.db('admin').command({hello:1});if(h.isWritablePrimary){assert.equal(h.setName,rs);assert.deepEqual(h.hosts,['127.0.0.1:27017']);return true;}},'isolated replica did not become primary');
 }finally{await c.close();}
 const env={...environment,NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:'18731',NITRO_PORT:'18731',APP_URL:origin,JWT_ISSUER:origin,JWT_SECRET:randomBytes(48).toString('base64url'),THINGTIME_USER_VAULT_KEY:randomBytes(32).toString('base64url'),THINGTIME_AGENT_TEST_MODE:'1',THINGTIME_AGENT_TEST_SESSION:session,THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR:home+'/qa/attachments',THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN:origin,MONGODB_CONNECTION_STRING:'mongodb://127.0.0.1:27017/thingtime?replicaSet='+rs};
 let server=boot(['/opt/thingtime-qa/runtime.mjs'],env);
 await ready();
 const fixture={username:'tt-fixture-admin-'+randomBytes(6).toString('hex'),password:'Task-'+randomBytes(32).toString('base64url')+'-9a!'};
 const r=await api('/api/v1/auth/register',{...fixture,email:fixture.username+'@example.test'});assert.equal(r.status,200);
 const ordinary=(await r.json()).user;assert.ok(ordinary.id);assert.equal(ordinary.isAdmin,false);
 const stop=once(server,'exit');server.kill('SIGTERM');await stop;
 server=boot(['/opt/thingtime-qa/runtime.mjs'],{...env,ADMIN_USERNAMES:fixture.username});
 const health=await ready();
 const l=await api('/api/v1/login',fixture);assert.equal(l.status,200);
 const actual=(await l.json()).user;assert.equal(actual.id,ordinary.id);assert.equal(actual.isAdmin,true);
 fs.writeFileSync(home+'/qa/admin.json',JSON.stringify(fixture),{mode:0o600,flag:'wx'});
 const m=await fetch(origin+'/.well-known/thingtime-capabilities.json').then(r=>r.json());assert.equal(m.origin,origin);
 assert.match(m.features['api.auth-characters']?.version||'',/^1\./);
 fs.writeFileSync('/tmp/recovery-ready.json',JSON.stringify({origin,health,characters:m.features['api.auth-characters'].version,adminRegisteredViaApi:true,replica:{primary:true,host:'127.0.0.1:27017'},isolatedInterfaces:true,attachmentAdapter:'task-owned-filesystem'},null,2));
}
main().catch(e=>{fs.writeFileSync('/tmp/recovery-start-failure',e.message);for(const p of children)p.kill('SIGTERM');process.exitCode=1;});
process.on('SIGTERM',()=>{for(const p of children)p.kill('SIGTERM');});
