import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {BSON} from 'mongodb';
import {sendEmail} from '../email/service';
import type {EmailSendInput} from '../email/types';
import {sendVerificationEmail} from '../auth/email';
import {suppressEmailAddress,unsubscribeEmailAddress,recordEmailEvent} from '../email/events';
import {withHomeEmailRepository,type EmailOutboxKeyProvider} from '../email/repository';
import {decryptOwnerValueWithKey} from '../auth/vaultCipher';
import {createNativeHomeAuthRepositories} from './nativeUserIdentities';
import {createNativeEmailRepository} from './nativeEmailRepository';
import {createCollectionProvider} from './collectionProvider';
import {openSqliteDocumentStore} from './sqliteStore';
import {physicalCollectionName} from '../mongodb/collectionNames';
import type {CollectionProvider} from './collectionContract';
const code=(value:string)=>(error:unknown)=>(error as {code?:string})?.code===value;
const fixture=async(t:TestContext)=>{
 const directory=await mkdtemp(join(tmpdir(),'thingtime-email-')),providers:CollectionProvider[]=[],key=randomBytes(32);
 t.after(async()=>{await Promise.all(providers.map(p=>p.close()));key.fill(0);await rm(directory,{recursive:true,force:true});});
 return{directory,key,async open(file='home.sqlite',plane='home',keyBytes=key){
  const provider=createCollectionProvider(await openSqliteDocumentStore(join(directory,file)));providers.push(provider);
  const keys:EmailOutboxKeyProvider={homePlaneId:plane,keyId:'synthetic-profile-key',withKey(work){return work(keyBytes);}};
  const repository=await createNativeEmailRepository(provider,plane,keys);
  return{provider,repository,run:<T>(work:()=>T|Promise<T>)=>withHomeEmailRepository(repository,plane,work)};
 }};
};
const input=(extra:Partial<EmailSendInput>={}):EmailSendInput=>({to:' SYNTHETIC@EXAMPLE.INVALID ',subject:'Synthetic queue test',html:'<p>synthetic body</p>',text:'synthetic body',...extra});
test('canonical verification mail queues encrypted and redacted, reopens, and decrypts only under the bound home/message key',async t=>{
 const f=await fixture(t),a=await f.open(),secret='synthetic-verification-credential',link=`https://example.invalid/verify?token=${secret}`;
 const queued=await a.run(()=>sendVerificationEmail({to:'recipient@example.invalid',link}));
 assert.equal(queued.delivered,false);assert.equal(queued.status,'queued');
 await a.run(async()=>{const row=await a.repository.read(queued.emailMessageId);assert.equal(row!.html,'[redacted: single-use secret]');assert.equal(row!.text,'[redacted: single-use secret]');assert.equal('encryptedPayload' in row!,false);});
 const stored=await a.provider.transaction(s=>BSON.deserialize(s.collection(physicalCollectionName('email_messages')).find({limit:1}).documents[0]));
 assert.equal(JSON.stringify(stored).includes(secret),false);assert.equal(JSON.stringify(stored.metadata).includes(secret),false);
 assert.throws(()=>decryptOwnerValueWithKey('wrong-purpose:','home',queued.emailMessageId,stored.encryptedPayload,f.key));
 assert.throws(()=>decryptOwnerValueWithKey('thingtime-native-email-outbox:v1:','foreign',queued.emailMessageId,stored.encryptedPayload,f.key));
 assert.throws(()=>decryptOwnerValueWithKey('thingtime-native-email-outbox:v1:','home','foreign-message',stored.encryptedPayload,f.key));
 await a.provider.close();assert.equal((await readFile(join(f.directory,'home.sqlite'))).includes(Buffer.from(secret)),false);
 const b=await f.open();await b.run(async()=>{const lease=await b.repository.claim('synthetic-worker',10000);assert.ok(lease);const payload=await b.repository.delivery(lease);assert.ok(payload!.html.includes(link));assert.equal((await b.repository.read(lease.id))!.status,'queued');});
 const bad=await f.open('home.sqlite','home',randomBytes(32));await bad.run(async()=>{const future=new Date(Date.now()+20000);const lease=await bad.repository.claim('key-mismatch-worker',10000,future);assert.ok(lease);await assert.rejects(bad.repository.delivery(lease,future));});
});
test('immutable operation identity deduplicates concurrent handles and rejects changed payload',async t=>{
 const f=await fixture(t),a=await f.open(),b=await f.open();
 const draft=input({idempotencyKey:'synthetic-operation'});
 const results=await Promise.all([a.run(()=>sendEmail(draft)),b.run(()=>sendEmail(draft))]);assert.equal(results[0].emailMessageId,results[1].emailMessageId);
 await a.run(async()=>{await assert.rejects(sendEmail({...draft,text:'changed'}),code('EMAIL_IDEMPOTENCY_CONFLICT'));});
 const rows=await a.provider.transaction(s=>s.collection(physicalCollectionName('email_messages')).find({limit:10}).documents);assert.equal(rows.length,1);
});
test('queued payload is a frozen snapshot across blocked admission and caller mutation',async t=>{
 const f=await fixture(t),a=await f.open();let release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});const block=a.provider.transaction(async()=>{entered();await gate;});await started;
 const draft=input({metadata:{label:'original'},tags:{kind:'original'}});const pending=a.run(()=>sendEmail(draft));draft.text='changed';(draft.metadata as any).label='changed';(draft.tags as any).kind='changed';release();await block;
 const queued=await pending;await a.run(async()=>{const lease=await a.repository.claim('snapshot-worker',10000);assert.equal(lease!.id,queued.emailMessageId);assert.equal((await a.repository.delivery(lease!))!.text,'synthetic body');assert.equal((await a.repository.read(lease!.id))!.metadata.label,'original');});
});
test('one active lease wins, retry remains pending, stale/foreign receipts cannot settle, and expiry allows recovery',async t=>{
 const f=await fixture(t),a=await f.open(),b=await f.open();await a.run(()=>sendEmail(input()));
 const leases=await Promise.all(Array.from({length:8},(_,i)=>(i%2?a:b).run(()=> (i%2?a:b).repository.claim(`worker-${i}`,10000))));
 const lease=leases.find(x=>x!==null)!;assert.equal(leases.filter(Boolean).length,1);
 await a.run(async()=>{
  assert.equal(await a.repository.sent({...lease,token:'foreign'},'synthetic-only-state-transition'),false);
  assert.equal(await a.repository.sent({...lease,workerId:'foreign'},'synthetic-only-state-transition'),false);
  const due=new Date(Date.now()+20000);assert.equal(await a.repository.defer(lease,due,'TRANSPORT_UNAVAILABLE'),true);
  assert.equal((await a.repository.read(lease.id))!.status,'queued');assert.equal(await a.repository.claim('early',10000),null);
  const next=await a.repository.claim('retry',10000,due);assert.ok(next);
  assert.equal(await a.repository.sent(lease,'synthetic-only-state-transition',due),false);
  assert.equal(await a.repository.delivery(next,new Date(due.getTime()+10001)),null);
  const recovered=await a.repository.claim('recovered',10000,new Date(due.getTime()+10001));assert.ok(recovered);
  assert.equal(await a.repository.sent(recovered,'synthetic-not-provider-delivery',new Date(due.getTime()+10002)),true);
  assert.equal((await a.repository.read(lease.id))!.status,'sent');
 });
});
test('canonical suppression and newsletter unsubscribe survive reopen and are rechecked immediately before payload release',async t=>{
 const f=await fixture(t),a=await f.open();await a.run(async()=>{await suppressEmailAddress({email:' BLOCKED@example.invalid ',reason:'synthetic'});await unsubscribeEmailAddress({email:'news@example.invalid'});await recordEmailEvent({eventType:'synthetic',email:' NEWS@example.invalid '});});
 await a.provider.close();const b=await f.open();await b.run(async()=>{
  const partial=await sendEmail(input({to:['blocked@example.invalid','allowed@example.invalid']}));assert.equal(partial.status,'queued');
  const lease=await b.repository.claim('policy',10000);assert.deepEqual((await b.repository.delivery(lease!))!.to,['allowed@example.invalid']);
  await suppressEmailAddress({email:'allowed@example.invalid',reason:'late suppression'});assert.equal(await b.repository.delivery(lease!),null);assert.equal((await b.repository.read(lease!.id))!.status,'skipped');
  assert.equal((await sendEmail(input({to:'news@example.invalid',stream:'newsletter'}))).status,'skipped');
  assert.equal((await sendEmail(input({to:'news@example.invalid',stream:'transactional'}))).status,'queued');
 });
});
test('missing/invalid protected key refuses and same-label foreign provider/scoped descendants cannot access queue',async t=>{
 const f=await fixture(t),a=await f.open(),b=await f.open('foreign.sqlite','home');
 await assert.rejects(createNativeEmailRepository(a.provider,'home',undefined as any),code('EMAIL_KEY_UNAVAILABLE'));
 const invalid=await createNativeEmailRepository(a.provider,'home',{homePlaneId:'home',keyId:'bad',withKey(work){return work(new Uint8Array(31));}});
 await assert.rejects(withHomeEmailRepository(invalid,'home',()=>sendEmail(input())));
 const auth=await createNativeHomeAuthRepositories(a.provider,'home');await auth.run(async()=>{await assert.rejects(sendEmail(input()),code('EMAIL_REPOSITORY_SCOPE'));await assert.rejects(withHomeEmailRepository(b.repository,'home',()=>sendEmail(input())),code('HOME_REPOSITORY_SCOPE'));});
 let release!:()=>void,pending!:Promise<unknown>;const gate=new Promise<void>(r=>{release=r;});await a.run(()=>{pending=gate.then(()=>sendEmail(input()));});const refused=assert.rejects(pending,code('EMAIL_REPOSITORY_SCOPE'));release();await refused;
});

test('queue-waiting cannot extend a lease and scope exit after insertion rolls the transaction back',async t=>{
 const f=await fixture(t),a=await f.open();await a.run(()=>sendEmail(input()));
 const lease=await a.run(()=>a.repository.claim('short-lease',60));assert.ok(lease);
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
 const block=a.provider.transaction(async()=>{entered();await gate;});await started;
 const reading=a.run(()=>a.repository.delivery(lease));await new Promise(r=>setTimeout(r,90));release();await block;assert.equal(await reading,null);
 const empty=await f.open('rollback.sqlite');let inserted=()=>{};
 const observed:CollectionProvider={transaction(work){return empty.provider.transaction(session=>work({...session,collection(name){const collection=session.collection(name);return{...collection,insert(bytes){collection.insert(bytes);inserted();}};}}));},close(){return empty.provider.close();}};
 const repository=await createNativeEmailRepository(observed,'home',{homePlaneId:'home',keyId:'synthetic',withKey(work){return work(f.key);}});
 let leave!:()=>void,pending!:Promise<unknown>;const untilInsert=new Promise<void>(r=>{leave=r;});inserted=leave;
 await withHomeEmailRepository(repository,'home',()=>{pending=sendEmail(input());return untilInsert;});await assert.rejects(pending,code('EMAIL_REPOSITORY_SCOPE'));
 const stored=await empty.provider.transaction(s=>s.collection(physicalCollectionName('email_messages')).find({limit:1}).documents);assert.equal(stored.length,0);
});
