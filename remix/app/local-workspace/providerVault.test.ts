import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { LocalProviderVault } from './providerVault';
import { deviceVaultCollections } from './deviceVaultSession';
import { WorkspaceDatabase, WORKSPACE_LIMITS, type WorkspaceScope } from './storage';
const phrase='Synthetic local provider fixture passphrase', origin='https://device.example';
const gate={assertCurrent(){},onInvalidate:()=>()=>{}}, collections=deviceVaultCollections('providers');
const command=<T extends Record<string,unknown> = Record<string,unknown>>(action:string, values:T={} as T, id:string=crypto.randomUUID(), revision=0)=>({action,id,revision,writeId:crypto.randomUUID(),...values});
async function fixture(scope:WorkspaceScope={kind:'anonymous'}){
 const db=new WorkspaceDatabase(new IDBFactory(),crypto.randomUUID(),10_000,IDBKeyRange), vault=new LocalProviderVault(db,scope,gate,origin);
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
  const usage=await f.db.transaction(f.scope,'readonly',gate,tx=>tx.usage());await f.db.transaction(f.scope,'readwrite',gate,async tx=>{for(let i=0;i<3;i++)await tx.putBytes(`fill-${i}`,new Uint8Array(WORKSPACE_LIMITS.binaryBytes));await tx.putBytes('fill-final',new Uint8Array(WORKSPACE_LIMITS.binaryBytes-usage.bytes));});
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
