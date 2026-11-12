import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BSON,Binary} from 'mongodb';
import {createUserAccount} from '../auth/registerUser';
import {createSession} from '../auth/sessions';
import {resolveSessionUser} from '../auth/getCurrentUser';
import {fromBin,toBin} from '../auth/binary';
import {characterEntitlementSource,synchronizeCharacterStorageTier} from '../auth/characterEntitlements';
import {getSubscription,getSubscriptions} from '../subscriptions/subscriptions';
import {withHomeSubscriptionRepository} from '../subscriptions/subscriptionRepository';
import {subscriptionShareId} from '../subscriptions/subscriptionIdentity';
import {physicalCollectionName} from '../mongodb/collectionNames';
import {applyUserStorageDelta} from '../storage/userStorage';
import {thingStorageSizeBytes} from '../storage/storageCore';
import {withNativeHomeStorageTransaction} from './nativeUserStorage';
import {createCollectionProvider} from './collectionProvider';
import {openSqliteDocumentStore} from './sqliteStore';
import {createNativeAccountCreationRepositories} from './nativeAccountCreation';
import {createNativeSubscriptionRepository} from './nativeSubscriptions';
import type {CollectionProvider} from './collectionContract';
const namespace=physicalCollectionName('things'),code=(expected:string)=>(error:unknown)=>(error as {code?:string})?.code===expected;
const fixture=async(t:TestContext)=>{
 const directory=await mkdtemp(join(tmpdir(),'thingtime-native-subscription-')),providers:CollectionProvider[]=[];
 t.after(async()=>{await Promise.all(providers.map(p=>p.close()));await rm(directory,{recursive:true,force:true});});
 return async(name='home.sqlite')=>{
  const provider=createCollectionProvider(await openSqliteDocumentStore(join(directory,name)));providers.push(provider);
  const auth=await createNativeAccountCreationRepositories(provider,'home'),repository=await createNativeSubscriptionRepository(provider,'home');
  return{provider,auth,repository,run:<T>(work:()=>T|Promise<T>)=>auth.run(()=>withHomeSubscriptionRepository(repository,work))};
 };
};
const account=async(f:any,name='subscription-owner',allowance=8192)=>f.run(async()=>{const result=await createUserAccount({username:name,email:name+'@example.invalid',password:'Disposable projection fixture',storageAllowanceBytes:allowance});assert.equal(result.ok,true);if(!result.ok)throw Error('Canonical account creation refused');return result.user;});
const patch=async(f:any,id:string,updates:any[])=>f.provider.transaction((s:any)=>s.collection(namespace).updateOne({op:'eq',path:['shareId'],value:id},updates));
const read=async(f:any,id:string)=>f.provider.transaction((s:any)=>{const bytes=s.collection(namespace).find({filter:{op:'eq',path:['shareId'],value:id},limit:1}).documents[0];return bytes?BSON.deserialize(bytes):null;});
const privateState=async(f:any,id:string,mutate:(state:any)=>void)=>f.run(async()=>{const snapshot=await f.auth.identities.readUserSecure(id);assert.ok(snapshot);const state=JSON.parse(fromBin(snapshot!.stored.secure));mutate(state);assert.equal(await f.auth.identities.replaceUserSecure(snapshot!,toBin(JSON.stringify(state)),new Date()),true);});

test('canonical native subscription/session projection survives reopen and reports actual canonical accounting',async t=>{
 const open=await fixture(t),a=await open(),user=await account(a);let jti='';
 await a.run(async()=>{
  const subscription=await getSubscription('user',user._id);assert.equal(subscription.storage!.status,'ready');assert.equal(subscription.storage!.usedBytes,0);assert.equal(subscription.effective.userStorageBytes,8192);
  jti=(await createSession(user._id)).jti;const projected=await resolveSessionUser(jti,user._id);assert.equal(projected?.id,user._id);assert.equal(projected?.storageAccountingReady,true);
 });
 const content={_id:'synthetic-content',shareId:'synthetic-content',ownerId:user._id,thingtime:['data'],crystal:{text:'Native entitlement bytes'}};const bytes=thingStorageSizeBytes(content);
 await withNativeHomeStorageTransaction(a.provider,{ownerId:user._id,homePlaneId:'home',contentPlaneId:'home'},async(session,collections)=>{await applyUserStorageDelta(user._id,bytes,session);collections.collection(namespace).insert(BSON.serialize(content));});
 await a.provider.close();const b=await open();await b.run(async()=>{const projected=await resolveSessionUser(jti,user._id);assert.equal(projected?.storageUsedBytes,bytes);assert.equal(projected?.storageRemainingBytes,8192-bytes);assert.equal((await getSubscription('user',user._id)).storage!.usedBytes,(await read(b,subscriptionShareId('user',user._id))).crystal.storageUsedBytes);});
});
test('canonical batch projection preserves requested order/dedup with one provider transaction',async t=>{
 const open=await fixture(t),a=await open(),first=await account(a,'batch-first'),second=await account(a,'batch-second');
 const original=a.provider.transaction.bind(a.provider);let calls=0;t.mock.method(a.provider,'transaction',((work:any)=>{calls++;return original(work);}) as typeof a.provider.transaction);
 await a.run(async()=>{calls=0;const map=await getSubscriptions('user',[second._id,first._id,second._id]);assert.deepEqual([...map.keys()],[second._id,first._id]);assert.equal(calls,1);});
});
test('missing/squatted/hostile ledgers refuse without signup-default or zero grants',async t=>{
 const open=await fixture(t),a=await open(),user=await account(a),ledger=subscriptionShareId('user',user._id);
 assert.ok((await read(a,user._id)).initialSubscription);
 for(const update of [[{op:'set',path:['ownerId'],value:'foreign'}],[{op:'set',path:['acl'],value:['tt:all']}],[{op:'set',path:['unexpectedPrivatePayload'],value:'must-not-project'}]]){
  const prior=await read(a,ledger);await patch(a,ledger,update);await a.run(()=>assert.rejects(getSubscription('user',user._id),code('SUBSCRIPTION_UNAVAILABLE')));
  await a.provider.transaction(s=>{s.collection(namespace).deleteOne({op:'eq',path:['shareId'],value:ledger});s.collection(namespace).insert(BSON.serialize(prior));});
 }
 await a.provider.transaction(s=>s.collection(namespace).deleteOne({op:'eq',path:['shareId'],value:ledger}));
 await a.run(async()=>{await assert.rejects(getSubscription('user',user._id),code('SUBSCRIPTION_UNAVAILABLE'));await assert.rejects(getSubscriptions('user',[user._id]),code('SUBSCRIPTION_UNAVAILABLE'));await assert.rejects(getSubscription('app','missing'),code('SUBSCRIPTION_UNAVAILABLE'));});
});
test('trusted envelopes with missing/stale counters retain canonical unavailable status and null public counts',async t=>{
 const open=await fixture(t),a=await open(),user=await account(a),ledger=subscriptionShareId('user',user._id);
 await patch(a,ledger,[{op:'unset',path:['crystal','storageUsedBytes']}]);
 await a.run(async()=>{const sub=await getSubscription('user',user._id);assert.equal(sub.storage!.status,'unavailable');assert.equal(sub.storage!.usedBytes,null);const session=await createSession(user._id);const projected=await resolveSessionUser(session.jti,user._id);assert.equal(projected?.storageUsedBytes,null);assert.equal(projected?.storageAccountingReady,false);});
 await patch(a,ledger,[{op:'set',path:['crystal','storageUsedBytes'],value:17},{op:'set',path:['crystal','storageAccountingVersion'],value:0}]);
 await a.run(async()=>{const sub=await getSubscription('user',user._id);assert.equal(sub.storage!.status,'unavailable');assert.equal(sub.storage!.usedBytes,null);});
});
test('one private Character owner hop inherits only entitlement fields and preserves own usage/note across reopen',async t=>{
 const open=await fixture(t),a=await open(),owner=await account(a,'character-owner',5000),character=await account(a,'character-child',80);
 // Synthetic Character-policy fixture via the genuine secure CAS. Native
 // Character provisioning/mutation API and content admission remain unproved.
 await privateState(a,character._id,state=>{state.meta.character={ownerId:owner._id,loginMode:'switch',disabled:false};});
 await patch(a,subscriptionShareId('user',owner._id),[{op:'set',path:['crystal','storageUsedBytes'],value:71},{op:'set',path:['crystal','note'],value:'owner-private-note'}]);
 await patch(a,subscriptionShareId('user',character._id),[{op:'set',path:['crystal','storageUsedBytes'],value:7},{op:'set',path:['crystal','note'],value:'own-note'}]);
 await a.provider.close();const b=await open();await b.run(async()=>{
  const source=await characterEntitlementSource(character._id);assert.equal(source?.ownerId,owner._id);
  const sub=await getSubscription('user',character._id);assert.equal(sub.subjectId,character._id);assert.equal(sub.effective.userStorageBytes,5000);assert.equal(sub.storage!.usedBytes,7);assert.equal(sub.storage!.remainingBytes,4993);assert.equal(sub.note,'own-note');assert.equal(JSON.stringify(sub).includes('owner-private-note'),false);
  const session=await createSession(character._id),publicUser=await resolveSessionUser(session.jti,character._id);assert.equal(publicUser?.isCharacter,true);assert.equal(publicUser?.storageUsedBytes,7);
  await assert.rejects(synchronizeCharacterStorageTier(character._id,{}),code('SUBSCRIPTION_UNAVAILABLE'));
 });
});
test('disabled/nested/temporary/service/missing/corrupt owners cannot grant inherited allowance',async t=>{
 const open=await fixture(t),a=await open(),owner=await account(a,'restricted-owner',5000),child=await account(a,'restricted-child',80);
 await privateState(a,child._id,state=>{state.meta.character={ownerId:owner._id,loginMode:'inherit',disabled:false};});
 for(const mutation of [(s:any)=>{s.meta.temporary=true;},(s:any)=>{s.accountKind='service';},(s:any)=>{s.meta.character={ownerId:child._id,loginMode:'inherit',disabled:false};}]){
  const baseline=JSON.parse(fromBin((await read(a,owner._id)).secure));await privateState(a,owner._id,mutation);
  await a.run(async()=>{assert.equal(await characterEntitlementSource(child._id),null);await assert.rejects(getSubscription('user',child._id),code('SUBSCRIPTION_UNAVAILABLE'));});
  await patch(a,owner._id,[{op:'set',path:['secure'],value:toBin(JSON.stringify(baseline))}]);
 }
 const ownerLedger=subscriptionShareId('user',owner._id);
 await patch(a,ownerLedger,[{op:'set',path:['ownerId'],value:'foreign'}]);
 await a.run(async()=>{assert.equal(await characterEntitlementSource(child._id),null);await assert.rejects(getSubscription('user',child._id),code('SUBSCRIPTION_UNAVAILABLE'));});
 await patch(a,ownerLedger,[{op:'set',path:['ownerId'],value:owner._id}]);
 await privateState(a,child._id,state=>{state.meta.character.disabled=true;});await a.run(()=>assert.rejects(getSubscription('user',child._id),code('SUBSCRIPTION_UNAVAILABLE')));
 await privateState(a,child._id,state=>{state.meta.character.disabled=false;state.meta.character.ownerId='missing-owner';});await a.run(()=>assert.rejects(getSubscription('user',child._id),code('SUBSCRIPTION_UNAVAILABLE')));
 await privateState(a,child._id,state=>{state.meta.character.ownerId=owner._id;});await patch(a,owner._id,[{op:'set',path:['secure'],value:new Binary(Buffer.from('invalid JSON'))}]);
 await a.run(async()=>{assert.equal(await characterEntitlementSource(child._id),null);await assert.rejects(getSubscription('user',child._id),code('SUBSCRIPTION_UNAVAILABLE'));});
});
test('same-label different providers, missing bindings, saved calls and queued expired scopes refuse',async t=>{
 const open=await fixture(t),a=await open('a.sqlite'),b=await open('b.sqlite'),user=await account(a);let entered=false;
 await a.auth.run(()=>assert.rejects(withHomeSubscriptionRepository(b.repository,()=>{entered=true;return getSubscription('user',user._id);}),code('HOME_REPOSITORY_SCOPE')));assert.equal(entered,false);
 await a.auth.run(()=>assert.rejects(getSubscription('user',user._id),code('SUBSCRIPTION_REPOSITORY_SCOPE')));
 await assert.rejects(a.repository.readUserEntitlements([user._id]),code('SUBSCRIPTION_REPOSITORY_SCOPE'));
 let start!:()=>void,release!:()=>void,pending!:Promise<unknown>;const started=new Promise<void>(r=>{start=r;}),gate=new Promise<void>(r=>{release=r;});
 const blocker=a.provider.transaction(async()=>{start();await gate;});await started;
 await a.run(()=>{pending=a.repository.readUserEntitlements([user._id]);});const rejected=assert.rejects(pending,code('SUBSCRIPTION_REPOSITORY_SCOPE'));release();await blocker;await rejected;
});
test('native read snapshots freeze requested identities and refuse hostile accessor arrays without execution',async t=>{
 const open=await fixture(t),a=await open(),user=await account(a);let executed=false;
 await a.run(async()=>{
  const hostile=Object.defineProperty([],'0',{enumerable:true,get(){executed=true;return user._id;}});await assert.rejects(a.repository.readUserEntitlements(hostile),code('SUBSCRIPTION_UNAVAILABLE'));
  let start!:()=>void,release!:()=>void;const started=new Promise<void>(r=>{start=r;}),gate=new Promise<void>(r=>{release=r;});
  const blocker=a.provider.transaction(async()=>{start();await gate;});await started;const ids=[user._id],pending=a.repository.readUserEntitlements(ids);ids[0]='changed-after-admission';release();await blocker;const result=await pending;assert.equal(result.users.has(user._id),true);assert.equal(result.users.has(ids[0]),false);
 });assert.equal(executed,false);
});

test('hosted single/batch subscription and Character-read Mongo operations/projections remain compatible without native imports',async()=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{fileURLToPath}=await import('node:url');
 const {stdout}=await promisify(execFile)(process.execPath,['--experimental-test-module-mocks','--import','tsx',fileURLToPath(new URL('./nativeSubscriptions.mongo.fixture.mts',import.meta.url))],{cwd:fileURLToPath(new URL('../../../../',import.meta.url)),timeout:30000,maxBuffer:16384});assert.match(stdout,/hosted-subscription-operations-ok/);
});
