// Executed only by nativeVault.test.ts in a sanitized, disposable process.
// Real canonical account/vault/JWT code and real SQLite; no HTTP readiness claim.
import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Binary,BSON,Long} from 'mongodb';
import {createUserAccount} from '../auth/registerUser.ts';
import {findUserById,markEmailVerified,mutateUserVaultKey,readUserVaultKey} from '../auth/users.ts';
import {hashPassword} from '../auth/passwords.ts';
import {bindVaultPassword,ensureUserVaultKey,resetVaultPassword,encryptUserVaultValue,decryptUserVaultValue} from '../auth/vaultKeys.ts';
import {unwrapVaultKeyWithPassword} from '../auth/vaultEnvelope.ts';
import {withVaultRequest} from '../auth/vaultRequest.ts';
import {fromBin,toBin} from '../auth/binary.ts';
import {createSession,getLiveSession,revokeSession} from '../auth/sessions.ts';
import {signJwt} from '../auth/jwt.ts';
import {createCollectionProvider} from './collectionProvider.ts';
import {openSqliteDocumentStore} from './sqliteStore.ts';
import {createNativeAccountCreationRepositories} from './nativeAccountCreation.ts';
import {physicalCollectionName} from '../mongodb/collectionNames.ts';
import type {CollectionProvider} from './collectionContract.ts';
const password='Disposable native vault phrase',code=(value:string)=>(error:unknown)=>(error as {code?:string})?.code===value;
const fixture=async(t:TestContext)=>{
 const directory=await mkdtemp(join(tmpdir(),'thingtime-native-vault-')),providers:CollectionProvider[]=[];
 t.after(async()=>{await Promise.all(providers.map(p=>p.close()));await rm(directory,{recursive:true,force:true});});
 return async(name='home.sqlite')=>{const provider=createCollectionProvider(await openSqliteDocumentStore(join(directory,name)));providers.push(provider);return{provider,...await createNativeAccountCreationRepositories(provider,'vault-home')};};
};
const account=async(f:any,name='vault-owner')=>f.run(async()=>{const result=await createUserAccount({username:name,email:name+'@example.invalid',password});assert.equal(result.ok,true);if(!result.ok)throw Error('Canonical account creation failed');return result.user;});
const requestFor=async(owner:string,jti:string)=>{const token=await signJwt({sub:owner,jti});return{token,request:new Request('http://127.0.0.1:19761/api/v1/passwords',{headers:{Authorization:'Bearer '+token}})};};
const readRaw=async(f:any,id:string)=>f.provider.transaction((s:any)=>{const bytes=s.collection(physicalCollectionName('things')).find({filter:{op:'eq',path:['shareId'],value:id},limit:1}).documents[0];return bytes?BSON.deserialize(bytes,{promoteValues:false}):null;});

test('canonical password binding, background and JWT session vault access share one stable key across file reopen and revocation',async t=>{
 const open=await fixture(t),a=await open(),user=await account(a);let sealed:any,jti='',token='',request!:Request,keyId='';
 await a.run(async()=>{
  await bindVaultPassword(user._id,password,user.passwordHash);const registry=await readUserVaultKey(user._id);assert.ok(registry?.password);keyId=registry!.keyId;
  const key=await unwrapVaultKeyWithPassword(user._id,password,registry!.password!);assert.equal(key.id,keyId);key.bytes.fill(0);
  sealed=await encryptUserVaultValue(user._id,'synthetic-record','secret','synthetic-value');
  const session=await createSession(user._id);jti=session.jti;({token,request}=await requestFor(user._id,jti));
  assert.equal(await withVaultRequest(request,()=>decryptUserVaultValue(user._id,'synthetic-record','secret',sealed)),'synthetic-value');
  const stored=(await getLiveSession(jti))!;assert.ok(stored.secureVaultKey instanceof Binary);
  const persisted=JSON.stringify(registry)+fromBin(stored.secureVaultKey);assert.equal(persisted.includes(password),false);assert.equal(persisted.includes(token),false);assert.equal(persisted.includes('synthetic-value'),false);
 });
 await a.provider.close();const b=await open();
 await b.run(async()=>{
  assert.equal((await ensureUserVaultKey(user._id)).keyId,keyId);
  assert.equal(await withVaultRequest(request,()=>decryptUserVaultValue(user._id,'synthetic-record','secret',sealed)),'synthetic-value');
  const wrong=await requestFor('different-owner',jti);await assert.rejects(withVaultRequest(wrong.request,()=>decryptUserVaultValue(user._id,'synthetic-record','secret',sealed)));
  await revokeSession(jti);assert.equal(await getLiveSession(jti),null);await assert.rejects(withVaultRequest(request,()=>decryptUserVaultValue(user._id,'synthetic-record','secret',sealed)));
  // Authorized background recovery is deliberately distinct from a browser session.
  assert.equal(await decryptUserVaultValue(user._id,'synthetic-record','secret',sealed),'synthetic-value');
 });
});
test('a controlled secure-CAS race retries without losing a concurrent canonical email-verification write',async t=>{
 const open=await fixture(t),a=await open(),user=await account(a),b=await open();await a.run(()=>ensureUserVaultKey(user._id));
 let enter!:()=>void,release!:()=>void,calls=0;const entered=new Promise<void>(r=>{enter=r;}),gate=new Promise<void>(r=>{release=r;});
 const pending=a.run(()=>mutateUserVaultKey(user._id,async current=>{calls++;if(calls===1){enter();await gate;}return{registry:current!};}));
 await entered;try{await b.run(()=>markEmailVerified(user._id));}finally{release();}await pending;
 assert.equal(calls,2);await a.run(async()=>{assert.equal((await findUserById(user._id)).emailVerified,true);assert.ok(await readUserVaultKey(user._id));});
});
test('canonical password reset preserves encrypted data and atomically fences a stale old-password binding',async t=>{
 const open=await fixture(t),a=await open(),user=await account(a);
 await a.run(async()=>{
  await bindVaultPassword(user._id,password,user.passwordHash);const sealed=await encryptUserVaultValue(user._id,'retained','secret','retained-value'),before=(await readUserVaultKey(user._id))!;
  const replacement='Replacement disposable phrase',hash=await hashPassword(replacement);await resetVaultPassword(user._id,replacement,hash);
  assert.equal((await findUserById(user._id)).passwordHash,hash);const after=(await readUserVaultKey(user._id))!;assert.equal(after.keyId,before.keyId);
  await assert.rejects(unwrapVaultKeyWithPassword(user._id,password,after.password!));const key=await unwrapVaultKeyWithPassword(user._id,replacement,after.password!);assert.equal(key.id,before.keyId);key.bytes.fill(0);
  await assert.rejects(bindVaultPassword(user._id,password,user.passwordHash));assert.equal(await decryptUserVaultValue(user._id,'retained','secret',sealed),'retained-value');
 });
});
test('secure snapshots are request/profile bound, keep private preimages and reject forged Binary hooks',async t=>{
 const open=await fixture(t),a=await open(),user=await account(a),b=await open();let escaped:any,executed=false;
 await a.run(async()=>{
  escaped=await a.identities.readUserSecure(user._id);const payload=fromBin(escaped.stored.secure);
  escaped.stored.secure.buffer.fill(0);assert.equal(await a.identities.replaceUserSecure(escaped,toBin(payload),new Date()),true);
  const stale=(await a.identities.readUserSecure(user._id))!,before=JSON.parse(fromBin(stale.stored.secure));
  await a.provider.transaction(s=>s.collection(physicalCollectionName('things')).updateOne({op:'eq',path:['shareId'],value:user._id},[{op:'set',path:['secure'],value:toBin(JSON.stringify({...before,meta:{...before.meta,externalFence:true}}))}]));
  assert.equal(await a.identities.replaceUserSecure(stale,toBin(JSON.stringify(before)),new Date()),false);
  assert.equal((await findUserById(user._id)).meta.externalFence,true);
  const snapshot=(await a.identities.readUserSecure(user._id))!;
  const forged=Object.create(Binary.prototype);Object.defineProperty(forged,'toBSON',{value(){executed=true;return 'not-admitted';}});
  await assert.rejects(a.identities.replaceUserSecure(snapshot,forged,new Date()),code('UNSUPPORTED_COLLECTION_OPERATION'));
  await assert.rejects(a.identities.readUserSecure(user._id,{}),code('USER_IDENTITY_TRANSACTION_UNSUPPORTED'));
  escaped=snapshot;
 });
 await b.run(()=>assert.rejects(b.identities.replaceUserSecure(escaped,toBin('{}'),new Date()),code('USER_IDENTITY_SCOPE')));
 await a.run(()=>assert.rejects(a.identities.replaceUserSecure(escaped,toBin('{}'),new Date()),code('USER_IDENTITY_SCOPE')));
 assert.equal(executed,false);await a.run(async()=>assert.equal((await findUserById(user._id)).passwordHash,user.passwordHash));
});
test('native secure CAS preserves Long counters, admits absent legacy version and refuses malformed counters',async t=>{
 const open=await fixture(t),a=await open(),user=await account(a),namespace=physicalCollectionName('things');
 const alter=(updates:any)=>a.provider.transaction(s=>s.collection(namespace).updateOne({op:'eq',path:['shareId'],value:user._id},updates));
 await alter([{op:'set',path:['secureVersion'],value:Long.fromNumber(2147483648)}]);await a.run(()=>markEmailVerified(user._id));const typed=await readRaw(a,user._id);assert.ok(typed.secureVersion instanceof Long);assert.equal(typed.secureVersion.toString(),'2147483649');
 await alter([{op:'unset',path:['secureVersion']}]);await a.run(()=>markEmailVerified(user._id));assert.equal(Number((await readRaw(a,user._id)).secureVersion.valueOf()),1);
 await alter([{op:'set',path:['secureVersion'],value:'corrupt'}]);await a.run(()=>assert.rejects(markEmailVerified(user._id),code('USER_IDENTITY_SCOPE')));assert.equal((await readRaw(a,user._id)).secureVersion,'corrupt');
});
test('native session vault binding refuses changed owner/expiry, revoked, expired and scoped sessions without writing authority',async t=>{
 const open=await fixture(t),a=await open(),user=await account(a);
 await a.run(async()=>{
  const live=await createSession(user._id),expired=await createSession(user._id,{expiresAt:new Date(0)}),scoped=await createSession(user._id,{purpose:'pat'}),revoked=await createSession(user._id);await revokeSession(revoked.jti);
  const bind=(session:any,ownerId=user._id,expiresAt=session.expiresAt)=>a.sessions.bindVaultEnvelope({jti:session.jti,ownerId,expiresAt,at:new Date(),envelope:toBin('synthetic-persistence-only')});
  for(const session of [expired,scoped,revoked])assert.equal(await bind(session),false);
  assert.equal(await bind(live,'foreign'),false);assert.equal(await bind(live,user._id,new Date(live.expiresAt!.getTime()+1)),false);
  assert.equal((await getLiveSession(live.jti))!.secureVaultKey,undefined);
  assert.equal(await bind(live),true);await revokeSession(live.jti);assert.equal(await bind(live),false);
 });
});

test('corrupt native recovery data and a foreign account cannot replace or unlock the only persisted key',async t=>{
 const open=await fixture(t),a=await open(),user=await account(a),other=await account(a,'other-vault-owner');
 await a.run(async()=>{
  await bindVaultPassword(user._id,password,user.passwordHash);const sealed=await encryptUserVaultValue(user._id,'protected','secret','protected-value');
  await assert.rejects(decryptUserVaultValue(other._id,'protected','secret',sealed));
  const raw=await readRaw(a,user._id),payload=JSON.parse(fromBin(raw.secure)),keyId=payload.vaultKey.keyId;payload.vaultKey.recovery.tag='invalid';
  await a.provider.transaction(s=>s.collection(physicalCollectionName('things')).updateOne({op:'eq',path:['shareId'],value:user._id},[{op:'set',path:['secure'],value:toBin(JSON.stringify(payload))}]));
  await assert.rejects(encryptUserVaultValue(user._id,'new','secret','must-not-save'));
  assert.equal((await readUserVaultKey(user._id))!.keyId,keyId);assert.equal(JSON.parse(fromBin((await readRaw(a,user._id)).secure)).vaultKey.recovery.tag,'invalid');
 });
});
test('session envelope writes reject hostile inputs and queued work after the request scope closes',async t=>{
 const open=await fixture(t),a=await open(),user=await account(a);let session:any,executed=false,pending!:Promise<unknown>;
 await a.run(async()=>{
  session=await createSession(user._id);
  const hostile=Object.defineProperty({},'jti',{enumerable:true,get(){executed=true;return session.jti;}});
  await assert.rejects(a.sessions.bindVaultEnvelope(hostile as any),code('UNSUPPORTED_COLLECTION_OPERATION'));
 });
 let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>{enter=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const held=a.provider.transaction(async()=>{enter();await gate;});await entered;
 await a.run(()=>{pending=a.sessions.bindVaultEnvelope({jti:session.jti,ownerId:user._id,expiresAt:session.expiresAt,at:new Date(),envelope:toBin('not-admitted')});});
 const rejected=assert.rejects(pending,code('SESSION_REPOSITORY_SCOPE'));release();await held;await rejected;
 await a.run(async()=>assert.equal((await getLiveSession(session.jti))!.secureVaultKey,undefined));assert.equal(executed,false);
});
