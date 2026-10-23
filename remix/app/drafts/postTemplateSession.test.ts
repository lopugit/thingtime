import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostTemplateSession } from './postTemplateSession';
const lease={assertCurrent(){},onInvalidate:()=>()=>{}};
test('template menu coalesces duplicate clicks and keeps the same copy ID after an uncertain failure',async()=>{
 const calls:any[]=[];let release!:(value:any)=>void,reject!:(reason:any)=>void,ids=0;
 const request=(async(actor:string,input:any)=>{calls.push({actor,input});return new Promise((resolve,fail)=>{release=resolve;reject=fail;});}) as any;
 const session=createPostTemplateSession('owner','source',lease,request,()=>`copy-${++ids}`);
 const first=session.save(),duplicate=session.save();assert.equal(first,duplicate);assert.equal(calls.length,1);
 reject(Error('Lost receipt'));await assert.rejects(first,/Lost receipt/);
 const retry=session.save();assert.deepEqual(calls[1],calls[0]);release({ok:true});await retry;
 const next=session.save();assert.notEqual(calls[2].input.id,calls[0].input.id);release({ok:true});await next;
 assert.equal(calls[0].actor,'owner');assert.equal(calls[0].input.operation,'from-post');assert.equal(calls[0].input.postId,'source');
});
test('retired account/origin/plane and unmounted menus refuse old callbacks and suppress late completions',async()=>{
 for(const unmount of [false,true]){
  let active=true,calls=0,release!:(value:any)=>void;
  const bound={assertCurrent(){if(!active)throw Error('Workspace retired');},onInvalidate:()=>()=>{}};
  const request=(async()=>{calls++;return new Promise(resolve=>{release=resolve;});}) as any;
  const session=createPostTemplateSession('owner','post',bound,request,()=> 'copy');
  const pending=session.save();if(unmount)session.dispose();else active=false;
  release({ok:true});await assert.rejects(pending,/retired|changed/);assert.equal(session.isCurrent(),false);
  await assert.rejects(session.save(),/retired|changed/);assert.equal(calls,1);
 }
});
