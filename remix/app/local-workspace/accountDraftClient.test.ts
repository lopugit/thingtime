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

test('explicit account review reads fresh source without retaining bodies, files, catalogue or write intent',async()=>{
 const db=new WorkspaceDatabase(new IDBFactory(),undefined,undefined,IDBKeyRange),files=new AccountFileSync(db,scope,lease),drafts=new AccountDraftSync(db,scope,lease,files.draftHooks),catalog=new AccountDraftCatalog(db,scope,lease);
 const context='comment:plain:target',remote={...content,surface:'comment' as const,context,id:'original',mode:'template' as const,revision:7,createdAt:'2026-10-17T00:00:00Z',updatedAt:'2026-10-17T00:00:00Z',attachmentIds:['original-file']};
 const calls:unknown[]=[];let reads=0,online=true;
 const fail=async()=>{assert.fail('Review must not write or fetch media');};
 const client=new AccountDraftClient({db,lease,files,drafts,catalog,wake:()=>assert.fail('Review must not wake sync'),transport:{drafts:{read:async()=>{reads++;return remote;},write:fail,list:async query=>{calls.push(query);return {drafts:[remote],nextCursor:'next'};}},files:{retention:fail,bytes:fail}}},scope,()=>online,()=>assert.fail('Review must not change workspace data'));
 try{
  const page=await client.reviewList(context);assert.equal(page.drafts[0].id,'original');assert.equal('snapshot' in page.drafts[0],false);assert.equal(reads,0);assert.equal(page.nextCursor,'next');
  await client.reviewList(context,'next-page');assert.deepEqual(calls,[{surface:'comment',context},{surface:'comment',context,cursor:'next-page'}]);
  assert.equal((await client.reviewRead('original')).revision,7);remote.revision=8;assert.equal((await client.reviewRead('original')).revision,8);assert.equal(reads,2);
  assert.deepEqual(await db.transaction(scope,'readonly',lease,tx=>tx.usage()),{records:0,bytes:0});
  // Even a locally retained draft must not mask a newer account review.
  await drafts.remember({...remote,attachmentIds:[],snapshot:'{"text":"Old retained body"}'});
  const before=await db.transaction(scope,'readonly',lease,tx=>tx.usage());
  assert.equal((await client.reviewRead('original')).snapshot,remote.snapshot);
  assert.equal((await drafts.drafts.request(undefined,{id:'original'})).draft.snapshot,'{"text":"Old retained body"}');
  assert.deepEqual(await db.transaction(scope,'readonly',lease,tx=>tx.usage()),before);
  online=false;await assert.rejects(client.reviewRead('original'),/Reconnect/);await assert.rejects(client.reviewList(context),/Reconnect/);assert.equal(reads,3);
 }finally{await db.close();}
});

test('account review rejects invalid pages, wrong IDs and delayed results after workspace retirement',async()=>{
 let active=true,release!:(value:any)=>void;const bound={assertCurrent(){if(!active)throw Error('Retired workspace');},onInvalidate:()=>()=>{}};
 const db=new WorkspaceDatabase(new IDBFactory(),undefined,undefined,IDBKeyRange),files=new AccountFileSync(db,scope,bound),drafts=new AccountDraftSync(db,scope,bound,files.draftHooks),catalog=new AccountDraftCatalog(db,scope,bound);
 const context='comment:plain:target',remote={...content,surface:'comment' as const,context,id:'original',mode:'draft' as const,revision:1,createdAt:'2026-10-17T00:00:00Z',updatedAt:'2026-10-17T00:00:00Z'};
 let page:any={drafts:[{...remote,context:'wrong'}],nextCursor:null},defer=false,calls=0;
 const fail=async()=>{assert.fail('No writes or media');};
 const client=new AccountDraftClient({db,lease:bound,files,drafts,catalog,wake(){},transport:{drafts:{read:async()=>{calls++;return defer?new Promise(resolve=>{release=resolve;}):{...remote,id:'wrong'};},write:fail,list:async()=>{calls++;return defer?new Promise(resolve=>{release=resolve;}):page;}},files:{retention:fail,bytes:fail}}},scope,()=>true,()=>{});
 try{
  await assert.rejects(client.reviewList(context),/invalid data/);page={drafts:[remote,remote],nextCursor:null};await assert.rejects(client.reviewList(context),/invalid data/);
  page={drafts:Array(31).fill(remote),nextCursor:null};await assert.rejects(client.reviewList(context),/invalid data/);
  page={drafts:[remote],nextCursor:'loop'};await assert.rejects(client.reviewList(context,'loop'),/invalid data/);
  const before=calls;await assert.rejects(client.reviewList(''),/Choose a comment/);await assert.rejects(client.reviewList(context,'x'.repeat(257)),/invalid data/);await assert.rejects(client.reviewRead('../bad'),/Invalid draft/);assert.equal(calls,before);
  await assert.rejects(client.reviewRead('original'),/invalid draft/);
  defer=true;const read=client.reviewRead('original');active=false;release(remote);await assert.rejects(read,/Retired/);
  active=true;const list=client.reviewList(context);active=false;release({drafts:[remote],nextCursor:null});await assert.rejects(list,/Retired/);
 }finally{await db.close();}
});
