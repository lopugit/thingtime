#!/usr/bin/env node
// Built HTTP acceptance against a disposable replica set. Fixtures are made
// only through the public registration and group APIs; no user data is read.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'tt-platform-reporting-'));
const reservePort = async () => {
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
};
const dbPort = await reservePort(), apiPort = await reservePort(), adminPort = await reservePort(), legacyPort = await reservePort();
let origin = `http://127.0.0.1:${apiPort}`;
const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: dir, TMPDIR: dir, NODE_ENV: 'development',
  HOST: '127.0.0.1', PORT: String(apiPort), MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${dbPort}/thingtime?replicaSet=platformacceptance`,
  JWT_SECRET: randomBytes(48).toString('hex'), CRON_SECRET: randomBytes(48).toString('hex'), THINGTIME_DATA_ENV: 'development', ADMIN_USERNAMES: '' };
const children = [];
const start = (command, args, childEnv = env) => {
  const child = spawn(command, args, { cwd, env: childEnv, detached: true, stdio: 'ignore' });
  children.push(child);
  return child;
};
const waitFor = async (check, label) => {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 200)); }
  throw Error(`Timed out: ${label}`);
};
const request = async (path, { method = 'GET', body, cookie, status = 200, headers = {} } = {}) => {
  const response = await fetch(origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000) });
  const data = await response.json().catch(() => null);
  assert.equal(response.status, status, `${method} ${path} returned unexpected HTTP ${response.status}`);
  return { data, cookie: (response.headers.getSetCookie?.() || []).map(value => value.split(';')[0]).join('; ') };
};
const register = async (name) => request('/api/v1/auth/register', { method: 'POST',
  body: { username: name, email: `${name}@example.invalid`, password: randomBytes(32).toString('hex') } });
let mongo;
try {
  await access(join(cwd, '.output/server/index.mjs'));
  await mkdir(join(dir, 'db'));
  start(process.env.MONGOD_PATH || '/opt/homebrew/bin/mongod', ['--dbpath', join(dir, 'db'), '--port', String(dbPort), '--bind_ip', '127.0.0.1', '--replSet', 'platformacceptance', '--nounixsocket']);
  mongo = new MongoClient(`mongodb://127.0.0.1:${dbPort}/?directConnection=true`, { serverSelectionTimeoutMS: 700 });
  await waitFor(async () => { try { await mongo.connect(); return true; } catch { return false; } }, 'replica start');
  await mongo.db('admin').command({ replSetInitiate: { _id: 'platformacceptance', members: [{ _id: 0, host: `127.0.0.1:${dbPort}` }] } });
  await waitFor(async () => (await mongo.db('admin').command({ hello: 1 })).isWritablePrimary, 'replica primary');
  await mongo.close(); mongo = null;
  start(process.execPath, [join(cwd, '.output/server/index.mjs')]);
  await waitFor(async () => { try { return (await fetch(origin + '/.well-known/thingtime-capabilities.json')).ok; } catch { return false; } }, 'built API');
  const manifest = (await request('/.well-known/thingtime-capabilities.json')).data;
  assert.equal(manifest.origin, origin);
  assert.equal(manifest.features['api.admin-platform-reporting'].version, '1.0.0');
  assert.equal(manifest.features['api.auth-characters'].version, '1.3.0');

  const root = await register('batchowner');
  const stranger = await register('batchoutsider');
  env.ADMIN_USERNAMES = 'batchowner'; env.PORT=String(adminPort); origin=`http://127.0.0.1:${adminPort}`;
  start(process.execPath,[join(cwd,'.output/server/index.mjs')]);
  await waitFor(async()=>{try{return(await fetch(origin+'/.well-known/thingtime-capabilities.json')).ok}catch{return false}},'admin bootstrap');
  await request('/api/v1/admin/rate-limits',{method:'POST',cookie:root.cookie,body:{endpoints:{'auth.register':{limit:10,windowMs:900000,enabled:false}}}});
  const platform=await register('batchplatform');
  const characterInput={operation:'create',requestId:randomUUID(),username:'batch-platform-character',displayName:'Platform fixture',loginMode:'switch'};
  const characters=await Promise.all([1,2].map(()=>request('/api/v1/auth/characters',{method:'POST',cookie:platform.cookie,body:characterInput})));
  const character=characters[0].data.character.user;
  assert.equal(character.username,characterInput.username);assert.equal(characters[1].data.character.user.id,character.id);
  await request('/api/v1/auth/characters',{method:'POST',cookie:platform.cookie,body:{...characterInput,username:'different-handle'},status:409});
  const adminCharacter=(await request('/api/v1/auth/characters',{method:'POST',cookie:root.cookie,body:{operation:'create',requestId:randomUUID(),displayName:'Admin Character fixture',loginMode:'switch'}})).data.character.user;
  const rootId=root.data.user.id;
  const actorHeaders={'X-Thingtime-Expected-Actor':rootId};
  await request('/api/v1/admin/links',{method:'POST',cookie:root.cookie,body:{action:'add',linkKind:'account',userId:rootId,targetId:platform.data.user.id}});
  const group=(await request('/api/v1/groups',{method:'POST',cookie:root.cookie,body:{name:'Thingtime admin synthetic'},status:201})).data.group;
  assert.equal(group.memberCount,0,'Owner must be implicit, not an explicit row');
  const endpoint='/api/v1/admin/platform-reporting';
  assert.equal((await request(endpoint,{cookie:root.cookie})).data.status,'unconfigured');
  await request(endpoint,{cookie:stranger.cookie,status:403});
  await request(endpoint,{status:401});
  const config={enabled:true,ownerId:platform.data.user.id,characterId:character.id,groupId:group.id,groupOwnerId:rootId,revision:null};
  await request(endpoint,{method:'POST',cookie:root.cookie,body:config,status:409});
  await request(endpoint,{method:'POST',cookie:root.cookie,headers:{...actorHeaders,Origin:'http://foreign.invalid'},body:config,status:403});
  await request(endpoint,{method:'POST',cookie:root.cookie,headers:{'X-Thingtime-Expected-Actor':adminCharacter.id,'X-Thingtime-Character':adminCharacter.id},body:config,status:403});
  const saved=(await request(endpoint,{method:'POST',cookie:root.cookie,headers:actorHeaders,body:config})).data.config;
  await request(endpoint,{method:'POST',cookie:root.cookie,headers:actorHeaders,body:config,status:409});
  const cron='/api/v1/auth/invites/expire';
  await request(cron,{status:401});
  assert.equal((await request(endpoint,{cookie:root.cookie})).data.lastReport,null);
  await request(cron,{headers:{Authorization:`Bearer ${env.CRON_SECRET}`}});
  const observed=(await request(endpoint,{cookie:root.cookie})).data;
  assert.equal(observed.owner.username,'batchplatform');assert.equal(observed.character.username,characterInput.username);assert.equal(observed.group.name,group.name);
  assert.equal(observed.lastReport.deliveryStatus,'recorded');assert.equal(observed.lastReport.runStatus,'completed');
  const runId=observed.lastReport.runId;
  // Match the exact run/status delimiter without exposing credentials.
  const eventId=status=>'platform-run-'+createHash('sha256').update(runId).update(Buffer.from([0])).update(status).digest('hex');
  assert.equal(observed.lastReport.postId,eventId('completed'));
  for(const status of ['started','completed']) {
    const id=eventId(status);
    const read=(await request('/api/v1/things?id='+id,{cookie:root.cookie})).data;
    assert.equal(read.post.author.id,character.id);assert.ok(read.thing.crystal.renderComponent);
    assert.deepEqual([...read.thing.acl].sort(),['tt:custom','tt:user','tt:group/'+group.id].sort());
    await request('/api/v1/things?id='+id,{status:404});await request('/api/v1/things?id='+id,{cookie:stranger.cookie,status:404});
  }
  const feed=(await request('/api/v1/things/feed?scope=all',{cookie:root.cookie})).data;
  assert.ok(feed.posts.some(post=>post.id===eventId('completed')),'Implicit group owner sees the report in feed');
  const strangerFeed=(await request('/api/v1/things/feed?scope=all',{cookie:stranger.cookie})).data;
  assert.ok(!strangerFeed.posts.some(post=>post.id===eventId('completed')));
  await request(endpoint,{method:'POST',cookie:root.cookie,headers:actorHeaders,body:{...saved,enabled:false,updatedBy:undefined}});
  await request(cron,{headers:{Authorization:`Bearer ${env.CRON_SECRET}`}});
  const disabled=(await request(endpoint,{cookie:root.cookie})).data;
  assert.equal(disabled.lastReport.deliveryStatus,'disabled');assert.equal(disabled.lastReport.postId,null);
  const after=(await request('/api/v1/things/feed?scope=all',{cookie:root.cookie})).data;
  assert.deepEqual(new Set(after.posts.map(post=>post.id)),new Set(feed.posts.map(post=>post.id)));
  await request('/api/v1/groups',{method:'DELETE',cookie:root.cookie,body:{id:group.id}});
  await request('/api/v1/things?id='+eventId('completed'),{cookie:root.cookie,status:404});
  console.log(JSON.stringify({event:'passed',isolatedReplica:true,customCharacterHandle:true,concurrentIdempotency:true,linkedOwner:true,privateReadback:true,groupOwnerImplicit:true,anonymousAndStrangerRefused:true,disabledNoPosts:true,deletionRevokes:true}));
} finally {
  if(mongo)await mongo.close().catch(()=>{});
  for(const child of children.reverse()){try{process.kill(-child.pid,'SIGTERM')}catch{}}
  await new Promise(resolve=>setTimeout(resolve,500));
  for(const child of children){try{process.kill(-child.pid,'SIGKILL')}catch{}}
  await rm(dir,{recursive:true,force:true});
}
