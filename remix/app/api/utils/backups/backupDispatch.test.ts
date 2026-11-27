import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBackupDispatcher } from './backupDispatch.server';
test('outbox advances past a stale first page and keeps original scan cutoff',async()=>{
 const pages:any[]=[],started:string[]=[],retired:string[]=[];let n=0;
 const dispatcher=createBackupDispatcher({now:()=>1000,due:async(_origin,before,after)=>{assert.equal(before,1000);pages.push(after);return n++===0?{items:Array.from({length:25},(_,i)=>'stale-'+i),next:{at:900,id:'last'}}:{items:['valid-26'],next:null};},
 jobs:{deferDispatch:async()=>true,reserveDispatch:async(id)=>{if(id.startsWith('stale'))throw Error('original revoked');return {start:true,dispatchId:'attempt'} as any;},attachWorkflow:async()=>true,markDispatchUnconfirmed:async()=>{},retireInvalidAuthorization:async(id)=>{retired.push(id);return true;}},
 start:async(id)=>{started.push(id);return {runId:'run'};}});
 const result=await dispatcher.drain('https://dispatch.test');assert.equal(result.examined,26);assert.equal(result.retired,25);assert.equal(result.attached,1);assert.deepEqual(started,['valid-26']);assert.deepEqual(pages,[undefined,{at:900,id:'last'}]);assert.equal(retired.length,25);
});
test('transient authority read failures remain unavailable and do not stop later work',async()=>{
 const dispatcher=createBackupDispatcher({now:()=>1000,due:async()=>({items:['transient','healthy'],next:null}),
 jobs:{deferDispatch:async()=>true,reserveDispatch:async(id)=>{if(id==='transient')throw Error('database unavailable');return {start:true,dispatchId:'attempt'} as any;},attachWorkflow:async()=>true,markDispatchUnconfirmed:async()=>{},retireInvalidAuthorization:async()=>{throw Error('database unavailable');}},start:async()=>({runId:'run'})});
 assert.deepEqual(await dispatcher.drain('https://dispatch.test'),{examined:2,attached:1,unconfirmed:0,skipped:0,retired:0,unavailable:1});
});
test('uncertain SDK scheduling preserves one attempt and accepts a late receipt through exact fencing',async()=>{
 let resolve!:(v:{runId:string})=>void;const late=new Promise<{runId:string}>(r=>resolve=r),receipts:any[]=[],uncertain:any[]=[];
 const dispatcher=createBackupDispatcher({jobs:{deferDispatch:async()=>true,reserveDispatch:async()=>({start:true,dispatchId:'fixed-attempt'}) as any,attachWorkflow:async(...args)=>{receipts.push(args);return false;},markDispatchUnconfirmed:async(...args)=>{uncertain.push(args);},retireInvalidAuthorization:async()=>false},start:()=>late});
 assert.equal(await dispatcher.dispatch('job','https://dispatch.test',false,20),'unconfirmed');assert.deepEqual(uncertain,[['job','fixed-attempt']]);resolve({runId:'accepted-run'});await new Promise(r=>setImmediate(r));assert.deepEqual(receipts,[['job','fixed-attempt','accepted-run']]);
});

test('slow transient rows back off durably so the next drain reaches later healthy work',async()=>{
 let clock=1000;const deferred=new Set<string>(),started:string[]=[];
 const dispatcher=createBackupDispatcher({now:()=>clock,due:async()=>({items:['slow-a','slow-b','healthy'].filter(id=>!deferred.has(id)),next:null}),
 jobs:{reserveDispatch:async(id)=>{if(id.startsWith('slow')){clock+=21000;throw Error('slow authority outage');}return {start:true,dispatchId:'attempt'} as any;},attachWorkflow:async()=>true,markDispatchUnconfirmed:async()=>{},retireInvalidAuthorization:async()=>false,deferDispatch:async(id)=>{deferred.add(id);return true;}},start:async(id)=>{started.push(id);return {runId:'run'};}});
 assert.equal((await dispatcher.drain('https://dispatch.test')).examined,2);assert.deepEqual([...deferred],['slow-a','slow-b']);
 assert.equal((await dispatcher.drain('https://dispatch.test')).attached,1);assert.deepEqual(started,['healthy']);
});
