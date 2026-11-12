import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
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


test('dispatch timeout retains the real SDK start and subsequent late receipt attachment', async () => {
 const {isGatewayWorkIdle,reserveGatewayWorkShutdown}=await import('../deployment/environmentGateway');
 let accept!:(value:{runId:string})=>void,finishAttach!:()=>void,attached!:()=>void;
 const sdk=new Promise<{runId:string}>(resolve=>{accept=resolve;}),saved=new Promise<void>(resolve=>{finishAttach=resolve;}),ready=new Promise<void>(resolve=>{attached=resolve;});
 let starts=0;const keepAlive=setInterval(()=>{},1000);
 const dispatcher=createBackupDispatcher({jobs:{deferDispatch:async()=>true,reserveDispatch:async()=>({start:true,dispatchId:'exact-attempt'}) as any,
  attachWorkflow:async(...args)=>{assert.deepEqual(args,['job','exact-attempt','run']);attached();await saved;return true;},markDispatchUnconfirmed:async()=>{},retireInvalidAuthorization:async()=>false},start:()=>{starts++;return sdk;}});
 try{
  assert.equal(await dispatcher.dispatch('job','https://dispatch.test',false,20),'unconfirmed');
  assert.equal(isGatewayWorkIdle(),false);assert.equal(reserveGatewayWorkShutdown(),null);
  accept({runId:'run'});await ready;
  assert.equal(isGatewayWorkIdle(),false);assert.equal(reserveGatewayWorkShutdown(),null);
  finishAttach();await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(isGatewayWorkIdle(),true);assert.equal(starts,1);
 }finally{accept({runId:'run'});finishAttach();clearInterval(keepAlive);}
});

test('timed-out dispatch reservation remains tracked until its actual write settles', async()=>{
 const {isGatewayWorkIdle}=await import('../deployment/environmentGateway');
 let finish!:(value:any)=>void;const pending=new Promise<any>(resolve=>{finish=resolve;});let starts=0;
 const keepAlive=setInterval(()=>{},1000);
 const dispatcher=createBackupDispatcher({jobs:{deferDispatch:async()=>true,reserveDispatch:()=>pending,attachWorkflow:async()=>true,markDispatchUnconfirmed:async()=>{},retireInvalidAuthorization:async()=>false},start:async()=>{starts++;return {runId:'never'};}});
 try{
  await assert.rejects(dispatcher.dispatch('job','https://dispatch.test',false,20));
  assert.equal(isGatewayWorkIdle(),false);
  finish({start:true,dispatchId:'late'});await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(isGatewayWorkIdle(),true);assert.equal(starts,0);
 }finally{finish({start:false});clearInterval(keepAlive);}
});

for (const attached of [true,false]) test(`accepted dispatch attaches exactly once across the deadline (${attached ? 'current' : 'superseded'})`, async()=>{
 const {isGatewayWorkIdle,reserveGatewayWorkShutdown}=await import('../deployment/environmentGateway');
 let finish!:()=>void,started!:()=>void;
 const gate=new Promise<void>(resolve=>{finish=resolve;}),saving=new Promise<void>(resolve=>{started=resolve;});
 let starts=0,saves=0,uncertain=0;
 const dispatcher=createBackupDispatcher({jobs:{deferDispatch:async()=>true,reserveDispatch:async()=>({start:true,dispatchId:'attempt'}) as any,
  attachWorkflow:async(...args)=>{saves++;assert.deepEqual(args,['job','attempt','accepted']);started();await gate;return attached;},
  markDispatchUnconfirmed:async()=>{uncertain++;},retireInvalidAuthorization:async()=>false},start:async()=>{starts++;return {runId:'accepted'};}});
 const keepAlive=setInterval(()=>{},1000);
 try{
  const result=dispatcher.dispatch('job','https://dispatch.test',false,20);
  await saving;
  assert.equal(saves,1);
  assert.equal(await result,'unconfirmed');
  assert.equal(uncertain,1);
  assert.equal(reserveGatewayWorkShutdown(),null);
  finish();await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(isGatewayWorkIdle(),true);
  assert.equal(starts,1);assert.equal(saves,1);
 }finally{finish();clearInterval(keepAlive);}
});

test('abort between SDK acceptance and wrapper observation cannot lose the exact receipt',async()=>{
 const {isGatewayWorkIdle}=await import('../deployment/environmentGateway');
 const controller=new AbortController();
 const timeout=mock.method(AbortSignal,'timeout',()=>controller.signal);
 const receipts:unknown[][]=[];
 let starts=0;
 const dispatcher=createBackupDispatcher({jobs:{deferDispatch:async()=>true,reserveDispatch:async()=>({start:true,dispatchId:'microtask-attempt'}) as any,
  attachWorkflow:async(...args)=>{receipts.push(args);return true;},markDispatchUnconfirmed:async()=>{},retireInvalidAuthorization:async()=>false},
  start:async()=>{
   starts++;
   // The SDK continuation runs between these two microtasks. Previously it
   // checked aborted=false, then lost its attachment when the wrapper rejected.
   queueMicrotask(()=>queueMicrotask(()=>controller.abort(new Error('deadline'))));
   return {runId:'accepted-once'};
  }});
 try{
  assert.equal(await dispatcher.dispatch('job','https://dispatch.test'),'unconfirmed');
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(receipts,[['job','microtask-attempt','accepted-once']]);
  assert.equal(starts,1);assert.equal(isGatewayWorkIdle(),true);
 }finally{timeout.mock.restore();}
});
