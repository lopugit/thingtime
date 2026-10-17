import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { WorkspaceDatabase } from './storage';
import { AccountDiscussionCache } from './accountDiscussions';
import { AccountPostCache } from './accountPosts';
import { AccountThingSync } from './accountSync';
import { localThingReadProjection, postThreadContext } from './posts';
import type { LocalThing } from './things';
const scope={kind:'account',origin:'https://context.test',ownerId:'owner',dataPlane:'home'} as const;
const lease={assertCurrent(){},onInvalidate:()=>()=>{}},stamp='2026-10-17T00:00:00Z';
const author={id:'owner',username:'owner',displayName:'Owner',avatarUrl:null};
const post=(id:string,targetId:string|null=null,kind='post')=>({id,targetId,thingtime:targetId?['post','comment']:[kind],text:id,type:'text',createdAt:stamp,author:{...author,id:'foreign',username:'foreign'},acl:targetId?['tt:inherit']:['tt:user'],visibility:'private',comments:[],repliesLoaded:false,attachments:[]});
const local=(id:string,targetId?:string,kind='post'):LocalThing=>({id,targetId,thingtime:targetId?['post','comment']:[kind],crystal:{type:'text',text:id},createdAt:stamp,updatedAt:stamp,revision:1});
function fixture(){const db=new WorkspaceDatabase(new IDBFactory(),undefined,undefined,IDBKeyRange);return {db,posts:new AccountPostCache(db,scope,lease),discussions:new AccountDiscussionCache(db,scope,lease),sync:new AccountThingSync(db,scope,lease)};}

test('anonymous post and generic-Thing conversations resolve parents and roots from the same local snapshot',()=>{
 for(const kind of ['post','data']){
  const rows=[local('root',undefined,kind),local('comment','root'),local('reply','comment')];
  const result=localThingReadProjection(rows[2],rows,'local-workspace');
  assert.equal(result.parent?.id,'comment');assert.equal(result.root?.id,'root');assert.equal(result.root?.thingtime[0],kind);
  assert.equal(result.parent?.author?.id,'local-workspace');
  assert.equal(localThingReadProjection(rows[2],rows,'local-workspace',true).parent,null);
  assert.equal(localThingReadProjection(rows[2],rows.slice(1),'local-workspace').root,null);
 }
 const cycle=[local('a','b'),local('b','a')];assert.equal(postThreadContext(cycle[0],id=>cycle.find(row=>row.id===id)).root,null);
 const missing=local('missing','unknown');assert.deepEqual(postThreadContext(missing,()=>null),{parent:null,root:null});
 const deep=[local('root'),...Array.from({length:70},(_,i)=>local('depth-'+i,i?'depth-'+(i-1):'root'))];const byId=new Map(deep.map(row=>[row.id,row]));
 const context=postThreadContext(deep.at(-1)!,id=>byId.get(id));assert.equal(context.parent?.id,'depth-68');assert.equal(context.root?.id,'root');
});

test('retained foreign and generic context preserves authors without admitting owned Things',async()=>{
 const f=fixture();try{
  await f.discussions.remember(post('root',null,'component'),10);
  await f.posts.remember([post('comment','root'),post('reply','comment')],10);
  const context=await f.discussions.threadContext('reply',author);
  assert.equal(context.parent?.id,'comment');assert.equal(context.root?.id,'root');assert.equal(context.root?.author?.id,'foreign');
  await f.db.transaction(scope,'readonly',lease,async tx=>{assert.deepEqual(await tx.list('things'),[]);assert.deepEqual(await tx.list('thing-sync'),[]);});
  assert.deepEqual(await new AccountDiscussionCache(f.db,{...scope,ownerId:'other'},lease).threadContext('reply',author),{parent:null,root:null});
  assert.deepEqual(await new AccountDiscussionCache(f.db,{...scope,dataPlane:'other'},lease).threadContext('reply',author),{parent:null,root:null});
 }finally{await f.db.close();}
});

test('owned device edits outrank stale read context; refusal hides links but preserves pending work',async()=>{
 const f=fixture();try{
  for(const row of [local('root'),local('comment','root'),local('reply','comment')])await f.sync.remember({...row,author,acl:row.targetId?['tt:inherit']:['tt:user'],visibility:'private'} as any);
  await f.posts.remember([post('root'),post('comment','root'),post('reply','comment')],10);
  await f.sync.things.savePost({id:'root',crystal:{text:'Edited on device'}},true);
  const context=await f.discussions.threadContext('reply',author);assert.equal(context.root?.text,'Edited on device');assert.equal(context.root?.author?.id,'owner');
  await f.discussions.forget('root',Date.now()+1);
  assert.deepEqual(await f.discussions.threadContext('reply',author),{parent:null,root:null});assert.equal((await f.sync.view('root'))?.crystal.text,'Edited on device');
 }finally{await f.db.close();}
});

test('authorized root context survives unvisited intermediate ancestors and is removed with root refusal',async()=>{
 const f=fixture();try{
  const leaf=post('leaf','parent'),parent=post('parent','unvisited'),root=post('root');
  await f.posts.remember([leaf,parent,root],10,{id:'leaf',parent:'parent',root:'root'});
  assert.deepEqual(Object.fromEntries(Object.entries(await f.discussions.threadContext('leaf',author)).map(([key,value])=>[key,value?.id])),{parent:'parent',root:'root'});
  await f.posts.remember([{...leaf,text:'Updated'}],11);assert.equal((await f.discussions.threadContext('leaf',author)).root?.id,'root');
  await f.discussions.remember({...leaf,text:'Newer discussion read'},12);assert.equal((await f.discussions.threadContext('leaf',author)).root?.id,'root','direct discussion reads cannot discard canonical thread context');
  await f.discussions.forget('root',20);assert.equal(await f.posts.get('leaf'),null);
  await f.posts.remember([leaf,parent,root],19,{id:'leaf',parent:'parent',root:'root'});assert.equal(await f.posts.get('leaf'),null);
  assert.deepEqual(await f.discussions.threadContext('leaf',author),{parent:null,root:null});
 }finally{await f.db.close();}
});


test('pending parent deletion hides retained foreign descendants and stored root shortcuts',async()=>{
 const f=fixture();try{
  await f.sync.remember({...local('root'),author,acl:['tt:user'],visibility:'private'} as any);
  await f.posts.remember([post('root'),post('foreign','root'),post('reply','foreign')],10,{id:'reply',parent:'foreign',root:'root'});
  await f.sync.remove(['root']);
  assert.deepEqual(await f.discussions.threadContext('reply',author),{parent:null,root:null});
  assert.equal((await f.posts.get('foreign'))?.id,'foreign','display snapshots do not grant a link past a local deletion');
 }finally{await f.db.close();}
});
