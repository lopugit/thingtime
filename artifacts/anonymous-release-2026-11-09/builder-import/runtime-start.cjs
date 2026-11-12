'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { MongoClient } = require('/opt/thingtime-browser/node_modules/mongodb');
const session = process.env.THINGTIME_AGENT_SESSION;
const origin = 'http://127.0.0.1:18724';
const env = { PATH:'/usr/local/bin:/usr/bin:/bin', HOME:'/home/pwuser', TMPDIR:'/tmp',
 NODE_ENV:'production', HOST:'127.0.0.1', NITRO_HOST:'127.0.0.1', PORT:'18724', NITRO_PORT:'18724',
 APP_URL:origin, JWT_ISSUER:origin, JWT_SECRET:randomBytes(48).toString('base64url'),
 THINGTIME_AGENT_TEST_MODE:'1', THINGTIME_AGENT_TEST_SESSION:session,
 THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR:'/home/pwuser/qa-attachments', THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN:origin,
 MONGODB_CONNECTION_STRING:'mongodb://127.0.0.1:27017/thingtime?replicaSet=tt-agent-'+session };
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
const exclusive = port => new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen({host:'127.0.0.1',port,exclusive:true},()=>s.close(resolve));});
const mongo = () => new MongoClient('mongodb://127.0.0.1:27017/?directConnection=true',{serverSelectionTimeoutMS:500});
const run = async () => {
 assert.ok(Object.values(os.networkInterfaces()).flat().every(addr=>addr.internal));
 assert.match(session,/^[a-f0-9-]{36}$/);
 await exclusive(18724);
 const c=mongo();
 try {
  const a=c.db('admin');
  for(let i=0;;i++){const hello=await a.command({hello:1});if(hello.isWritablePrimary){assert.equal(hello.setName,'tt-agent-'+session);assert.deepEqual(hello.hosts,['127.0.0.1:27017']);break;}if(i>=65)throw Error('replica startup timeout');await wait(250);}
 } finally {await c.close();}
 const child=spawn(process.execPath,['/tmp/qa-runtime.mjs'],{env,stdio:'inherit',cwd:'/home/pwuser/qa'});
 for(let i=0;i<130;i++){
  assert.equal(child.exitCode,null,'app exited before startup');
  try {
   const h=await fetch(origin+'/api/v1/health/nitro',{signal:AbortSignal.timeout(1000)}).then(r=>r.json());
   if(h.state==='ready'&&h.storageAccounting?.state==='ready'&&h.testEnvironment?.mode==='isolated-agent-test'&&h.testEnvironment?.sessionId===session){
    const m=await fetch(origin+'/.well-known/thingtime-capabilities.json').then(r=>r.json());
    assert.equal(m.origin,origin);
    fs.writeFileSync('/tmp/qa-ready.json',JSON.stringify({origin,health:h,manifest:{things:m.features['api.things'].version,import:m.features['api.things-import'].version},replica:{primary:true,setName:'tt-agent-'+session,hosts:['127.0.0.1:27017']}}));
    return;
   }
  } catch {}
  await wait(400);
 }
 throw Error('app startup timeout');
};
run().catch(e=>{fs.writeFileSync('/tmp/qa-failure',e.message);process.exitCode=1;});
