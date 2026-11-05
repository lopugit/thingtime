import assert from 'node:assert/strict';
import test from 'node:test';
import { createSyncPump } from './syncPump';
const gate = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return {promise,release}; };
test('a stalled draft pass cannot block a later content pass and retains one pending wake',async()=>{
 const held=gate(),entered=gate(),contentDone=gate(),second=gate();let drafts=0,content=0;
 const draftPump=createSyncPump(()=>true,async()=>{drafts++;if(drafts===1){entered.release();await held.promise;}else second.release();return null;});
 const contentPump=createSyncPump(()=>true,async()=>{content++;contentDone.release();return null;});
 try{
  draftPump.wake();await entered.promise;draftPump.wake();draftPump.wake();contentPump.wake();
  await contentDone.promise;assert.equal(content,1);assert.equal(drafts,1);
  held.release();await second.promise;assert.equal(drafts,2);
 }finally{held.release();draftPump.stop();contentPump.stop();}
});
test('stopping during a pass drops its queued wake',async()=>{
 const held=gate(),entered=gate(),finished=gate();let calls=0;
 const pump=createSyncPump(()=>true,async()=>{calls++;entered.release();await held.promise;finished.release();return 1000;});
 pump.wake();await entered.promise;pump.wake();pump.stop();held.release();await finished.promise;
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(calls,1);
});
