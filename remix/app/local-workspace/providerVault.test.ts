import { createQuotaFactory, TEST_STORAGE_CAPACITY } from './storageTestFixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBKeyRange } from 'fake-indexeddb';
import { LocalProviderVault } from './providerVault';
import { deviceVaultCollections } from './deviceVaultSession';
import { WorkspaceDatabase, type WorkspaceScope } from './storage';
const phrase='Synthetic local provider fixture passphrase', origin='https://device.example';
const gate={assertCurrent(){},onInvalidate:()=>()=>{}}, collections=deviceVaultCollections('providers');
const command=<T extends Record<string,unknown> = Record<string,unknown>>(action:string, values:T={} as T, id:string=crypto.randomUUID(), revision=0)=>({action,id,revision,writeId:crypto.randomUUID(),...values});
async function fixture(scope:WorkspaceScope={kind:'anonymous'}){
 const db=new WorkspaceDatabase(createQuotaFactory(),crypto.randomUUID(),10_000,IDBKeyRange), vault=new LocalProviderVault(db,scope,gate,origin);
 await vault.unlock(phrase,true); return {db,vault,scope,close:async()=>{vault.dispose();await db.close();}};
}
const raw=(f:Awaited<ReturnType<typeof fixture>>)=>f.db.transaction(f.scope,'readonly',gate,async tx=>({records:await tx.list(collections.records),commands:await tx.list(collections.commands)}));
test('anonymous environments, secrets and provider metadata stay encrypted and survive cold unlock',async()=>{
 const f=await fixture();let reopened:LocalProviderVault|undefined;
 try{
  const group=command('create-group',{name:'Private synthetic environment'});await f.vault.mutate(group);
  const secret=command('save-secret',{name:'Synthetic secret name',key:'SYNTHETIC_KEY',value:'  preserved 🦄 secret\n',groupId:group.id});await f.vault.mutate(secret);
  const provider=command('save-provider',{name:'Synthetic provider name',provider:'openai',endpoint:'https://api.openai.com/v1/',token:'synthetic provider token',groupId:group.id});await f.vault.mutate(provider);
  const list=await f.vault.list();assert.equal(list.groups[0].name,group.name);assert.equal(list.entries.length,2);assert.ok(!JSON.stringify(list).includes('provider token'));assert.ok(!JSON.stringify(list).includes('preserved 🦄'));
  const saved=JSON.stringify(await raw(f));for(const value of [group.name,secret.name,secret.key,secret.value,provider.name,provider.token])assert.ok(!saved.includes(String(value)));
  assert.deepEqual(await f.vault.syncStatus(),[]);assert.deepEqual((await raw(f)).commands,[]);
  f.vault.dispose();reopened=new LocalProviderVault(f.db,f.scope,gate,origin);await assert.rejects(reopened.unlock('wrong fixture phrase'));await reopened.unlock(phrase);
  assert.equal((await reopened.reveal(secret.id)).value,secret.value);assert.equal((await reopened.reveal(provider.id)).value,provider.token);
  await reopened.mutate(command('move-entry',{groupId:null},secret.id,1));assert.equal((await reopened.list()).entries.find(x=>x.id===secret.id)?.groupId,null);
  await assert.rejects(reopened.mutate(command('delete',{},group.id,1)),/Move or delete/);
  await reopened.mutate(command('delete',{},provider.id,1));await reopened.mutate(command('delete',{},group.id,1));assert.equal((await reopened.list()).groups.length,0);
 }finally{reopened?.dispose();await f.close();}
});
test('account mutations retain encrypted ordered intent without calling any transport',async()=>{
 const f=await fixture({kind:'account',ownerId:'fixture-owner',origin,dataPlane:'home'});
 try{
  const group=command('create-group',{name:'Account group fixture'}), secret=command('save-secret',{name:'Account secret fixture',key:'TOKEN',value:'account provider fixture value',groupId:group.id});
  await f.vault.mutate(group);await f.vault.mutate(secret);await f.vault.mutate(command('delete',{},secret.id,1));
  assert.deepEqual((await f.vault.syncStatus()).map(row=>row.sequence).sort((a,b)=>a-b),[1,2,3]);
  const saved=JSON.stringify(await raw(f));assert.ok(!saved.includes('Account group fixture'));assert.ok(!saved.includes('account provider fixture value'));
 }finally{await f.close();}
});
test('immutable local retries and stale revisions cannot replace newer credentials',async()=>{
 const f=await fixture();
 try{
  const one=command('save-secret',{name:'Secret',key:'KEY',value:'original fixture'}), result=await f.vault.mutate(one);assert.deepEqual(await f.vault.mutate(one),result);
  await assert.rejects(f.vault.mutate({...one,value:'different payload'}),/save id/);
  await f.vault.mutate(command('save-secret',{name:'Secret',key:'KEY',value:'new fixture'},one.id,1));
  await assert.rejects(f.vault.mutate(command('delete',{},one.id,1)),/changed/);assert.equal((await f.vault.reveal(one.id)).value,'new fixture');
  const provider=command('save-provider',{name:'Provider',provider:'compatible',endpoint:'https://provider.example/v1',model:'fixture-model',token:'retained token'});await f.vault.mutate(provider);
  await f.vault.mutate(command('save-provider',{name:'Renamed',provider:'compatible',endpoint:'https://provider.example/v1',model:'fixture-model',token:''},provider.id,1));assert.equal((await f.vault.reveal(provider.id)).value,'retained token');
 }finally{await f.close();}
});
test('invalid inputs, oversized Unicode values and foreign environments leave no records',async()=>{
 const f=await fixture();
 try{
  for(const body of [command('save-secret',{name:'Invalid',key:'KEY',value:'🦄'.repeat(8193)}),command('save-secret',{name:'Invalid',key:'KEY',value:'value',groupId:crypto.randomUUID()}),command('save-provider',{name:'Invalid',provider:'shell',endpoint:'https://provider.example',token:'fixture'}),command('save-provider',{name:'Invalid',provider:'openai',endpoint:'https://user:password@provider.example',token:'fixture'}),command('save-provider',{name:'Invalid',provider:'openai',endpoint:'https://provider.example',token:[]}),command('create-group',{name:'Invalid',ownerId:'other'})]) await assert.rejects(f.vault.mutate(body));
  assert.deepEqual((await raw(f)).records,[]);await assert.rejects(f.vault.reveal(crypto.randomUUID()),/not found/);
 }finally{await f.close();}
});
test('environment removal is fenced against a concurrent child creation',async()=>{
 const f=await fixture(), original=f.db.transaction.bind(f.db);let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(yes=>{entered=yes;}),waiting=new Promise<void>(yes=>{release=yes;});
 try{
  const group=command('create-group',{name:'Race environment'});await f.vault.mutate(group);let intercept=true;
  f.db.transaction=(async(...args:any[])=>{if(args[1]==='readwrite'&&intercept){intercept=false;entered();await waiting;}return (original as any)(...args);}) as any;
  const removing=f.vault.mutate(command('delete',{},group.id,1));await started;
  const child=command('save-secret',{name:'Concurrent child',key:'KEY',value:'fixture',groupId:group.id});await f.vault.mutate(child);release();await assert.rejects(removing,/another operation/);
  const list=await f.vault.list();assert.equal(list.groups.length,1);assert.equal(list.entries[0].groupId,group.id);
 }finally{release?.();f.db.transaction=original;await f.close();}
});
test('quota refusal rolls encrypted content and account intent back together',async()=>{
 const f=await fixture({kind:'account',ownerId:'quota-owner',origin,dataPlane:'home'});
 try{
  const usage=await f.db.transaction(f.scope,'readonly',gate,tx=>tx.usage());await f.db.transaction(f.scope,'readwrite',gate,async tx=>{for(let i=0;i<3;i++)await tx.putBytes(`fill-${i}`,new Uint8Array(TEST_STORAGE_CAPACITY.binaryBytes));await tx.putBytes('fill-final',new Uint8Array(TEST_STORAGE_CAPACITY.binaryBytes-usage.bytes));});
  await assert.rejects(f.vault.mutate(command('save-secret',{name:'Quota fixture',key:'KEY',value:'preserve'})),/workspace is full/);assert.deepEqual(await raw(f),{records:[],commands:[]});
 }finally{await f.close();}
});
test('locking during a delayed mutation prevents record and queue adoption',async()=>{
 const f=await fixture({kind:'account',ownerId:'lock-owner',origin,dataPlane:'home'}), original=f.db.transaction.bind(f.db);let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(yes=>{entered=yes;}),waiting=new Promise<void>(yes=>{release=yes;});
 try{
  let intercept=true;f.db.transaction=(async(...args:any[])=>{if(args[1]==='readwrite'&&intercept){intercept=false;entered();await waiting;}return (original as any)(...args);}) as any;
  const pending=f.vault.mutate(command('save-secret',{name:'Never adopted',key:'KEY',value:'fixture'}));await started;f.vault.lock();release();await assert.rejects(pending,/locked/);
  assert.deepEqual(await raw(f),{records:[],commands:[]});
 }finally{release?.();f.db.transaction=original;await f.close();}
});
test('damaged record metadata fails closed without replacing encrypted work',async()=>{
 const f=await fixture();
 try{
  const one=command('save-secret',{name:'Preserved',key:'KEY',value:'synthetic retained value'});await f.vault.mutate(one);
  await f.db.transaction(f.scope,'readwrite',gate,async tx=>{const row=await tx.get<any>(collections.records,one.id);await tx.put(collections.records,one.id,{...row,revision:null});});
  const before=await raw(f);await assert.rejects(f.vault.list(),/metadata is invalid/);await assert.rejects(f.vault.reveal(one.id),/metadata is invalid/);
  await assert.rejects(f.vault.mutate(command('save-secret',{name:'Replacement',key:'KEY',value:'new'},one.id,0)),/metadata is invalid/);assert.deepEqual(await raw(f),before);
 }finally{await f.close();}
});

const accountScope:WorkspaceScope={kind:'account',ownerId:'fixture-owner',origin,dataPlane:'home'};
const remoteVersion=(letter='a')=>'vault-state-v1:'+letter.repeat(64);
const remoteGroup=()=>({id:'fixture-remote-group',name:'Account environment',version:remoteVersion(),createdAt:'2026-10-17T00:00:00.000Z',updatedAt:'2026-10-17T00:00:00.000Z'});
const remoteSecret=()=>({id:'fixture-remote-secret',kind:'secret' as const,name:'Metadata without secret',key:'REMOTE_KEY',hasValue:true as const,groupId:'fixture-remote-group',version:remoteVersion(),createdAt:'2026-10-17T00:00:00.000Z',updatedAt:'2026-10-17T00:00:00.000Z'});
const remoteProvider=()=>({...remoteSecret(),id:'fixture-remote-provider',kind:'provider' as const,key:undefined,provider:'openai' as const,endpoint:'https://api.openai.com/v1'});
function remoteSnapshot(){const provider=remoteProvider();delete provider.key;return {complete:true as const,groups:[remoteGroup()],entries:[remoteSecret(),provider]};}
const metadataTransport=(snapshot:any=remoteSnapshot())=>({metadata:async()=>structuredClone(snapshot)});

test('account metadata is encrypted, cold-readable, and explicit about values unavailable offline',async()=>{
 const f=await fixture(accountScope);let reopened:LocalProviderVault|undefined;
 try{
  await f.vault.reconcileMetadata(metadataTransport());const list=await f.vault.list();
  assert.equal(list.groups.length,1);assert.equal(list.entries.length,2);assert.ok(list.entries.every(row=>row.valueAvailableOffline===false));
  await assert.rejects(f.vault.reveal(remoteSecret().id),/not been retained/);assert.deepEqual(await f.vault.syncStatus(),[]);
  const saved=JSON.stringify(await raw(f));for(const text of ['Account environment','Metadata without secret','REMOTE_KEY','api.openai.com'])assert.ok(!saved.includes(text));
  f.vault.dispose();reopened=new LocalProviderVault(f.db,f.scope,gate,origin);await reopened.unlock(phrase);
  assert.equal((await reopened.list()).entries.length,2);await assert.rejects(reopened.reveal(remoteProvider().id),/not been retained/);
 }finally{reopened?.dispose();await f.close();}
});
test('selected retention is bound to exact id, local revision and server state; refresh invalidates an older value',async()=>{
 const f=await fixture(accountScope),id=remoteSecret().id, value='  explicit synthetic retained secret\n';
 try{
  await f.vault.reconcileMetadata(metadataTransport());
  for(const response of [{id:'another-entry',version:remoteVersion(),value},{id,version:remoteVersion('b'),value}])await assert.rejects(f.vault.retainSelectedValue(id,1,response),/different account snapshot/);
  await assert.rejects(f.vault.retainSelectedValue(id,0,{id,version:remoteVersion(),value}),/different account snapshot/);
  await f.vault.retainSelectedValue(id,1,{id,version:remoteVersion(),value});assert.equal((await f.vault.reveal(id)).value,value);
  assert.deepEqual(await f.vault.syncStatus(),[]);assert.ok(!JSON.stringify(await raw(f)).includes(value));
  await f.vault.reconcileMetadata(metadataTransport());assert.equal((await f.vault.reveal(id)).value,value);
  const newer=remoteSnapshot();newer.entries[0].version=remoteVersion('b');await f.vault.reconcileMetadata(metadataTransport(newer));
  await assert.rejects(f.vault.reveal(id),/not been retained/);assert.equal((await f.vault.list()).entries.find(row=>row.id===id)?.valueAvailableOffline,false);
 }finally{await f.close();}
});
test('server-only providers can move or change metadata locally without manufacturing a token',async()=>{
 const f=await fixture(accountScope),id=remoteProvider().id;
 try{
  await f.vault.reconcileMetadata(metadataTransport());
  await f.vault.mutate(command('move-entry',{groupId:null},id,1));
  await f.vault.mutate(command('save-provider',{name:'Offline rename',provider:'openai',endpoint:'https://api.openai.com/v1',token:'',groupId:null},id,2));
  const entry=(await f.vault.list()).entries.find(row=>row.id===id);assert.equal(entry?.name,'Offline rename');assert.equal(entry?.valueAvailableOffline,false);
  await assert.rejects(f.vault.reveal(id),/not been retained/);assert.equal((await f.vault.syncStatus()).length,2);
  await assert.rejects(f.vault.retainSelectedValue(id,3,{id,version:remoteVersion(),value:'stale remote value'}),/changed before/);
  await f.vault.reconcileMetadata(metadataTransport());assert.equal((await f.vault.list()).entries.find(row=>row.id===id)?.name,'Offline rename');
 }finally{await f.close();}
});
test('complete snapshot deletion preserves pending account work and device creations',async()=>{
 const f=await fixture(accountScope),id=remoteSecret().id;
 try{
  await f.vault.reconcileMetadata(metadataTransport());
  await f.vault.mutate(command('save-secret',{name:'Pending',key:'KEY',value:'new local secret',groupId:null},id,1));
  const created=command('save-secret',{name:'New device entry',key:'KEY',value:'unsent local value'});await f.vault.mutate(created);
  await f.vault.reconcileMetadata(metadataTransport({complete:true,groups:[],entries:[]}));
  const list=await f.vault.list();assert.equal(list.groups.length,0);assert.deepEqual(new Set(list.entries.map(row=>row.id)),new Set([id,created.id]));
  assert.equal((await f.vault.reveal(id)).value,'new local secret');assert.equal((await f.vault.syncStatus()).length,2);
 }finally{await f.close();}
});
test('malformed, incomplete, secret-bearing or oversized metadata snapshots cannot partially replace device data',async()=>{
 const f=await fixture(accountScope);
 try{
  await f.vault.reconcileMetadata(metadataTransport());const before=await raw(f);
  const base=remoteSnapshot();const bad:any[]=[{...base,groups:[null]},{...base,entries:[{...base.entries[0],kind:'group'}]},{...base,entries:[{...base.entries[0],createdAt:'invalid'}]},{...base,complete:false},{...base,groups:[],entries:base.entries},{...base,entries:[base.entries[0],base.entries[0]]},{...base,entries:[{...base.entries[0],value:'unexpected bulk secret'}]},{...base,entries:[{...base.entries[0],encryptedValue:{cipherText:'unexpected'}}]},{...base,entries:[{...base.entries[0],version:'invalid'}]},{...base,entries:Array.from({length:501},()=>base.entries[0])}];
  for(const snapshot of bad){await assert.rejects(f.vault.reconcileMetadata(metadataTransport(snapshot)));assert.deepEqual(await raw(f),before);}
 }finally{await f.close();}
});
test('a delayed snapshot cannot overwrite an edit made after its fetch began',async()=>{
 const f=await fixture(accountScope);let entered!:()=>void,release!:(value:any)=>void;
 const started=new Promise<void>(yes=>entered=yes),response=new Promise<any>(yes=>release=yes);
 try{
  await f.vault.reconcileMetadata(metadataTransport());const reading=f.vault.reconcileMetadata({metadata:async()=>{entered();return response;}});await started;
  await f.vault.mutate(command('save-secret',{name:'Concurrent edit',key:'KEY',value:'keep this',groupId:null},remoteSecret().id,1));
  release(remoteSnapshot());await assert.rejects(reading,/Local edits have been kept/);
  assert.equal((await f.vault.reveal(remoteSecret().id)).value,'keep this');assert.equal((await f.vault.syncStatus()).length,1);
 }finally{release?.(remoteSnapshot());await f.close();}
});
test('locking during metadata fetch stops adoption and anonymous vaults never call account transport',async()=>{
 const f=await fixture(accountScope),anonymous=await fixture();let entered!:()=>void,release!:(value:any)=>void;
 const started=new Promise<void>(yes=>entered=yes),response=new Promise<any>(yes=>release=yes);let requests=0;
 try{
  await assert.rejects(anonymous.vault.reconcileMetadata({metadata:async()=>{requests++;return remoteSnapshot();}}),/never synchronize/);assert.equal(requests,0);
  const reading=f.vault.reconcileMetadata({metadata:async()=>{entered();return response;}});await started;f.vault.lock();release(remoteSnapshot());await assert.rejects(reading,/locked/);
  assert.deepEqual((await raw(f)).records,[]);
 }finally{release?.(remoteSnapshot());await f.close();await anonymous.close();}
});

test('unsent children retain the environment metadata they need after remote group deletion',async()=>{
 const f=await fixture(accountScope);
 try{
  await f.vault.reconcileMetadata(metadataTransport());
  await f.vault.mutate(command('save-secret',{name:'Pending child',key:'KEY',value:'keep child',groupId:remoteGroup().id},remoteSecret().id,1));
  await f.vault.reconcileMetadata(metadataTransport({complete:true,groups:[],entries:[]}));
  const list=await f.vault.list();assert.equal(list.groups[0].id,remoteGroup().id);assert.equal(list.entries.length,1);assert.equal(list.entries[0].groupId,remoteGroup().id);
 }finally{await f.close();}
});
test('a selected reveal arriving after a local value replacement cannot overwrite it',async()=>{
 const f=await fixture(accountScope),original=f.db.transaction.bind(f.db);let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(yes=>entered=yes),waiting=new Promise<void>(yes=>release=yes);
 try{
  await f.vault.reconcileMetadata(metadataTransport());let intercept=true;
  f.db.transaction=(async(...args:any[])=>{if(args[1]==='readwrite'&&intercept){intercept=false;entered();await waiting;}return (original as any)(...args);}) as any;
  const retaining=f.vault.retainSelectedValue(remoteSecret().id,1,{id:remoteSecret().id,version:remoteVersion(),value:'old remote value'});await started;
  await f.vault.mutate(command('save-secret',{name:'New local value',key:'KEY',value:'new local value',groupId:null},remoteSecret().id,1));
  release();await assert.rejects(retaining,/changed before/);assert.equal((await f.vault.reveal(remoteSecret().id)).value,'new local value');
 }finally{release?.();f.db.transaction=original;await f.close();}
});
test('account metadata plus pending local entries cannot exceed the device limit',async()=>{
 const f=await fixture(accountScope);
 try{
  await f.vault.mutate(command('create-group',{name:'Pending local environment'}));const before=await raw(f);
  const groups=Array.from({length:500},(_,index)=>({...remoteGroup(),id:'remote-group-'+index,name:'Remote '+index}));
  await assert.rejects(f.vault.reconcileMetadata(metadataTransport({complete:true,groups,entries:[]})),/exceed this device limit/);assert.deepEqual(await raw(f),before);
 }finally{await f.close();}
});
