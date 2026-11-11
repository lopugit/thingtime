import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BSON} from 'mongodb';
import {createUserAccount,registerUser} from '../auth/registerUser';
import {verifyPassword} from '../auth/passwords';
import {insertUser,findUserByUsername} from '../auth/users';
import {setSubscription} from '../subscriptions/subscriptions';
import {getLiveSubscriptionTier,createSubscriptionTierDraft} from '../subscriptions/tierCatalogStore';
import {SUBSCRIPTION_TIER_CATALOG,DEFAULT_SUBSCRIPTION_TIER} from '../subscriptions/tierCatalog';
import {subscriptionShareId,userSubscriptionLedgerEnvelopeIsTrusted} from '../subscriptions/subscriptionIdentity';
import {applyUserStorageDelta} from '../storage/userStorage';
import {thingStorageSizeBytes} from '../storage/storageCore';
import {physicalCollectionName} from '../mongodb/collectionNames';
import {createCollectionProvider} from './collectionProvider';
import {openSqliteDocumentStore} from './sqliteStore';
import {createNativeAccountCreationRepositories} from './nativeAccountCreation';
import {withNativeHomeStorageTransaction} from './nativeUserStorage';
import type {CollectionProvider} from './collectionContract';
const namespace=physicalCollectionName('things'),plane='isolated-home';
const input=(username='synthetic-account',email=`${username}@example.invalid`)=>({username,password:'Disposable fixture-only phrase',email});
const code=(expected:string)=>(error:unknown)=>(error as {code?:string})?.code===expected;
const fixture=async(t:TestContext)=>{
 const directory=await mkdtemp(join(tmpdir(),'thingtime-native-account-')),providers:CollectionProvider[]=[];
 t.after(async()=>{await Promise.all(providers.map(p=>p.close()));await rm(directory,{recursive:true,force:true});});
 return async(name='home.sqlite')=>{
  const provider=createCollectionProvider(await openSqliteDocumentStore(join(directory,name)));providers.push(provider);
  const auth=await createNativeAccountCreationRepositories(provider,plane);
  const rows=()=>provider.transaction(s=>s.collection(namespace).find({limit:1000}).documents.map(bytes=>BSON.deserialize(bytes)));
  return {provider,...auth,rows};
 };
};
// Canonical createUserAccount creates all successful accounts here. These are
// real-file module integration tests, not Nitro registration or native rollout.
test('real canonical creation normalizes, hashes and atomically issues a trusted ready ledger; reopen admits canonical accounting',async t=>{
 const open=await fixture(t),a=await open();let owner='';
 await a.run(async()=>{
  const supplied={...input(' Mixed-Case ',' MIXED@EXAMPLE.INVALID '),meta:{admin:true,publicUploads:true,privateUploads:true,character:{ownerId:'foreign'},safe:'preserved'}};
  const created=await createUserAccount(supplied);assert.equal(created.ok,true);if(!created.ok)return;
  owner=String(created.user._id);assert.equal(created.user.username,'mixed-case');assert.equal(created.user.email,'mixed@example.invalid');assert.equal(await verifyPassword(supplied.password,created.user.passwordHash),true);
  assert.equal(created.user.meta.admin,false);assert.equal(created.user.meta.publicUploads,false);assert.equal(created.user.meta.privateUploads,false);assert.equal(created.user.meta.character,undefined);assert.equal(created.user.meta.safe,'preserved');
  assert.equal(created.publicUser.storage.status,'ready');assert.equal(created.publicUser.storage.usedBytes,0);
  const ledger=(await a.rows()).find(row=>row.shareId===subscriptionShareId('user',owner));assert.ok(userSubscriptionLedgerEnvelopeIsTrusted(ledger,owner));assert.equal(ledger.ownerId,owner);assert.equal(ledger.crystal.storageUsedBytes,0);
 });
 await a.provider.close();const b=await open();
 await b.run(async()=>assert.equal((await findUserByUsername('MIXED-CASE'))._id,owner));
 const content={_id:'synthetic-module-content',shareId:'synthetic-module-content',ownerId:owner,thingtime:['data'],crystal:{text:'真实 local content'}};
 const bytes=thingStorageSizeBytes(content);
 await withNativeHomeStorageTransaction(b.provider,{ownerId:owner,homePlaneId:plane,contentPlaneId:plane},async(session,collections)=>{await applyUserStorageDelta(owner,bytes,session);collections.collection(namespace).insert(BSON.serialize(content));});
 const stored=(await b.rows()).find(row=>row.shareId===subscriptionShareId('user',owner));assert.equal(stored.crystal.storageUsedBytes,bytes);
});
test('concurrent canonical username/email claims have exactly one complete account and a409 loser across handles',async t=>{
 const open=await fixture(t),a=await open(),b=await open();
 for(const entries of [[input('race-name','one@example.invalid'),input('RACE-NAME','two@example.invalid')],[input('race-one','shared@example.invalid'),input('race-two','SHARED@example.invalid')]]){
  const results=await Promise.all([a,b].map((f,i)=>f.run(()=>createUserAccount(entries[i]))));assert.equal(results.filter(r=>r.ok).length,1);const loser=results.find(r=>!r.ok);assert.equal(loser?.ok,false);if(loser?.ok===false)assert.equal(loser.status,409);
 }
 const rows=await a.rows();assert.equal(rows.filter(r=>r.thingtime.includes('user')).length,2);assert.equal(rows.filter(r=>r.thingtime.includes('subscription')).length,2);
});
test('canonical allowance refusal rolls back identity and ledger together',async t=>{
 const open=await fixture(t),a=await open();
 await a.run(async()=>{const result=await createUserAccount({...input(),storageAllowanceBytes:NaN});assert.equal(result.ok,false);assert.equal(await findUserByUsername(input().username),null);});
 assert.equal((await a.rows()).filter(r=>r.thingtime.includes('user')||r.thingtime.includes('subscription')).length,0);
});
test('unsupported callbacks, Character/service creation and complete registration refuse before any tier/account writes',async t=>{
 const open=await fixture(t),a=await open();let callback=false;
 await a.run(async()=>{
  for(const extra of [{onCreated:async()=>{callback=true;}},{character:{ownerId:'foreign'}},{accountKind:'service'}]){
   const result=await createUserAccount({...input(),...extra} as Parameters<typeof createUserAccount>[0]);assert.equal(result.ok,false);if(!result.ok)assert.equal(result.status,503);
  }
  const registration=await registerUser({...input(),inviteToken:'unsupported-synthetic-invite'});assert.equal(registration.ok,false);if(!registration.ok)assert.equal(registration.status,503);
  await assert.rejects(createSubscriptionTierDraft({},'foreign'),code('ACCOUNT_CREATION_UNSUPPORTED'));
 });assert.equal(callback,false);assert.deepEqual(await a.rows(),[]);
});
test('reserved tier collisions refuse without replacing data or leaving partial catalog/account writes',async t=>{
 const open=await fixture(t),a=await open(),id=SUBSCRIPTION_TIER_CATALOG.at(-1)!.versionId;
 // Deliberate corrupt module fixture; no successful account is seeded directly.
 const occupied={_id:'reserved-occupant',shareId:id,thingtime:['data'],crystal:{marker:'retain'}};
 await a.provider.transaction(s=>s.collection(namespace).insert(BSON.serialize(occupied)));
 await a.run(async()=>{await assert.rejects(createUserAccount(input()),code('ACCOUNT_CREATION_UNSUPPORTED'));});assert.deepEqual(await a.rows(),[occupied]);
});
test('catalog readiness is profile-local and persisted revisions retain canonical content',async t=>{
 const open=await fixture(t),a=await open('a.sqlite'),b=await open('b.sqlite');
 for(const f of [a,b])await f.run(async()=>{const result=await createUserAccount(input());assert.equal(result.ok,true);const tier=await getLiveSubscriptionTier(DEFAULT_SUBSCRIPTION_TIER);assert.equal(tier?.versionId,SUBSCRIPTION_TIER_CATALOG.find(t=>t.id===DEFAULT_SUBSCRIPTION_TIER)!.versionId);});
 for(const f of [a,b])assert.equal((await f.rows()).filter(row=>row.thingtime.includes('subscription-tier')).length,SUBSCRIPTION_TIER_CATALOG.length);
});
test('owner mismatch poisons the complete native account transaction; escaped/fabricated handles cannot issue ledgers',async t=>{
 const open=await fixture(t),a=await open();let escaped:unknown;
 await a.run(async()=>{
  await getLiveSubscriptionTier(DEFAULT_SUBSCRIPTION_TIER);
  await assert.rejects(a.accountCreation.transaction(async handle=>{
   escaped=handle;const saved=await insertUser({...input(),ttid:input().username,passwordHash:'module-only',displayName:null,emailVerified:false,createdAt:new Date(),updatedAt:new Date(),meta:{}},{session:handle});
   await assert.rejects(setSubscription({subjectType:'user',subjectId:String(saved._id),ownerId:'foreign',tier:DEFAULT_SUBSCRIPTION_TIER,initialStorageUsedBytes:0,isDefaultAssignment:true,updatedBy:'system',session:handle}),code('ACCOUNT_CREATION_UNSUPPORTED'));
  }),code('ACCOUNT_CREATION_UNSUPPORTED'));
  for(const session of [escaped,{kind:'native-account-creation'}])await assert.rejects(setSubscription({subjectType:'user',subjectId:'foreign',ownerId:'foreign',tier:DEFAULT_SUBSCRIPTION_TIER,initialStorageUsedBytes:0,isDefaultAssignment:true,updatedBy:'system',session}),code('ACCOUNT_CREATION_SCOPE'));
  assert.equal(await findUserByUsername(input().username),null);
 });
});

test('normal Mongo creation preserves normalization, protected metadata, transaction/onCreated ordering and zero-ledger issuance',async()=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{fileURLToPath}=await import('node:url');
 const {stdout}=await promisify(execFile)(process.execPath,['--experimental-test-module-mocks','--import','tsx',fileURLToPath(new URL('./nativeAccountCreation.mongo.fixture.mts',import.meta.url))],{cwd:fileURLToPath(new URL('../../../../',import.meta.url)),timeout:30000,maxBuffer:16384});assert.match(stdout,/canonical-mongo-account-creation-regression-ok/);
});

test('a live account handle cannot be borrowed by another profile; caught refusal rolls back only the borrower',async t=>{
 const open=await fixture(t),a=await open('a.sqlite'),b=await open('b.sqlite');
 for(const f of [a,b])await f.run(()=>getLiveSubscriptionTier(DEFAULT_SUBSCRIPTION_TIER));
 let enter!:(handle:unknown)=>void,release!:()=>void;const entered=new Promise<unknown>(resolve=>{enter=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const insert=(name:string,session:unknown)=>insertUser({...input(name),ttid:name,passwordHash:'module-only',displayName:null,emailVerified:false,createdAt:new Date(),updatedAt:new Date(),meta:{}},{session});
 const ownerWork=a.run(()=>a.accountCreation.transaction(async handle=>{
  const user=await insert('owner-a',handle);enter(handle);await gate;
  const result=await setSubscription({subjectType:'user',subjectId:user._id,ownerId:user._id,tier:DEFAULT_SUBSCRIPTION_TIER,initialStorageUsedBytes:0,isDefaultAssignment:true,updatedBy:'system',session:handle});assert.equal(result.ok,true);
 }));
 const foreignHandle=await entered;
 try{
  await b.run(()=>assert.rejects(b.accountCreation.transaction(async handle=>{
   const user=await insert('borrower-b',handle);
   await assert.rejects(setSubscription({subjectType:'user',subjectId:user._id,ownerId:user._id,tier:DEFAULT_SUBSCRIPTION_TIER,initialStorageUsedBytes:0,isDefaultAssignment:true,updatedBy:'system',session:foreignHandle}),code('ACCOUNT_CREATION_SCOPE'));
  }),code('ACCOUNT_CREATION_SCOPE')));
 }finally{release();await ownerWork;}
 assert.equal((await a.rows()).filter(row=>row.thingtime.includes('user')).length,1);
 assert.equal((await b.rows()).filter(row=>row.thingtime.includes('user')||row.thingtime.includes('subscription')).length,0);
 await assert.rejects(a.accountCreation.ensureReady(),code('ACCOUNT_CREATION_SCOPE'));
 await assert.rejects(a.accountCreation.findTierVersion(SUBSCRIPTION_TIER_CATALOG[0].versionId),code('ACCOUNT_CREATION_SCOPE'));
});

const createPairInTransaction=async (name:string,handle:unknown)=>{
 const user=await insertUser({...input(name),ttid:name,passwordHash:'module-only',displayName:null,emailVerified:false,createdAt:new Date(),updatedAt:new Date(),meta:{}},{session:handle});
 const assigned=await setSubscription({subjectType:'user',subjectId:user._id,ownerId:user._id,tier:DEFAULT_SUBSCRIPTION_TIER,initialStorageUsedBytes:0,isDefaultAssignment:true,updatedBy:'system',session:handle});assert.equal(assigned.ok,true);return user;
};
test('catching malformed identity admission after a complete pair still rolls back the entire account transaction',async t=>{
 const open=await fixture(t),a=await open();let executed=false;
 await a.run(async()=>{
  await getLiveSubscriptionTier(DEFAULT_SUBSCRIPTION_TIER);
  await assert.rejects(a.accountCreation.transaction(async handle=>{
   await createPairInTransaction('caught-malformed',handle);
   const malformed=Object.defineProperty({shareId:'malformed'},'payload',{enumerable:true,get(){executed=true;return 'must-not-run';}});
   await assert.rejects(a.identities.insertUserThing(malformed,handle));
  }));
  assert.equal(await findUserByUsername('caught-malformed'),null);
 });assert.equal(executed,false);assert.equal((await a.rows()).filter(row=>row.thingtime.includes('user')||row.thingtime.includes('subscription')).length,0);
});
test('completed account writes cannot commit after the owning auth scope exits during an unawaited continuation',async t=>{
 const open=await fixture(t),a=await open();let entered!:()=>void,release!:()=>void,pending!:Promise<unknown>;
 const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 await a.run(async()=>{
  await getLiveSubscriptionTier(DEFAULT_SUBSCRIPTION_TIER);
  pending=a.accountCreation.transaction(async handle=>{await createPairInTransaction('expired-account',handle);entered();await gate;});
  await started;
 });
 const rejection=assert.rejects(pending);release();await rejection;
 await a.run(async()=>assert.equal(await findUserByUsername('expired-account'),null));
});
test('bootstrap preserves the authoritative valid stored tier body and refuses reserved id/version corruption',async t=>{
 const open=await fixture(t),a=await open();
 await a.run(()=>getLiveSubscriptionTier(DEFAULT_SUBSCRIPTION_TIER));
 const id=SUBSCRIPTION_TIER_CATALOG.find(t=>t.id===DEFAULT_SUBSCRIPTION_TIER)!.versionId;
 // Deliberate module compatibility fixture: historical persisted revision body,
 // not an API authoring path or permission to edit a published revision.
 await a.provider.transaction(s=>s.collection(namespace).updateOne({op:'eq',path:['shareId'],value:id},[{op:'set',path:['crystal','title'],value:'Authoritative stored revision'},{op:'set',path:['crystal','quotas','userStorageBytes'],value:8192}]));
 await a.run(async()=>{const result=await createUserAccount(input('stored-tier'));assert.equal(result.ok,true);if(result.ok)assert.equal(result.publicUser.storage.allowanceBytes,8192);const tier=await getLiveSubscriptionTier(DEFAULT_SUBSCRIPTION_TIER);assert.equal(tier!.title,'Authoritative stored revision');assert.equal(tier!.quotas.userStorageBytes,8192);});
 await a.provider.transaction(s=>s.collection(namespace).updateOne({op:'eq',path:['shareId'],value:id},[{op:'increment',path:['crystal','version'],amount:1}]));
 await a.run(async()=>{await assert.rejects(createUserAccount(input('corrupt-tier')),code('ACCOUNT_CREATION_UNSUPPORTED'));assert.equal(await findUserByUsername('corrupt-tier'),null);});
});
