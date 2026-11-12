import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BSON } from 'mongodb';
import { createPasswordReset } from '../auth/passwordResets';
import { createEmailVerification, consumeEmailVerification } from '../auth/emailVerifications';
import { createSingleUseToken } from '../auth/singleUseTokens';
import { withHomeEmailVerificationRepository } from '../auth/singleUseTokenRepository';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { createNativeEmailVerificationRepository, singleUseTokenDigest } from './nativeSingleUseTokens';
import { createNativeHomeAuthRepositories } from './nativeUserIdentities';
import { createCollectionProvider } from './collectionProvider';
import { openSqliteDocumentStore } from './sqliteStore';
import type { CollectionProvider } from './collectionContract';
const code=(expected:string)=>(error:unknown)=>(error as {code?:string})?.code===expected;
const fixture=async(t:TestContext)=>{
 const directory=await mkdtemp(join(tmpdir(),'thingtime-verification-')),providers:CollectionProvider[]=[];
 t.after(async()=>{await Promise.all(providers.map(p=>p.close()));await rm(directory,{recursive:true,force:true});});
 return {directory,async open(name='home.sqlite',plane='home'){
  const provider=createCollectionProvider(await openSqliteDocumentStore(join(directory,name)));providers.push(provider);
  const repository=await createNativeEmailVerificationRepository(provider,plane);
  return {provider,repository,run:<T>(work:()=>T|Promise<T>)=>withHomeEmailVerificationRepository(repository,plane,work)};
 }};
};
test('canonical issue hashes persisted token; normalization, BSON Dates, expiry and single use survive SQLite reopen',async t=>{
 const f=await fixture(t),a=await f.open();
 const issued=await a.run(()=>createEmailVerification({userId:'owner-a',email:' OWNER@EXAMPLE.INVALID '}));
 assert.match(issued.token,/^[a-f0-9]{64}$/);assert.equal(issued.email,'owner@example.invalid');
 const docs=await a.provider.transaction(s=>s.collection(physicalCollectionName('emailVerifications')).find({limit:10}).documents);
 assert.equal(docs.length,1);const stored=BSON.deserialize(docs[0]);assert.equal(stored.token,singleUseTokenDigest(issued.token));assert.notEqual(stored.token,issued.token);
 await a.provider.close();assert.equal((await readFile(join(f.directory,'home.sqlite'))).includes(Buffer.from(issued.token)),false);
 const b=await f.open();await b.run(async()=>{
  const read=await b.repository.find(issued.token);assert.ok(read!.createdAt instanceof Date);assert.ok(read!.expiresAt instanceof Date);assert.equal(read!.userId,'owner-a');
  assert.deepEqual(await consumeEmailVerification(stored.token),{ok:false,reason:'invalid'});
  assert.deepEqual(await consumeEmailVerification(issued.token),{ok:true,userId:'owner-a',email:'owner@example.invalid'});
  assert.deepEqual(await consumeEmailVerification(issued.token),{ok:false,reason:'used'});
  assert.deepEqual(await consumeEmailVerification('not-a-token'),{ok:false,reason:'invalid'});
  const expired=await createEmailVerification({userId:'owner-b',email:'b@example.invalid',expiresInMs:-1});
  assert.deepEqual(await consumeEmailVerification(expired.token),{ok:false,reason:'expired'});
  const exact=await createEmailVerification({userId:'owner-c',email:'c@example.invalid'});
  assert.equal(await b.repository.claim(exact.token,exact.expiresAt),null);
 });
});
test('independent SQLite handles race one atomic claim winner; account and separate home files remain isolated',async t=>{
 const f=await fixture(t),a=await f.open(),b=await f.open(),other=await f.open('other.sqlite','other');
 const token=await a.run(()=>createEmailVerification({userId:'owner-a',email:'a@example.invalid'}));
 assert.deepEqual(await other.run(()=>consumeEmailVerification(token.token)),{ok:false,reason:'invalid'});
 const results=await Promise.all(Array.from({length:16},(_,i)=>(i%2?a:b).run(()=>consumeEmailVerification(token.token))));
 assert.equal(results.filter(x=>x.ok).length,1);assert.equal(results.filter(x=>x.ok===false&&x.reason==='used').length,15);
 const authOther=await createNativeHomeAuthRepositories(other.provider,'other');
 await a.run(()=>authOther.run(async()=>{await assert.rejects(consumeEmailVerification(token.token),code('SINGLE_USE_TOKEN_SCOPE'));}));
 const second=await b.run(()=>createEmailVerification({userId:'owner-b',email:'b@example.invalid'}));
 assert.deepEqual(await a.run(()=>consumeEmailVerification(second.token)),{ok:true,userId:'owner-b',email:'b@example.invalid'});
 await assert.rejects(withHomeEmailVerificationRepository(a.repository,'other',()=>undefined),code('SINGLE_USE_TOKEN_SCOPE'));
 await a.run(async()=>{await assert.rejects(other.repository.find(token.token),code('SINGLE_USE_TOKEN_SCOPE'));});
});
test('scope expires before detached or queued work; native insertion rejects malformed credentials',async t=>{
 const f=await fixture(t),a=await f.open();
 await assert.rejects(a.repository.find('unknown'),code('SINGLE_USE_TOKEN_SCOPE'));
 let resume!:()=>void,pending!:Promise<unknown>;const gate=new Promise<void>(r=>{resume=r;});
 await a.run(()=>{pending=gate.then(()=>createEmailVerification({userId:'detached',email:'d@example.invalid'}));});
 const rejection=assert.rejects(pending,code('SINGLE_USE_TOKEN_SCOPE'));resume();await rejection;
 let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
 const blocker=a.provider.transaction(async()=>{entered();await held;});await started;
 await a.run(()=>{pending=createEmailVerification({userId:'queued',email:'q@example.invalid'});});
 const queued=assert.rejects(pending,code('SINGLE_USE_TOKEN_SCOPE'));release();await blocker;await queued;
 await a.run(async()=>{
  await assert.rejects(a.repository.insert({token:'malformed',userId:'owner',email:'a@example.invalid',schemaVersion:2,createdAt:new Date(),expiresAt:new Date(),consumedAt:null}),code('SINGLE_USE_TOKEN_RECORD'));
 });
 await a.run(async()=>{await assert.rejects(createPasswordReset({userId:'owner',email:'a@example.invalid'}),code('SINGLE_USE_TOKEN_SCOPE'));await assert.rejects(createSingleUseToken({getCollection:async()=>{throw Error('Must not reach Mongo');},schemaVersion:2,userId:'owner',email:'a@example.invalid',expiresInMs:60000}),code('SINGLE_USE_TOKEN_SCOPE'));});
 const auth=await createNativeHomeAuthRepositories(a.provider,'home');
 await auth.run(async()=>{await assert.rejects(async()=>createEmailVerification({userId:'owner',email:'a@example.invalid'}),code('SINGLE_USE_TOKEN_SCOPE'));});
 const rows=await a.provider.transaction(s=>s.collection(physicalCollectionName('emailVerifications')).find({limit:1}).documents);assert.equal(rows.length,0);
});
const child=(request:Record<string,unknown>)=>new Promise<any>((resolve,reject)=>{
 const process=spawn(globalThis.process.execPath,['--import','tsx',fileURLToPath(new URL('./nativeSingleUseTokens.restart.fixture.mts',import.meta.url))],{cwd:fileURLToPath(new URL('../../../../',import.meta.url)),stdio:['pipe','pipe','pipe']});
 let output='';process.stdout.on('data',chunk=>{output+=chunk;});process.stderr.resume();
 const timer=setTimeout(()=>{process.kill('SIGKILL');reject(Error('Restart child deadline'));},15000);
 process.on('error',reject);process.on('exit',status=>{clearTimeout(timer);if(status!==0)return reject(Error('Restart child failed'));try{resolve(JSON.parse(output));}catch{reject(Error('Invalid restart receipt'));}});
 process.stdin.end(JSON.stringify(request));
});
test('separate real Node processes issue and consume once across process restart',async t=>{
 const f=await fixture(t),file=join(f.directory,'restart.sqlite');
 const issued=await child({mode:'issue',file});
 assert.match(issued.token,/^[a-f0-9]{64}$/);
 assert.deepEqual(await child({mode:'consume',file,token:issued.token}),{ok:true,userId:'restart-account',email:'restart@example.invalid'});
 assert.deepEqual(await child({mode:'consume',file,token:issued.token}),{ok:false,reason:'used'});
 const racing=await child({mode:'issue',file});
 const claims=await Promise.all(Array.from({length:4},()=>child({mode:'consume',file,token:racing.token})));
 assert.equal(claims.filter(result=>result.ok===true).length,1);
 assert.equal(claims.filter(result=>result.ok===false&&result.reason==='used').length,3);
});

test('native claim rechecks expiry inside the blocked transaction queue',async t=>{
 const f=await fixture(t),a=await f.open();
 const token=await a.run(()=>createEmailVerification({userId:'expiry-owner',email:'expiry@example.invalid',expiresInMs:80}));
 let release!:()=>void,entered!:()=>void;
 const held=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
 const blocker=a.provider.transaction(async()=>{entered();await held;});await started;
 const consuming=a.run(()=>consumeEmailVerification(token.token));
 await new Promise(r=>setTimeout(r,110));release();await blocker;
 assert.deepEqual(await consuming,{ok:false,reason:'expired'});
 await a.run(async()=>assert.equal((await a.repository.find(token.token))!.consumedAt,null));
});

test('scope exiting after a collection mutation rolls the native transaction back',async t=>{
 const f=await fixture(t),a=await f.open();let inserted=()=>{};
 const observed:CollectionProvider={
  transaction(work){return a.provider.transaction(session=>work({...session,collection(name){
   const collection=session.collection(name);
   return {...collection,insert(bytes){collection.insert(bytes);inserted();}};
  }}));},close(){return a.provider.close();}
 };
 const repository=await createNativeEmailVerificationRepository(observed,'home');
 let leave!:()=>void,pending!:Promise<unknown>;const untilMutation=new Promise<void>(resolve=>{leave=resolve;});
 inserted=leave;
 await withHomeEmailVerificationRepository(repository,'home',()=>{
  pending=createEmailVerification({userId:'must-roll-back',email:'rollback@example.invalid'});
  return untilMutation;
 });
 await assert.rejects(pending,code('SINGLE_USE_TOKEN_SCOPE'));
 const rows=await a.provider.transaction(s=>s.collection(physicalCollectionName('emailVerifications')).find({limit:1}).documents);
 assert.equal(rows.length,0);
});

test('matching home labels cannot bind token reads/writes to a different SQLite provider',async t=>{
 const f=await fixture(t),a=await f.open('a.sqlite','home'),b=await f.open('b.sqlite','home');
 const authA=await createNativeHomeAuthRepositories(a.provider,'home');
 const token=await a.run(()=>createEmailVerification({userId:'owner-a',email:'a@example.invalid'}));
 await authA.run(async()=>{
  await assert.rejects(withHomeEmailVerificationRepository(b.repository,'home',()=>consumeEmailVerification(token.token)),code('HOME_REPOSITORY_SCOPE'));
  await assert.rejects(withHomeEmailVerificationRepository(b.repository,'home',()=>createEmailVerification({userId:'foreign',email:'f@example.invalid'})),code('HOME_REPOSITORY_SCOPE'));
  await withHomeEmailVerificationRepository(a.repository,'home',async()=>{
   assert.deepEqual(await consumeEmailVerification(token.token),{ok:true,userId:'owner-a',email:'a@example.invalid'});
  });
 });
 // Recheck an identity binding installed after the token scope was entered.
 await b.run(()=>authA.run(async()=>{
  await assert.rejects(consumeEmailVerification(token.token),code('HOME_REPOSITORY_SCOPE'));
  await assert.rejects(createEmailVerification({userId:'foreign',email:'f@example.invalid'}),code('HOME_REPOSITORY_SCOPE'));
 }));
 const rows=await b.provider.transaction(s=>s.collection(physicalCollectionName('emailVerifications')).find({limit:1}).documents);
 assert.equal(rows.length,0);
});
