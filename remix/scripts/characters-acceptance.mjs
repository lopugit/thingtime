#!/usr/bin/env node
// Disposable real API acceptance. All application/backend network is OS fenced.
// Only replica-set initialization uses the Mongo driver; product data uses APIs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
const cwd = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'tt-characters-'));
const ports = { api: 19841, db: 19842, web: 19843, hmr: 19844 };
const origin = `http://127.0.0.1:${ports.api}`;
const mongoUri = `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=characters`;
const children = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
const password = randomBytes(24).toString('hex');
const characterPassword = randomBytes(24).toString('hex');
const env = { PATH: process.env.PATH, HOME: dir, TMPDIR: dir, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(ports.api),
  MONGODB_CONNECTION_STRING: mongoUri, JWT_SECRET: randomBytes(48).toString('hex'), THINGTIME_DATA_ENV: 'development',
  TT_WEB_PORT: String(ports.web), TT_API_PORT: String(ports.api), TT_HMR_PORT: String(ports.hmr) };
let trapHits = 0;
const trap = createServer((req,res) => { trapHits++; res.writeHead(307, { Location: 'http://1.1.1.1:80/' }); res.end(); });
await new Promise(r => trap.listen(0, '127.0.0.1', r));
const policy = join(dir, 'network.sb');
await writeFile(policy, `(version 1)(allow default)(deny network*)
(allow network-bind (local unix-socket))
(allow network-inbound ${Object.values(ports).map(p => `(local ip "localhost:${p}")`).join(' ')})
(allow network-outbound ${[...Object.values(ports),trap.address().port].map(p => `(remote ip "localhost:${p}")`).join(' ')})`);
function start(executable,args,extra={}) {
  const child = spawn('/usr/bin/sandbox-exec',['-f',policy,executable,...args], {cwd,detached:true,env:{...env,...extra},stdio:['ignore','pipe','pipe']});
  let log=''; child.stdout.on('data',d=>log+=d); child.stderr.on('data',d=>log+=d); children.push(child);
  return {child,log:()=>log};
}
async function stop(running) {
  const killGroup = signal => { try { process.kill(-running.child.pid, signal); } catch(error) { if(error.code !== 'ESRCH') throw error; } };
  const exited = running.child.exitCode !== null || running.child.signalCode !== null;
  const exit = exited ? Promise.resolve() : once(running.child, 'exit');
  killGroup('SIGTERM');
  const forced = setTimeout(() => killGroup('SIGKILL'), 3000);
  await exit; clearTimeout(forced);
  killGroup('SIGKILL');
}
async function ready(running, readyOrigin = origin) {
  for(let n=0;n<100;n++) { if(running.child.exitCode!==null) throw new Error(running.log());
    try { if((await fetch(`${readyOrigin}/.well-known/thingtime-capabilities.json`,{signal:AbortSignal.timeout(700)})).ok)return; } catch{}
    await delay(200);
  } throw new Error(`Server not ready: ${running.log()}`);
}
async function api(path,{body,cookie,as,method,status=200}={}) {
  console.log(`${method||(body?'POST':'GET')} ${path.split('?')[0]}`);
  const response=await fetch(origin+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{}),...(as?{'X-Thingtime-Character':as}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  assert.equal(response.status,status,`${path}: ${JSON.stringify(data)}`);
  return {data,cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
}
let server;
try {
  assert.equal(process.platform,'darwin','Requires OS sandbox; do not fall back to unrestricted execution');
  for(const port of Object.values(ports)) { const listener=createServer(); await new Promise((r,j)=>{listener.once('error',j);listener.listen(port,'127.0.0.1',r)});await new Promise(r=>listener.close(r)); }
  const preflight=start(process.execPath,['--input-type=module','-e',`for(const url of ['http://1.1.1.1:80/','http://127.0.0.1:${trap.address().port}/redirect']){try{await fetch(url,{signal:AbortSignal.timeout(2000)});throw Error('BOUNDARY_FAILED')}catch(e){if(e.cause?.code!=='EPERM')throw e}}`]);
  assert.equal((await once(preflight.child,'exit'))[0],0,preflight.log()); assert.equal(trapHits,1);
  await mkdir(join(dir,'db'));
  const db=start('/opt/homebrew/bin/mongod',['--dbpath',join(dir,'db'),'--port',String(ports.db),'--bind_ip','127.0.0.1','--replSet','characters','--nounixsocket']);
  const client=new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`,{serverSelectionTimeoutMS:1000});
  for(let n=0;;n++) { try{await client.connect();break}catch(e){if(n>20)throw e;await delay(300)} }
  await client.db('admin').command({replSetInitiate:{_id:'characters',members:[{_id:0,host:`127.0.0.1:${ports.db}`}]}});
  for(let n=0;;n++){if((await client.db('admin').command({hello:1})).isWritablePrimary)break;if(n>100)throw Error('Replica not primary');await delay(200)}
  await client.close();
  server=start(process.execPath,['.output/server/index.mjs']); await ready(server);
  const manifest=(await api('/.well-known/thingtime-capabilities.json')).data;
  assert.equal(manifest.features['api.auth-characters'].version,'1.0.0');
  const owner=await api('/api/v1/auth/register',{body:{username:'character-owner-test',email:'owner@example.invalid',password,displayName:'Private owner'}});
  assert(owner.data.user.id); const ownerId=owner.data.user.id;
  const stranger=await api('/api/v1/auth/register',{body:{username:'character-stranger-test',email:'stranger@example.invalid',password}});
  await stop(server); server=start(process.execPath,['.output/server/index.mjs'],{ADMIN_USERNAMES:'character-owner-test'});await ready(server);
  const create=async(loginMode,displayName)=>api('/api/v1/auth/characters',{cookie:owner.cookie,body:{operation:'create',requestId:randomUUID(),loginMode,displayName,...(loginMode==='password'?{password:characterPassword}:{})}});
  const separate=(await create('password','Agent Aspen')).data.character.user;
  const inherited=(await create('inherit','Agent Willow')).data.character.user;
  const switchOnly=(await create('switch','Quiet Character')).data.character.user;
  assert.notEqual(separate.id,ownerId); assert.equal(separate.isAdmin,false);
  const ownLogin=await api('/api/v1/login',{body:{username:separate.username,password:characterPassword}});
  assert.equal(ownLogin.data.user.id,separate.id);
  const inheritedLogin=await api('/api/v1/login',{body:{username:inherited.username,password}});
  assert.equal(inheritedLogin.data.user.id,inherited.id);
  await api('/api/v1/login',{body:{username:switchOnly.username,password},status:401});
  await api('/api/v1/login',{body:{username:separate.username,password},status:401});
  const charRoster=(await api('/api/v1/auth/characters',{cookie:ownLogin.cookie})).data;
  assert.equal(charRoster.canManage,false); assert.deepEqual(charRoster.characters,[]); assert.equal(JSON.stringify(charRoster).includes(ownerId),false);
  await api('/api/v1/auth/characters',{cookie:ownLogin.cookie,body:{operation:'select',characterId:ownerId},status:403});
  await api('/api/v1/auth/characters',{cookie:stranger.cookie,body:{operation:'select',characterId:separate.id},status:403});
  await api('/api/v1/auth/characters',{cookie:owner.cookie,body:{operation:'select',characterId:separate.id}});
  assert.equal((await api('/api/v1/auth/me',{cookie:owner.cookie})).data.user.id,separate.id);
  assert.equal((await api('/api/v1/auth/me',{cookie:owner.cookie,as:ownerId})).data.user.id,ownerId);
  const post=(await api('/api/v1/things',{cookie:owner.cookie,body:{thingtime:['post'],crystal:{type:'text',text:'Character acceptance public post'},acl:['tt:all']},status:200})).data;
  assert.equal(post.thing?.ownerId||post.post?.author?.id||post.thing?.author?.id,separate.id,JSON.stringify(post));
  const publicRead=(await api(`/api/v1/things?id=${post.post.id}`)).data;
  assert.equal(JSON.stringify(publicRead).includes(ownerId),false);
  const reply=(await api('/api/v1/things',{cookie:owner.cookie,as:inherited.id,body:{thingtime:['comment'],targetId:post.post.id,crystal:{text:'Coordinating as Willow'}}})).data;
  assert(JSON.stringify(reply).includes(inherited.id));
  await api('/api/v1/things',{cookie:ownLogin.cookie,as:ownerId,body:{thingtime:['post'],crystal:{type:'text',text:'Must never publish'},acl:['tt:all']},status:401});
  const plan=(await api(`/api/v1/admin/subscriptions?subjectType=user&subjectId=${ownerId}`,{cookie:owner.cookie,as:ownerId})).data.subscription;
  await api('/api/v1/admin/subscriptions',{cookie:owner.cookie,as:ownerId,body:{subjectType:'user',subjectId:ownerId,tier:plan.tier,tierVersionId:plan.tierVersionId,overrides:{userStorageBytes:1234567},note:'Private owner note'}});
  const inheritedPlan=(await api(`/api/v1/admin/subscriptions?subjectType=user&subjectId=${separate.id}`,{cookie:owner.cookie,as:ownerId})).data.subscription;
  assert.equal(inheritedPlan.effective.userStorageBytes,1234567);assert.notEqual(inheritedPlan.note,'Private owner note');
  assert.equal((await api('/api/v1/auth/me',{cookie:ownLogin.cookie})).data.user.storage.allowanceBytes,1234567);
  await api('/api/v1/admin/subscriptions',{cookie:owner.cookie,as:ownerId,body:{subjectType:'user',subjectId:ownerId,tier:plan.tier,tierVersionId:plan.tierVersionId,overrides:{userStorageBytes:0}}});
  await api('/api/v1/things',{cookie:ownLogin.cookie,body:{thingtime:['post'],crystal:{type:'text',text:'Must reject after owner quota downgrade'},acl:['tt:all']},status:507});
  await api('/api/v1/admin/subscriptions',{cookie:owner.cookie,as:ownerId,body:{subjectType:'user',subjectId:ownerId,tier:plan.tier,tierVersionId:plan.tierVersionId,overrides:{userStorageBytes:1234567}}});
  const ownerState=(await api('/api/v1/auth/me',{cookie:owner.cookie,as:ownerId})).data.user;
  assert.equal(ownerState.storage.status,'ready','Character posting must preserve owner ledger validity');
  const subspace=(await api('/api/v1/subspaces',{cookie:owner.cookie,as:ownerId,body:{slug:'thingtime_agents_test',name:'Thingtime Agents',access:'private'},status:201})).data.subspace;
  await api('/api/v1/subspaces/feed?slug=thingtime_agents_test',{cookie:ownLogin.cookie,status:403});
  await api('/api/v1/subspaces/members',{cookie:owner.cookie,as:ownerId,body:{slug:subspace.slug,userId:separate.id,action:'add'}});
  const coordination=(await api('/api/v1/things',{cookie:ownLogin.cookie,body:{thingtime:['post'],crystal:{type:'text',text:'Claiming the Characters acceptance task',subspaceId:subspace.id},acl:['tt:all']},status:200})).data;
  for (const cookie of ['', stranger.cookie]) {
    const denied = await fetch(origin+'/api/v1/things?id='+coordination.post.id,{headers:cookie?{Cookie:cookie}:{}});
    assert([403,404].includes(denied.status),'Private-subspace posts must not leak through direct Thing reads');
  }
  const feed=(await api('/api/v1/subspaces/feed?slug=thingtime_agents_test',{cookie:ownLogin.cookie})).data;
  assert(JSON.stringify(feed).includes('Claiming the Characters acceptance task'));
  await api('/api/v1/subspaces/feed?slug=thingtime_agents_test',{cookie:stranger.cookie,status:403});
  const inspection=(await api(`/api/v1/auth/characters?inspect=${separate.id}`,{cookie:owner.cookie})).data;
  assert.equal(inspection.ownerId,ownerId);
  await api(`/api/v1/auth/characters?inspect=${separate.id}`,{cookie:ownLogin.cookie,status:403});
  if (process.argv.includes('--ui')) {
    const vite=start(process.execPath,['--input-type=module','-e',`import {createServer} from 'vite';const server=await createServer({envFile:false,server:{host:'127.0.0.1',port:${ports.web},strictPort:true}});await server.listen();`],{NODE_ENV:'development'});
    const webOrigin=`http://127.0.0.1:${ports.web}`;await ready(vite,webOrigin);
    const fixture=join(dir,'browser-fixture.json');
    await writeFile(fixture,JSON.stringify({origin:webOrigin,cookie:owner.cookie,password:characterPassword,redirect:`http://127.0.0.1:${trap.address().port}/redirect`}),{mode:0o600});
    const ui=start(process.execPath,['scripts/characters-browser-acceptance.mjs',fixture],{PLAYWRIGHT_MODULE:process.env.PLAYWRIGHT_MODULE,CHROMIUM_EXECUTABLE:process.env.CHROMIUM_EXECUTABLE,CHARACTERS_EVIDENCE_DIR:process.env.CHARACTERS_EVIDENCE_DIR});
    const timeout = setTimeout(() => { try { process.kill(-ui.child.pid, 'SIGTERM'); } catch {} }, 180_000);
    const uiExit = await once(ui.child,'exit'); clearTimeout(timeout);
    assert.equal(uiExit[0],0,ui.log());console.log(ui.log());
  }
  await api('/api/v1/auth/characters',{cookie:owner.cookie,body:{operation:'disable',characterId:separate.id}});
  assert.equal((await api('/api/v1/auth/me',{cookie:ownLogin.cookie})).data.user,null);
  await api('/api/v1/login',{body:{username:separate.username,password:characterPassword},status:401});
  assert.equal((await api('/api/v1/auth/me',{cookie:owner.cookie})).data.user.id,ownerId);
  console.log(JSON.stringify({ok:true,checks:['OS network isolation and redirect denial','disposable replica set','capability manifest','all three login modes','private owner link','no privilege inheritance','owner selection and override','Character-authored public posts','independent private subspace membership','private coordination posts','admin-only owner inspection','disable and session revocation'],productionAccess:false}));
} catch(error) {
  console.error(error.message);
  if(server) await writeFile('/tmp/thingtime-characters-acceptance-server.log',server.log(),{mode:0o600});
  process.exitCode=1;
} finally {
  for(const child of children.reverse()) await stop({child});
  await new Promise(r=>trap.close(r));await rm(dir,{recursive:true,force:true});
}
