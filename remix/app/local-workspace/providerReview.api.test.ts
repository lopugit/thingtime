import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir,writeFile } from 'node:fs/promises';
import { IDBFactory,IDBKeyRange } from 'fake-indexeddb';
import { WorkspaceDatabase } from './storage';
import { LocalProviderVault } from './providerVault';
const base=process.env.TT_PROVIDER_WRITES_API_URL,playwrightPath=process.env.TT_SHARED_PLAYWRIGHT_PATH,artifacts=process.env.TT_PROVIDER_WRITES_API_ARTIFACTS;
test('reviewed encrypted device conflicts resolve through the real account API without overwriting account entries',{skip:!base||!playwrightPath||!artifacts,timeout:120_000},async()=>{
 const url=new URL(base!);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.ok(!url.username&&!url.password);
 const {request}=await import(playwrightPath!),context=await request.newContext({baseURL:url.origin});
 const headers={Origin:url.origin,'X-Thingtime-Expected-Data-Plane':'home'},created=new Set<string>(),evidence:{checks:string[];complete?:true;fixtureEntriesCleaned?:true}={checks:[]};
 let vault:LocalProviderVault|undefined,db:WorkspaceDatabase|undefined,ownerId:string|undefined;
 const json=async(response:any,label:string,status=200)=>{assert.equal(response.status(),status,label);evidence.checks.push(label);return response.json();};
 const post=(data:unknown)=>context.post('/api/v1/lopu/vault',{headers,data});
 const metadata=async()=>{
  const result=await json(await post({action:'sync-metadata',expectedOwnerId:ownerId}),'read complete account metadata');
  return {complete:result.complete,groups:result.groups,entries:result.entries};
 };
 const transport={metadata,write:async(command:any)=>{
  created.add(command.id);const response=await post({action:'sync-write',expectedOwnerId:ownerId,command});
  if(!response.ok()){evidence.checks.push(`conditional refusal ${response.status()}`);throw Object.assign(Error('Fixture write refused'),{status:response.status()});}
  return (await json(response,'acknowledge exact device write')).acknowledgment;
 }};
 const local=(action:string,fields:Record<string,unknown>,id:string=crypto.randomUUID(),revision=0)=>({action,...fields,id,revision,writeId:crypto.randomUUID()});
 try{
  const username='vaultreview-'+crypto.randomUUID().slice(0,8);
  ownerId=(await json(await context.post('/api/v1/auth/register',{headers,data:{username,email:username+'@example.test',password:crypto.randomUUID()+crypto.randomUUID()}}),'register disposable account')).user.id;
  db=new WorkspaceDatabase(new IDBFactory(),crypto.randomUUID(),10_000,IDBKeyRange);
  vault=new LocalProviderVault(db,{kind:'account',ownerId:ownerId!,origin:url.origin,dataPlane:'home'},{assertCurrent(){},onInvalidate:()=>()=>{}},url.origin);
  await vault.unlock('Synthetic independent review passphrase',true);
  const group=local('create-group',{name:'Device environment'}),child=local('save-secret',{name:'Device secret',key:'REVIEW_FIXTURE',value:'synthetic fixture only',groupId:group.id});
  await vault.mutate(group);await vault.mutate(child);
  await transport.write({action:'create-group',name:'Account environment',id:group.id,writeId:crypto.randomUUID(),expectedVersion:null});
  assert.equal((await vault.synchronize(transport)).completed,0);assert.equal((await vault.syncStatus())[0].state,'refused');
  const review=await vault.reviewRefused(group.id);assert.equal(review.items.length,2);const resolved=await vault.resolveRefused(group.id,review.reviewId,'copy',transport);
  assert.equal((await vault.synchronize(transport)).completed,2);assert.deepEqual(await vault.syncStatus(),[]);
  let snapshot=await metadata();assert.equal(snapshot.groups.length,2);assert.equal(snapshot.entries.length,1);
  assert.equal(snapshot.groups.find((x:any)=>x.id===group.id).name,'Account environment');
  assert.equal(snapshot.entries[0].groupId,resolved.copiedIds[group.id]);assert.equal(snapshot.entries[0].id,resolved.copiedIds[child.id]);
  evidence.checks.push('original account environment unchanged; copied child references copied environment');
  const copiedId=resolved.copiedIds[child.id],entry=(await vault.list()).entries.find(x=>x.id===copiedId)!;
  const thing=(await json(await context.get('/api/v1/things',{params:{id:copiedId}}),'read canonical private Thing')).thing;assert.deepEqual(thing.acl,['tt:user']);assert.equal(thing.author.id,ownerId);
  await vault.mutate(local('save-secret',{name:'Later local name',key:'REVIEW_FIXTURE',value:'later synthetic value',groupId:entry.groupId},copiedId,entry.revision));
  await json(await context.patch('/api/v1/things',{headers,data:{id:copiedId,expectedUpdatedAt:thing.updatedAt,crystal:{name:'New account name'}}}),'change account via normal generic editor');
  assert.equal((await vault.synchronize(transport)).completed,0);
  const later=await vault.reviewRefused(copiedId);await vault.resolveRefused(copiedId,later.reviewId,'account',transport);
  const adopted=(await vault.list()).entries.find(x=>x.id===copiedId)!;assert.equal(adopted.name,'New account name');assert.equal(adopted.valueAvailableOffline,false);assert.deepEqual(await vault.syncStatus(),[]);
  await assert.rejects(vault.reveal(copiedId),/not been retained/);snapshot=await metadata();assert.equal(snapshot.entries.length,1);evidence.checks.push('account resolution adopts fresh metadata without retaining or replacing its credential');
  evidence.complete=true;
 }finally{
  try{
   if(ownerId){
    const snapshot=await metadata();
    for(const entry of [...snapshot.entries,...snapshot.groups]){
     assert.ok(created.has(entry.id),'cleanup must use only this fixture ids');
     await json(await post({action:'delete',id:entry.id}),'cleanup fixture entry');
    }
    const remaining=await metadata();assert.deepEqual(remaining.entries,[]);assert.deepEqual(remaining.groups,[]);evidence.fixtureEntriesCleaned=true;
   }
   await mkdir(artifacts!,{recursive:true});await writeFile(artifacts+'/verification.json',JSON.stringify(evidence,null,2));
  }finally{vault?.dispose();await db?.close();await context.dispose();}
 }
});
