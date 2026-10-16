import assert from 'node:assert/strict';
import test from 'node:test';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {AccountDraftSync} from './accountDrafts';
import {AccountDraftClient} from './accountDraftClient.client';
import {AccountDraftCatalog} from './accountDraftCatalog';
import {AccountFileSync} from './accountFiles';
import {WorkspaceDatabase} from './storage';
const scope={kind:'account',origin:'https://draft.test',ownerId:'owner',dataPlane:'home'} as const,lease={assertCurrent(){},onInvalidate:()=>()=>{}};
const content={name:'Native draft',surface:'post',context:'post:new:',snapshot:'{"text":"Saved offline"}',attachmentIds:[]};
test('native adapter saves, loads and discards offline without calling account transport',async()=>{
 const db=new WorkspaceDatabase(new IDBFactory(),undefined,undefined,IDBKeyRange),files=new AccountFileSync(db,scope,lease),drafts=new AccountDraftSync(db,scope,lease,files.draftHooks),catalog=new AccountDraftCatalog(db,scope,lease);
 let calls=0,wakes=0;const remote=async()=>{calls++;throw Error('Must not access account');};
 const client=new AccountDraftClient({db,lease,files,drafts,catalog,wake(){wakes++;},transport:{drafts:{read:remote,write:remote,list:remote},files:{retention:remote,bytes:remote}}},scope,()=>false,()=>{});
 try{
  const saved=await client.request({operation:'save',id:'draft',writeId:'write',revision:0,content});assert.equal(saved.draft.revision,1);
  assert.equal((await client.request(undefined,{id:'draft'})).draft.snapshot,content.snapshot);
  const list=await client.request();assert.deepEqual(list.drafts.map((x:any)=>x.id),['draft']);assert.equal(list.partial,true);
  await client.request({operation:'delete',id:'draft',revision:1});assert.deepEqual((await client.request()).drafts,[]);
  await assert.rejects(client.request(undefined,{id:'uncached'}),/Reconnect/);
  await assert.rejects(client.request({operation:'delete',id:'uncached',revision:1}),/Reconnect/);
  assert.equal(calls,0);assert.equal(wakes,2);
 }finally{await db.close();}
});
test('summary discovery fetches no bodies; exact reads retain once with a separate local revision',async()=>{
 const db=new WorkspaceDatabase(new IDBFactory(),undefined,undefined,IDBKeyRange),files=new AccountFileSync(db,scope,lease),drafts=new AccountDraftSync(db,scope,lease,files.draftHooks),catalog=new AccountDraftCatalog(db,scope,lease);
 const remote={...content,surface:'post' as const,id:'remote',mode:'draft' as const,revision:7,createdAt:'2026-10-17T00:00:00Z',updatedAt:'2026-10-17T00:00:00Z'};
 let reads=0,online=true;const fail=async()=>{throw Error('Unexpected media/write');};
 const client=new AccountDraftClient({db,lease,files,drafts,catalog,wake(){},transport:{drafts:{read:async()=>{reads++;return remote;},write:fail,list:async()=>({drafts:[remote],nextCursor:null})},files:{retention:fail,bytes:fail}}},scope,()=>online,()=>{});
 try{
  assert.equal((await client.request()).drafts[0].revision,7);assert.equal(reads,0);
  const loaded=await client.request(undefined,{id:remote.id});assert.equal(loaded.draft.revision,1);assert.equal(reads,1);
  online=false;await client.request({operation:'save',id:remote.id,writeId:'offline',revision:1,content:{...content,name:'Offline edit'}});
  assert.equal((await client.request()).drafts[0].name,'Offline edit');assert.equal(reads,1);
 }finally{await db.close();}
});

test('discarding an uncached summary checks the revision of the actual retained body',async()=>{
 const db=new WorkspaceDatabase(new IDBFactory(),undefined,undefined,IDBKeyRange),files=new AccountFileSync(db,scope,lease),drafts=new AccountDraftSync(db,scope,lease,files.draftHooks),catalog=new AccountDraftCatalog(db,scope,lease);
 const remote={...content,surface:'post' as const,id:'changed',mode:'draft' as const,revision:8,createdAt:'2026-10-17T00:00:00Z',updatedAt:'2026-10-17T00:00:00Z'};
 let reads=0;const fail=async()=>{throw Error('Unexpected write');};
 const client=new AccountDraftClient({db,lease,files,drafts,catalog,wake(){},transport:{drafts:{read:async()=>{reads++;return remote;},write:fail,list:async()=>({drafts:[],nextCursor:null})},files:{retention:fail,bytes:fail}}},scope,()=>true,()=>{});
 try{
  await assert.rejects(client.request({operation:'delete',id:'changed',revision:7}),/changed.*Refresh/);
  assert.equal(reads,1);
  assert.equal((await drafts.drafts.request(undefined,{id:'changed'})).draft.snapshot,content.snapshot);
  assert.equal((await drafts.status())[0].state,'synced');
 }finally{await db.close();}
});

test('account-only post templates use the canonical copy and retain the result; offline never calls it',async()=>{
 const db=new WorkspaceDatabase(new IDBFactory(),undefined,undefined,IDBKeyRange),files=new AccountFileSync(db,scope,lease),drafts=new AccountDraftSync(db,scope,lease,files.draftHooks),catalog=new AccountDraftCatalog(db,scope,lease);
 const remote={...content,surface:'post' as const,id:'template',mode:'template' as const,revision:1,createdAt:'2026-10-17T00:00:00Z',updatedAt:'2026-10-17T00:00:00Z'};
 const commands:unknown[]=[];let online=false;const fail=async()=>{throw Error('Unexpected write');};
 const client=new AccountDraftClient({db,lease,files,drafts,catalog,wake(){},transport:{drafts:{read:async()=>remote,write:fail,list:async()=>({drafts:[],nextCursor:null}),fromPost:async input=>{commands.push(structuredClone(input));return {ok:true,draft:remote};}},files:{retention:fail,bytes:fail}}},scope,()=>online,()=>{});
 try{
  const input={operation:'from-post',postId:'shared-post',id:'template'};
  await assert.rejects(client.request(input),/Reconnect/);assert.deepEqual(commands,[]);
  online=true;const result=await client.request(input);assert.equal(result.draft.mode,'template');assert.deepEqual(commands,[input]);
  online=false;const copy=await client.request({operation:'instantiate',sourceId:'template',id:'working-copy'});
  assert.equal(copy.draft.mode,'draft');assert.equal(copy.draft.snapshot,content.snapshot);
  assert.equal((await client.request(undefined,{id:'template'})).draft.mode,'template');
 }finally{await db.close();}
});
