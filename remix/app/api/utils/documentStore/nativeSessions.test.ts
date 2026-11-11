import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as immediate } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { BSON, Binary } from 'mongodb';
import { createSession, getLiveSession, revokeSession, REVOKED_SESSION_REAP_MS, revokedSessionPipeline } from '../auth/sessions';
import { currentSessionRepository, withHomeSessionRepository } from '../auth/sessionRepository';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { openSqliteDocumentStore } from './sqliteStore';
import { createCollectionProvider } from './collectionProvider';
import { createNativeSessionRepository } from './nativeSessions';
import type { CollectionProvider } from './collectionContract';
const code = (expected: string) => (error: unknown) => (error as { code?: string })?.code === expected;
const subject = 'synthetic-session-subject';
const fixture = async (t: TestContext) => {
 const directory = await mkdtemp(join(tmpdir(), 'thingtime-native-sessions-'));
 const providers: CollectionProvider[] = [];
 const open = async (name = 'home.sqlite', plane = 'home') => {
  const provider = createCollectionProvider(await openSqliteDocumentStore(join(directory, name))); providers.push(provider);
  return { provider, repository: await createNativeSessionRepository(provider, plane), plane };
 };
 t.after(async () => { await Promise.all(providers.map(p => p.close())); await rm(directory, { recursive: true, force: true }); });
 return { open };
};

// Canonical session helpers create every session here. No account rows or
// alternate signup handler are seeded, and no authenticated API claim is made.
test('canonical session creation, live reads and revocation persist in a real SQLite file across reopen', async t => {
 const { open } = await fixture(t), first = await open();
 let jti = '';
 await withHomeSessionRepository(first.repository, first.plane, async () => {
  const doc = await createSession(subject, { meta: { nested: { text: '中文', value: 9 }, binary: new Binary(Buffer.from([0,255]), 128) } });
  jti = doc.jti; assert.equal(doc.userId, subject); assert.equal(doc.type, 'tt.session');
  const stored = await getLiveSession(jti);
  assert.ok(stored); assert.equal(stored.userId, subject); assert.ok(stored.createdAt instanceof Date);
  assert.equal(stored.expiresAt!.getTime() - stored.createdAt.getTime(), REVOKED_SESSION_REAP_MS);
  assert.deepEqual(stored.meta?.binary, doc.meta?.binary);
  stored.meta!.nested.value = 999;
  assert.equal((await getLiveSession(jti))!.meta!.nested.value, 9);
 });
 await first.provider.close(); const reopened = await open();
 await withHomeSessionRepository(reopened.repository, reopened.plane, async () => {
  assert.equal((await getLiveSession(jti))?.userId, subject);
  await revokeSession(jti); assert.equal(await getLiveSession(jti), null);
 });
 await reopened.provider.close(); const last = await open();
 await withHomeSessionRepository(last.repository, last.plane, async () => assert.equal(await getLiveSession(jti), null));
});

test('canonical expiry and non-expiring revocation retention preserve existing expiry and remove vault authority', async t => {
 const { open } = await fixture(t), f = await open();
 await withHomeSessionRepository(f.repository, f.plane, async () => {
  const expired = await createSession(subject, { expiresAt: new Date(0) });
  assert.equal(await getLiveSession(expired.jti), null);
  const perpetual = await createSession(subject, { expiresAt: null, purpose: 'service' });
  assert.equal((await getLiveSession(perpetual.jti))?.expiresAt, null);
  const finiteExpiry = new Date(Date.now() + 100000);
  const finite = await createSession(subject, { expiresAt: finiteExpiry });
  // Module-only fixture for another canonical writer's vault-key satellite;
  // this is not evidence that vault-grant issuance is native-adapted.
  await f.provider.transaction(s => s.collection(physicalCollectionName('sessions')).updateOne({ op:'eq',path:['jti'],value:perpetual.jti }, [{ op:'set',path:['secureVaultKey'],value:new Binary(Buffer.from('synthetic-test-only')) }]));
  const before = Date.now(); await revokeSession(perpetual.jti); const after = Date.now();
  await revokeSession(finite.jti);
  await f.provider.transaction(s => {
   const collection = s.collection(physicalCollectionName('sessions'));
   const read = (jti: string) => BSON.deserialize(collection.find({ filter:{op:'eq',path:['jti'],value:jti},limit:1 }).documents[0]);
   const permanent = read(perpetual.jti);
   assert.ok(permanent.revokedAt instanceof Date);
   assert.ok(permanent.expiresAt.getTime() >= before + REVOKED_SESSION_REAP_MS && permanent.expiresAt.getTime() <= after + REVOKED_SESSION_REAP_MS);
   assert.equal(Object.prototype.hasOwnProperty.call(permanent,'secureVaultKey'),false);
   assert.equal(read(finite.jti).expiresAt.getTime(),finiteExpiry.getTime());
  });
 });
});

test('preallocated canonical session identities have one winner across two SQLite handles', async t => {
 const { open } = await fixture(t), a = await open(), b = await open();
 const results = await Promise.allSettled([a,b].map(f => withHomeSessionRepository(f.repository,f.plane,()=>createSession(subject,{jti:'same-preallocated-session'}))));
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(results.filter(result=>result.status==='rejected').length,1);
 await withHomeSessionRepository(a.repository,a.plane,async()=>assert.equal((await getLiveSession('same-preallocated-session'))?.userId,subject));
});

test('concurrent home repositories remain isolated and nested/wrong-plane scopes fail closed', async t => {
 const { open } = await fixture(t), a=await open('a.sqlite','plane-a'), b=await open('b.sqlite','plane-b');
 await assert.rejects(withHomeSessionRepository(a.repository,b.plane,()=>undefined),code('SESSION_REPOSITORY_SCOPE'));
 await Promise.all([a,b].map((f,index)=>withHomeSessionRepository(f.repository,f.plane,async()=>{
  await createSession(`subject-${index}`,{jti:'shared-id'}); await immediate();
  assert.equal((await getLiveSession('shared-id'))?.userId,`subject-${index}`);
  await assert.rejects(withHomeSessionRepository(index?a.repository:b.repository,index?a.plane:b.plane,()=>undefined),code('SESSION_REPOSITORY_SCOPE'));
 })));
 assert.equal(currentSessionRepository().kind,'mongo-home');
});

test('expired async descendants and unawaited queued work cannot fall back or mutate after repository scope closes', async t => {
 const { open } = await fixture(t), f=await open();
 let resume!:()=>void, pending!:Promise<unknown>;
 const gate=new Promise<void>(resolve=>{resume=resolve;});
 await withHomeSessionRepository(f.repository,f.plane,()=>{ pending=gate.then(()=>createSession(subject,{jti:'late'})); });
 const rejection=assert.rejects(pending,code('SESSION_REPOSITORY_SCOPE'));resume();await rejection;
 let release!:()=>void,entered!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});
 const blocker=f.provider.transaction(async()=>{entered();await held;});await ready;
 let queued!:Promise<unknown>;
 await withHomeSessionRepository(f.repository,f.plane,()=>{queued=createSession(subject,{jti:'queued'});});
 const refused=assert.rejects(queued,code('SESSION_REPOSITORY_SCOPE'));release();await blocker;await refused;
 await withHomeSessionRepository(f.repository,f.plane,async()=>{assert.equal(await getLiveSession('late'),null);assert.equal(await getLiveSession('queued'),null);});
});

test('unimplemented caller-owned native transaction is refused before session insertion', async t => {
 const { open } = await fixture(t), f=await open();
 await withHomeSessionRepository(f.repository,f.plane,async()=>{
  await assert.rejects(createSession(subject,{jti:'must-not-write',session:{inTransaction:()=>true}}),code('SESSION_TRANSACTION_UNSUPPORTED'));
  assert.equal(await getLiveSession('must-not-write'),null);
 });
});

test('existing exported Mongo revocation pipeline retains its exact update and key-removal contract',()=>{
 const at=new Date('2026-11-12T00:00:00Z');
 assert.deepEqual(revokedSessionPipeline(at),[{$set:{revokedAt:at,expiresAt:{$ifNull:['$expiresAt',new Date(at.getTime()+REVOKED_SESSION_REAP_MS)]}}},{$unset:'secureVaultKey'}]);
});

test('normal hosted session helper import loads neither native provider nor SQLite', async()=>{
 const run=promisify(execFile),url=new URL('../auth/sessions.ts',import.meta.url).href;
 const {stdout}=await run(process.execPath,['--import','tsx','--input-type=module','-e',`
  import assert from 'node:assert/strict'; import Module from 'node:module';
  const load=Module._load;Module._load=function(name,...args){if(name==='node:sqlite'||String(name).includes('nativeSessions'))throw Error('Unexpected native session import');return Reflect.apply(load,this,[name,...args]);};
  const mod=await import(${JSON.stringify(url)}); assert.equal(typeof mod.createSession,'function'); assert.equal(typeof mod.getLiveSession,'function'); assert.equal(typeof mod.revokeSession,'function'); console.log('hosted-session-import-ok');
 `],{cwd:fileURLToPath(new URL('../../../../',import.meta.url)),timeout:15000,maxBuffer:16384});
 assert.match(stdout,/hosted-session-import-ok/);
});


test('canonical session metadata cannot execute accessors or serialization hooks before native BSON admission', async t=>{
 const {open}=await fixture(t),f=await open();let executed=false;
 const meta=Object.defineProperty({},'secret',{enumerable:true,get(){executed=true;return 'not-admitted';}});
 const hook={toBSON(){executed=true;return 'not-admitted';}};
 await withHomeSessionRepository(f.repository,f.plane,async()=>{
  for(const metadata of [meta,{nested:hook}]) await assert.rejects(createSession(subject,{jti:'must-not-execute',meta:metadata}),code('UNSUPPORTED_COLLECTION_OPERATION'));
  assert.equal(await getLiveSession('must-not-execute'),null);
 });
 assert.equal(executed,false);
});


test('saved native repository calls refuse after scope expiry instead of borrowing default Mongo authority', async t=>{
 const {open}=await fixture(t),f=await open();
 const document=await withHomeSessionRepository(f.repository,f.plane,()=>createSession(subject,{jti:'direct-call-session'}));
 await assert.rejects(f.repository.findByJti(document.jti),code('SESSION_REPOSITORY_SCOPE'));
 await assert.rejects(f.repository.insert({...document,jti:'direct-write'}),code('SESSION_REPOSITORY_SCOPE'));
 await assert.rejects(f.repository.revoke(document.jti,new Date()),code('SESSION_REPOSITORY_SCOPE'));
 await withHomeSessionRepository(f.repository,f.plane,async()=>{
  assert.equal((await getLiveSession(document.jti))?.userId,subject);
  assert.equal(await getLiveSession('direct-write'),null);
 });
});
