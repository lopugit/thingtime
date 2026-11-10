import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { AccountDraftCatalog } from './accountDraftCatalog';
import { AccountDraftSync } from './accountDrafts';
import { WorkspaceDatabase } from './storage';
const scope={kind:'account',origin:'https://draft.test',ownerId:'owner',dataPlane:'home'} as const;
const lease={assertCurrent(){},onInvalidate:()=>()=>{}};
const row=(n:number)=>({id:'draft-'+n,name:'Draft '+n,mode:'draft' as const,surface:'post' as const,context:'post:new:',revision:7,createdAt:new Date(1700000000000-n*1000).toISOString(),updatedAt:new Date(1700000000000).toISOString()});
test('cached discovery pages merge local edits and tombstones without downloading bodies or losing remote continuations',async()=>{
 const db=new WorkspaceDatabase(new IDBFactory(),undefined,undefined,IDBKeyRange),catalog=new AccountDraftCatalog(db,scope,lease),sync=new AccountDraftSync(db,scope,lease);
 try{
  await catalog.remember({surface:'post'},null,{drafts:Array.from({length:30},(_,i)=>row(i)),nextCursor:'next-page'},1);
  await sync.remember({...row(0),snapshot:'{}',attachmentIds:[]},2);
  await sync.drafts.request({operation:'save',id:'draft-0',revision:1,writeId:'local-edit',content:{...row(0),name:'Edited locally',snapshot:'{}',attachmentIds:[]}});
  await sync.remember({...row(1),snapshot:'{}',attachmentIds:[]},2);
  await sync.drafts.request({operation:'delete',id:'draft-1',revision:1});
  const first=await catalog.list({surface:'post'});assert.equal(first.drafts.length,29);assert.equal(first.drafts[0].name,'Edited locally');assert.equal(first.drafts[0].revision,2);assert.ok(first.nextCursor);
  assert.equal((await catalog.list({surface:'post',cursor:first.nextCursor!})).needsPage,true);
  await catalog.remember({surface:'post'},'next-page',{drafts:[row(30)],nextCursor:null},3);
  const next=await catalog.list({surface:'post',cursor:first.nextCursor!});assert.deepEqual(next.drafts.map(x=>x.id),['draft-30']);assert.equal(next.nextCursor,null);
  const other=new AccountDraftCatalog(db,{...scope,dataPlane:'other'},lease);
  await assert.rejects(other.list({surface:'post',cursor:first.nextCursor!}),/Refresh/);
  await catalog.remember({surface:'post'},null,{drafts:[row(0)],nextCursor:null},4);
  await assert.rejects(catalog.list({surface:'post',cursor:first.nextCursor!}),/Refresh/);
  assert.equal((await sync.drafts.request(undefined,{id:'draft-0'})).draft.name,'Edited locally');
 }finally{await db.close();}
});
test('summary admission validates bounds and preserves the last good page against malformed and late replies',async()=>{
 const db=new WorkspaceDatabase(new IDBFactory(),undefined,undefined,IDBKeyRange),catalog=new AccountDraftCatalog(db,scope,lease);
 try{
  await catalog.remember({},null,{drafts:[row(1)],nextCursor:null},3);
  assert.equal(await catalog.remember({},null,{drafts:[row(2)],nextCursor:null},2),false);
  for(const response of [{drafts:[row(1),row(1)],nextCursor:null},{drafts:[{...row(1),mode:'owner'}],nextCursor:null},{drafts:Array.from({length:31},(_,i)=>row(i)),nextCursor:null}]) await assert.rejects(catalog.remember({},null,response as any,4));
  assert.deepEqual((await catalog.list()).drafts.map(x=>x.id),['draft-1']);
  await db.transaction(scope,'readonly',lease,async tx=>assert.equal((await tx.list('drafts')).length,0,'Summaries do not invent complete editable drafts'));
 }finally{await db.close();}
});
