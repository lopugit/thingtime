import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as immediate } from 'node:timers/promises';
import { Binary } from 'mongodb';
import { insertUser, findUserById, findUserByEmail, findUserByUsername, findUsersByIds, findUsersByUsernames, toPublicUser, setUserAdmin, type UserDoc } from '../auth/users';
import { createSession, getLiveSession, revokeSession } from '../auth/sessions';
import { currentUserIdentityRepository, withHomeAuthRepositories } from '../auth/userIdentityRepository';
import { registerHomeRepositoryProvider, assertSameHomeRepositoryProvider } from '../auth/homeRepositoryScope';
import { withHomeSessionRepository } from '../auth/sessionRepository';
import { createNativeHomeAuthRepositories } from './nativeUserIdentities';
import { openSqliteDocumentStore } from './sqliteStore';
import { createCollectionProvider } from './collectionProvider';
import type { CollectionProvider } from './collectionContract';
const code = (expected: string) => (error: unknown) => (error as { code?: string })?.code === expected;
const user = (username = 'synthetic', email = `${username}@example.invalid`): UserDoc => ({
 username, email, ttid:username, passwordHash:'synthetic-not-a-login-credential', displayName:'Synthetic 中文',
 bio:'test profile', emailVerified:false, createdAt:new Date('2026-11-12T00:00:00Z'), updatedAt:new Date('2026-11-12T00:00:00Z'),
 meta:{ nested:{ keep:true }, recentReactions:['👍'], admin:false }
});
const fixture = async (t: TestContext) => {
 const directory = await mkdtemp(join(tmpdir(),'thingtime-native-identities-')), providers:CollectionProvider[]=[];
 t.after(async()=>{await Promise.all(providers.map(p=>p.close()));await rm(directory,{recursive:true,force:true});});
 return async (name='home.sqlite', plane='home') => {
  const provider=createCollectionProvider(await openSqliteDocumentStore(join(directory,name)));providers.push(provider);
  return {provider,...await createNativeHomeAuthRepositories(provider,plane)};
 };
};
// Module integration: canonical insertUser creates every synthetic identity.
// This is NOT registration, password verification, Timeline or HTTP acceptance.
test('canonical identity envelope, projection and session survive a real SQLite reopen',async t=>{
 const open=await fixture(t),a=await open();let id='',jti='';
 await a.run(async()=>{
  const input=user();input._id='must-not-trust-caller';
  const saved=await insertUser(input);id=String(saved._id);assert.match(id,/^[a-f0-9]{24}$/);assert.notEqual(id,input._id);
  const raw=await a.identities.findUserThingById(id);assert.equal(raw!.ownerId,id);assert.deepEqual(raw!.thingtime,['user']);
  assert.ok(raw!.secure instanceof Binary);assert.deepEqual(raw!.secureRecentReactions,[new Binary(Buffer.from('👍'))]);
  assert.equal((raw!.crystal as any).email,undefined);assert.equal((raw!.crystal as any).passwordHash,undefined);
  const read=await findUserByEmail(' SYNTHETIC@EXAMPLE.INVALID ');assert.equal(read._id,id);assert.equal(read.passwordHash,input.passwordHash);
  assert.deepEqual(read.meta,input.meta && {nested:input.meta.nested,admin:false});
  assert.ok(read.createdAt instanceof Date);
  const publicUser=toPublicUser(read);assert.equal(publicUser.id,id);assert.equal('passwordHash' in publicUser,false);assert.equal(publicUser.storage.status,'unavailable');
  jti=(await createSession(id)).jti;
 });
 await a.provider.close();const b=await open();
 await b.run(async()=>{
  const session=await getLiveSession(jti);assert.equal(session!.userId,id);
  assert.equal((await findUserById(session!.userId)).username,'synthetic');
  assert.equal((await findUserByUsername(' SYNTHETIC '))._id,id);
  assert.deepEqual((await findUsersByIds(['missing',id,id])).map(x=>x._id),[id]);
  assert.deepEqual((await findUsersByUsernames(['missing','SYNTHETIC','synthetic'])).map(x=>x._id),[id]);
  await revokeSession(jti);assert.equal(await getLiveSession(jti),null);
 });
});
test('canonical username and hashed-email uniqueness have one winner across independent handles',async t=>{
 const open=await fixture(t),a=await open(),b=await open();
 for(const inputs of [[user('same','first@example.invalid'),user('same','second@example.invalid')],[user('one',' shared@example.invalid '),user('two','SHARED@example.invalid')]]){
  const results=await Promise.allSettled([a,b].map((f,i)=>f.run(()=>insertUser(inputs[i]))));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);
 }
});
test('native identities remain home isolated; missing identity binding and unsupported Mongo operations refuse',async t=>{
 const open=await fixture(t),a=await open('a.sqlite','a'),b=await open('b.sqlite','b');
 await Promise.all([a,b].map((f,i)=>f.run(async()=>{const saved=await insertUser(user());await immediate();assert.equal((await findUserByUsername('synthetic'))._id,saved._id);assert.ok(await getLiveSession((await createSession(String(saved._id))).jti));assert.equal(f.identities.homePlaneId,i===0?'a':'b');})));
 await assert.rejects(withHomeAuthRepositories(a.identities,b.sessions,()=>undefined),code('USER_IDENTITY_SCOPE'));
 await a.run(async()=>{await assert.rejects(b.identities.findUserThingByUsername('synthetic'),code('USER_IDENTITY_SCOPE'));await assert.rejects(b.run(()=>undefined),code('USER_IDENTITY_SCOPE'));});
 await withHomeSessionRepository(a.sessions,'a',async()=>{await assert.rejects(findUserByUsername('synthetic'),code('USER_IDENTITY_SCOPE'));});
 await a.run(async()=>{await assert.rejects(setUserAdmin('012345678901234567890123',true),code('USER_IDENTITY_SCOPE'));});
 assert.equal(currentUserIdentityRepository(),null);
 await assert.rejects(a.identities.findUserThingByUsername('synthetic'),code('USER_IDENTITY_SCOPE'));
});
test('caller transactions refuse before creating an identity',async t=>{
 const open=await fixture(t),a=await open();
 await a.run(async()=>{
  await assert.rejects(insertUser(user(),{session:{}}),code('USER_IDENTITY_TRANSACTION_UNSUPPORTED'));
  assert.equal(await findUserByUsername('synthetic'),null);
 });
});
test('expired descendants and work queued behind a transaction cannot write after scope exit',async t=>{
 const open=await fixture(t),a=await open();let resume!:()=>void,pending!:Promise<unknown>;
 const gate=new Promise<void>(resolve=>{resume=resolve;});
 await a.run(()=>{pending=gate.then(()=>insertUser(user()));});
 const rejection=assert.rejects(pending,code('USER_IDENTITY_SCOPE'));resume();await rejection;
 let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
 const blocker=a.provider.transaction(async()=>{entered();await held;});await started;
 await a.run(()=>{pending=insertUser(user());});const queued=assert.rejects(pending,code('USER_IDENTITY_SCOPE'));release();await blocker;await queued;
 await a.run(async()=>assert.equal(await findUserByUsername('synthetic'),null));
});
test('native adapter refuses foreign ownership and does not persist an invalid identity',async t=>{
 const open=await fixture(t),a=await open();
 await a.run(async()=>{
  const saved=await insertUser(user()),raw=(await a.identities.findUserThingById(saved._id))!;
  delete raw._id;raw.shareId='012345678901234567890123';raw.ownerId='foreign';
  await assert.rejects(a.identities.insertUserThing(raw),code('USER_IDENTITY_SCOPE'));
  assert.equal(await findUserById(String(raw.shareId)),null);
  // Stored binary values are copied; changing a returned envelope cannot change credentials.
  (raw.secure as Binary).buffer.fill(0);
  assert.equal((await findUserById(saved._id)).passwordHash,user().passwordHash);
 });
});

test('default canonical Mongo identity queries, legacy precedence and transaction forwarding stay unchanged',async()=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{fileURLToPath}=await import('node:url');
 const {stdout}=await promisify(execFile)(process.execPath,['--experimental-test-module-mocks','--import','tsx',fileURLToPath(new URL('./nativeUserIdentities.mongo.fixture.mts',import.meta.url))],{cwd:fileURLToPath(new URL('../../../../',import.meta.url)),timeout:30000,maxBuffer:16384});
 assert.match(stdout,/canonical-mongo-identity-regression-ok/);
});

test('canonical batch identities preserve requested ordering and dedup with one provider transaction per batch',async t=>{
 const open=await fixture(t),base=await open();let transactions=0;
 const counted:CollectionProvider={transaction(work){transactions++;return base.provider.transaction(work);},close(){return base.provider.close();}};
 const auth=await createNativeHomeAuthRepositories(counted,'home');
 await auth.run(async()=>{
  const rows=[];
  for(const name of ['batch-a','batch-b','batch-c']) rows.push(await insertUser(user(name)));
  const requested=[rows[2]._id,rows[0]._id,'missing',rows[1]._id,rows[2]._id];
  transactions=0;
  assert.deepEqual((await findUsersByIds(requested)).map(x=>x._id),[rows[2]._id,rows[0]._id,rows[1]._id]);
  assert.equal(transactions,1);
  transactions=0;
  assert.deepEqual((await findUsersByUsernames([' BATCH-C ','batch-a','missing','batch-b','batch-c'])).map(x=>x._id),[rows[2]._id,rows[0]._id,rows[1]._id]);
  assert.equal(transactions,1);
 });
});


test('same home label cannot pair identities and sessions from different SQLite files or unregistered providers',async t=>{
 const open=await fixture(t),a=await open('profile-a.sqlite','home'),b=await open('profile-b.sqlite','home');let entered=false;
 await assert.rejects(withHomeAuthRepositories(a.identities,b.sessions,()=>{entered=true;}),code('HOME_REPOSITORY_SCOPE'));
 assert.equal(entered,false);
 await a.run(async()=>{assert.equal(await findUserByUsername('must-not-exist'),null);});
 const missing={},provider={};
 assert.throws(()=>assertSameHomeRepositoryProvider(missing,a.identities),code('HOME_REPOSITORY_SCOPE'));
 registerHomeRepositoryProvider(missing,provider);registerHomeRepositoryProvider(missing,provider);
 assert.throws(()=>registerHomeRepositoryProvider(missing,{}),code('HOME_REPOSITORY_SCOPE'));
 assert.throws(()=>assertSameHomeRepositoryProvider(missing,a.identities),code('HOME_REPOSITORY_SCOPE'));
 assertSameHomeRepositoryProvider(a.identities,a.sessions);
 assertSameHomeRepositoryProvider(b.identities,b.sessions);
});
