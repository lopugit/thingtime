import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BSON,ObjectId} from 'mongodb';
import {createCollectionProvider} from './collectionProvider';
import {openSqliteDocumentStore} from './sqliteStore';
import {createNativeHomeAuthRepositories} from './nativeUserIdentities';
import {createNativeEmailVerificationRepository} from './nativeSingleUseTokens';
import {withHomeEmailVerificationRepository} from '../auth/singleUseTokenRepository';
import {createEmailVerification,completeEmailVerification,consumeEmailVerification} from '../auth/emailVerifications';
import {insertUser,findUserById,markEmailVerified,type UserDoc} from '../auth/users';
import {physicalCollectionName} from '../mongodb/collectionNames';
import {NATIVE_HOME_HOST_KEY} from './nativeHomeSelection';
import type {CollectionProvider,NativeCollection} from './collectionContract';
const code=(expected:string)=>(error:unknown)=>(error as {code?:string})?.code===expected;
const user=(name='completion'):UserDoc=>({ttid:name,username:name,email:`${name}@example.invalid`,passwordHash:'synthetic-not-a-login',displayName:'Synthetic',emailVerified:false,meta:{},createdAt:new Date(),updatedAt:new Date()});
const fixture=async(t:TestContext)=>{
 const directory=await mkdtemp(join(tmpdir(),'thingtime-verification-completion-')),stores:CollectionProvider[]=[];
 t.after(async()=>{await Promise.all(stores.map(s=>s.close()));await rm(directory,{recursive:true,force:true});});
 return{async open(file='home.sqlite'){
  const base=createCollectionProvider(await openSqliteDocumentStore(join(directory,file)));stores.push(base);
  const hooks={failSecure:false,onSecure:()=>{},beforeSecure:(_collection:NativeCollection)=>{}};
  const provider:CollectionProvider={transaction(work){return base.transaction(s=>work({...s,collection(name){
   const collection=s.collection(name);
   return{...collection,updateOne(filter,updates){
    const secure=name===physicalCollectionName('things')&&updates.some(update=>update.path[0]==='secure');
    if(secure&&hooks.failSecure){hooks.failSecure=false;throw Error('injected canonical secure write failure');}
    if(secure)hooks.beforeSecure(collection);
    const result=collection.updateOne(filter,updates);if(secure)hooks.onSecure();return result;
   }};
  }}));},close(){return base.close();}};
  const auth=await createNativeHomeAuthRepositories(provider,'home'),repository=await createNativeEmailVerificationRepository(provider,'home');
  return{base,provider,hooks,auth,repository,run:<T>(work:()=>T|Promise<T>)=>auth.run(()=>withHomeEmailVerificationRepository(repository,'home',work))};
 }};
};
test('failed canonical mark leaves durable pending proof, retry after SQLite reopen completes once',async t=>{
 const f=await fixture(t),a=await f.open();
 const owner=await a.run(()=>insertUser(user()));const proof=await a.run(()=>createEmailVerification({userId:String(owner._id),email:owner.email}));
 a.hooks.failSecure=true;await assert.rejects(a.run(()=>completeEmailVerification(proof.token)),/injected canonical secure write failure/);assert.equal(a.hooks.failSecure,false);
 await a.run(async()=>{assert.equal((await findUserById(String(owner._id))).emailVerified,false);assert.equal((await a.repository.find(proof.token) as any).completionState,'pending');});
 await a.base.close();const b=await f.open();
 assert.deepEqual(await b.run(()=>completeEmailVerification(proof.token)),{ok:true,userId:String(owner._id),email:owner.email});
 await b.run(async()=>{assert.equal((await findUserById(String(owner._id))).emailVerified,true);assert.equal((await b.repository.find(proof.token) as any).completionState,'completed');});
 assert.deepEqual(await b.run(()=>completeEmailVerification(proof.token)),{ok:false,reason:'used'});
});
test('concurrent completion has one success and all successful replays refuse',async t=>{
 const f=await fixture(t),a=await f.open();const owner=await a.run(()=>insertUser(user()));const proof=await a.run(()=>createEmailVerification({userId:String(owner._id),email:owner.email}));
 const results=await Promise.all(Array.from({length:8},()=>a.run(()=>completeEmailVerification(proof.token))));
 assert.equal(results.filter(r=>r.ok===true).length,1);assert.equal(results.filter(r=>r.ok===false&&r.reason==='used').length,7);
 await a.run(async()=>assert.equal((await findUserById(String(owner._id))).emailVerified,true));
});
test('missing native owner never touches Mongo; stale email proof cannot verify another address or owner',async t=>{
 const f=await fixture(t),a=await f.open();const owner=await a.run(()=>insertUser(user('current'))),missing=new ObjectId().toHexString();
 const previous=Object.getOwnPropertyDescriptor(globalThis,NATIVE_HOME_HOST_KEY);Object.defineProperty(globalThis,NATIVE_HOME_HOST_KEY,{configurable:true,value:{synthetic:true}});
 try{
  await a.run(async()=>{
   assert.equal(await markEmailVerified(missing,'missing@example.invalid'),false); // Any Mongo fallback throws at the native selection fence.
   const unknown=await createEmailVerification({userId:missing,email:'missing@example.invalid'});assert.deepEqual(await completeEmailVerification(unknown.token),{ok:false,reason:'invalid'});
   const stale=await createEmailVerification({userId:String(owner._id),email:'previous-address@example.invalid'});assert.deepEqual(await completeEmailVerification(stale.token),{ok:false,reason:'invalid'});
   assert.equal(await markEmailVerified(String(owner._id),'previous-address@example.invalid'),false);
   assert.equal((await findUserById(String(owner._id))).emailVerified,false);
  });
 }finally{if(previous)Object.defineProperty(globalThis,NATIVE_HOME_HOST_KEY,previous);else delete (globalThis as any)[NATIVE_HOME_HOST_KEY];}
});
test('pending proof expires at original deadline and legacy consume-only burns are never resurrected',async t=>{
 const f=await fixture(t),a=await f.open();const owner=await a.run(()=>insertUser(user()));
 const proof=await a.run(()=>createEmailVerification({userId:String(owner._id),email:owner.email,expiresInMs:70}));
 a.hooks.failSecure=true;await assert.rejects(a.run(()=>completeEmailVerification(proof.token)),/injected canonical secure write failure/);
 await new Promise(r=>setTimeout(r,100));assert.deepEqual(await a.run(()=>completeEmailVerification(proof.token)),{ok:false,reason:'expired'});
 await a.run(async()=>{
  assert.equal((await findUserById(String(owner._id))).emailVerified,false);
  const legacy=await createEmailVerification({userId:String(owner._id),email:owner.email});assert.equal((await consumeEmailVerification(legacy.token)).ok,true);
  assert.deepEqual(await completeEmailVerification(legacy.token),{ok:false,reason:'used'});
  const stored=(await a.repository.find(legacy.token))!;assert.deepEqual(await completeEmailVerification(stored.token),{ok:false,reason:'invalid'});
 });
});
test('same-label foreign provider and absent native identity refuse completion',async t=>{
 const f=await fixture(t),a=await f.open('a.sqlite'),b=await f.open('b.sqlite');const owner=await a.run(()=>insertUser(user()));const proof=await a.run(()=>createEmailVerification({userId:String(owner._id),email:owner.email}));
 await assert.rejects(withHomeEmailVerificationRepository(a.repository,'home',()=>completeEmailVerification(proof.token)),code('SINGLE_USE_TOKEN_SCOPE'));
 await b.auth.run(async()=>{await assert.rejects(withHomeEmailVerificationRepository(a.repository,'home',()=>completeEmailVerification(proof.token)),code('HOME_REPOSITORY_SCOPE'));});
 assert.equal((await a.run(()=>completeEmailVerification(proof.token))).ok,true);
});
test('scope exit after canonical user commit leaves pending and the same proof can finalize in a fresh request',async t=>{
 const f=await fixture(t),a=await f.open();const owner=await a.run(()=>insertUser(user()));const proof=await a.run(()=>createEmailVerification({userId:String(owner._id),email:owner.email}));
 let leave!:()=>void,pending!:Promise<unknown>;const markMutation=new Promise<void>(r=>{leave=r;});a.hooks.onSecure=leave;
 await a.auth.run(async()=>{
  await withHomeEmailVerificationRepository(a.repository,'home',()=>{pending=completeEmailVerification(proof.token);return markMutation;});
  await assert.rejects(pending,code('SINGLE_USE_TOKEN_SCOPE'));
  assert.equal((await findUserById(String(owner._id))).emailVerified,true);
 });
 a.hooks.onSecure=()=>{};await a.run(async()=>{assert.equal((await a.repository.find(proof.token) as any).completionState,'pending');});
 assert.equal((await a.run(()=>completeEmailVerification(proof.token))).ok,true);
 assert.deepEqual(await a.run(()=>completeEmailVerification(proof.token)),{ok:false,reason:'used'});
});

test('canonical secure CAS retry refuses a proof after a concurrent address change',async t=>{
 const f=await fixture(t),a=await f.open();
 const owner=await a.run(()=>insertUser(user('old-address'))),newAddress=await a.run(()=>insertUser(user('new-address')));
 const proof=await a.run(()=>createEmailVerification({userId:String(owner._id),email:owner.email}));
 const canonicalReplacement=await a.run(()=>a.auth.identities.findUserThingById(String(newAddress._id)));
 let raced=false;
 a.hooks.beforeSecure=collection=>{
  a.hooks.beforeSecure=()=>{};raced=true;
  // Fixture-only concurrent writer uses bytes produced by canonical insertUser;
  // production completion never constructs or patches a secure payload.
  const bytes=collection.find({filter:{op:'eq',path:['shareId'],value:String(owner._id)},limit:1}).documents[0];
  const current=BSON.deserialize(bytes);
  collection.updateOne({op:'eq',path:['shareId'],value:String(owner._id)},[
   {op:'set',path:['secure'],value:canonicalReplacement!.secure},
   {op:'set',path:['secureVersion'],value:(current.secureVersion??0)+1}
  ]);
 };
 assert.deepEqual(await a.run(()=>completeEmailVerification(proof.token)),{ok:false,reason:'invalid'});assert.equal(raced,true);
 await a.run(async()=>{const current=await findUserById(String(owner._id));assert.equal(current.email,newAddress.email);assert.equal(current.emailVerified,false);});
});

test('hosted consume then mark order and legacy failure/replay behavior stay unchanged',async()=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{fileURLToPath}=await import('node:url');
 const {stdout}=await promisify(execFile)(process.execPath,['--experimental-test-module-mocks','--import','tsx',fileURLToPath(new URL('./nativeVerificationCompletion.mongo.fixture.mts',import.meta.url))],{cwd:fileURLToPath(new URL('../../../../',import.meta.url)),timeout:15000,maxBuffer:16384,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR}});
 assert.match(stdout,/hosted-email-completion-order-preserved/);
});
