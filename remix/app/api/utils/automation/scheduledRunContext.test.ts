import assert from 'node:assert/strict';
import test from 'node:test';
import { recordScheduledPassResult, currentScheduledRunCorrelation, observeScheduledPeerEvent, scheduledRunExecution, sanitizeScheduledRunSummary, type ScheduledRunContext } from './scheduledRunContext';
import { createScheduledRunReporter } from './scheduledRunReporting';
const correlation={runId:'12345678-1234-4234-9234-123456789012',jobName:'Process recordings and scheduled work' as const,path:'/api/v1/lopu/recordings/run' as const,startedAt:'2026-11-15T00:00:00Z'};
test('fixed summaries retain numeric actual pass outcomes while dropping all payload/error fields',()=>{
 const context:ScheduledRunContext={correlation};
 scheduledRunExecution.run(context,()=>{
  assert.equal(currentScheduledRunCorrelation()?.runId,correlation.runId);
  recordScheduledPassResult(correlation.path,{recordings:{processed:3,queued:4,outcomes:['done','failed','retry'],error:'private provider output'},reminders:{sent:1,failed:2},secret:'token'});
 });
 assert.equal(context.summary?.outcome,'partial-failure');
 assert.equal(context.summary?.counts['recordings.completed'],1);assert.equal(context.summary?.counts['recordings.failed'],1);assert.equal(context.summary?.counts['recordings.retry'],1);
 assert.ok(!JSON.stringify(context.summary).includes('private'));assert.ok(!JSON.stringify(context.summary).includes('token'));
 assert.equal(currentScheduledRunCorrelation(),undefined);
});
test('dispatch summaries, partial email queue failures and provider failure statuses remain distinct',()=>{
 for(const [path,result,outcome] of [
  ['/api/v1/backups/run',{dispatch:{attached:2,unconfirmed:0}},'dispatched'],
  ['/api/v1/notifications/email/weekly-summary',{sent:1,skipped:{failed:1,alreadySent:3}},'partial-failure'],
  ['/api/v1/ai/models/sync',{report:[{status:'synced',count:19},{status:'failed',reason:'private'}]},'partial-failure']
 ] as const){
  const context:ScheduledRunContext={correlation:{...correlation,path:path as any}};
  scheduledRunExecution.run(context,()=>recordScheduledPassResult(path,result));assert.equal(context.summary?.outcome,outcome);
 }
 assert.deepEqual(sanitizeScheduledRunSummary({outcome:'success',counts:{failed:1,secret:2,scanned:Infinity,deleted:-1}}).counts,{failed:1});
});
test('consumed peer warnings and complete metadata affect actual terminal status',async()=>{
 const events:any[]=[];const report=createScheduledRunReporter({getSecret:()=> 'fixture',sink:async event=>{events.push(event);}});
 const response=await report(new Request('https://test/api/v1/peers/sync',{headers:{Authorization:'Bearer fixture'}}),'/api/v1/peers/sync',async()=>new Response(new ReadableStream({pull(controller){observeScheduledPeerEvent({type:'peer.warning',message:'private warning',origin:'private origin'});observeScheduledPeerEvent({type:'complete',discovered:2,probed:3});controller.enqueue(new Uint8Array([1]));controller.close();}},{highWaterMark:0})));
 await response.arrayBuffer();assert.equal(events.at(-1).status,'failed');assert.equal(events.at(-1).summary.counts.warnings,1);assert.equal(events.at(-1).summary.counts.probed,3);assert.ok(!JSON.stringify(events).includes('private'));
});
