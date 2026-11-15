import { AsyncLocalStorage } from 'node:async_hooks';
import type { ScheduledRunEvent } from './scheduledRunReporting';
export type ScheduledRunCorrelation = Pick<ScheduledRunEvent,'runId'|'jobName'|'path'|'startedAt'>;
export type ScheduledRunSummary = { outcome:'success'|'partial-failure'|'dispatched'|'failed';counts:Record<string,number> };
const fields=['scanned','analyzed','flagged','failed','released','deleted','examined','attached','unconfirmed','skipped','retired','unavailable','sent','processed','completed','cancelled','stopped','discovered','probed','warnings','synced','models','busy','hasMore','dispatched','queued','transcribed','created','delivered','needsAttention','repaired','recovered','attempted','deferred','considered','eligible','alreadySent','noActivity','paused','retry'] as const;
const scopes=['text','attachments','reminders','scheduledReminders','recordings','handoffs','storageRecovery','dispatch','skipped'] as const;
const allowed=new Set<string>([...fields,...scopes.flatMap(scope=>fields.map(field=>`${scope}.${field}`))]);
export const sanitizeScheduledRunSummary = (summary:ScheduledRunSummary):ScheduledRunSummary => {
 const counts:Record<string,number>={};
 for(const [key,value] of Object.entries(summary.counts)) if(allowed.has(key)&&Number.isSafeInteger(value)&&value>=0) counts[key]=value;
 return {outcome:['success','partial-failure','dispatched','failed'].includes(summary.outcome)?summary.outcome:'failed',counts};
};
export type ScheduledRunContext = {correlation:ScheduledRunCorrelation;summary?:ScheduledRunSummary};
export const scheduledRunExecution = new AsyncLocalStorage<ScheduledRunContext>();
export const currentScheduledRunCorrelation = () => scheduledRunExecution.getStore()?.correlation;
export const recordScheduledPassResult = (path:string,value:any) => {
 const context=scheduledRunExecution.getStore(); if(!context || context.correlation.path!==path)return;
 const counts:Record<string,number>={};
 const pick=(row:any,prefix='')=>{for(const key of fields){const v=row?.[key];if(Number.isSafeInteger(v)&&v>=0)counts[prefix+key]=v;else if(typeof v==='boolean'&&['busy','hasMore','unavailable'].includes(key))counts[prefix+key]=Number(v);}};
 pick(value);for(const scope of scopes)pick(value?.[scope],scope+'.');
 if(Array.isArray(value?.report))for(const row of value.report){if(['synced','failed','skipped'].includes(row?.status))counts[row.status]=(counts[row.status]??0)+1;if(Number.isSafeInteger(row?.count)&&row.count>=0)counts.models=(counts.models??0)+row.count;}
 if(Array.isArray(value?.recordings?.outcomes))for(const status of value.recordings.outcomes){if(['done','failed','paused','retry'].includes(status)){const key='recordings.'+(status==='done'?'completed':status);counts[key]=(counts[key]??0)+1;}}
 if(typeof value?.continuationRunId==='string')counts.dispatched=1;
 const failed=value?.ok===false || Object.entries(counts).some(([key,v])=>v>0&&/(?:^|\.)(?:failed|unavailable|unconfirmed|needsAttention|paused|retry)$/.test(key));
 const dispatched=Object.entries(counts).some(([key,v])=>v>0&&/(?:^|\.)(?:attached|dispatched|queued)$/.test(key));
 context.summary=sanitizeScheduledRunSummary({outcome:failed?'partial-failure':dispatched?'dispatched':'success',counts});
};
export const observeScheduledPeerEvent = (value:any) => {
 const context=scheduledRunExecution.getStore();if(context?.correlation.path!=='/api/v1/peers/sync')return;
 if(value?.type==='peer.warning')context.summary={outcome:'partial-failure',counts:{...context.summary?.counts,warnings:(context.summary?.counts.warnings??0)+1}};
 if(value?.type==='complete'){
  const counts={...context.summary?.counts};for(const key of ['discovered','probed'])if(Number.isSafeInteger(value[key])&&value[key]>=0)counts[key]=value[key];
  context.summary={outcome:counts.warnings?'partial-failure':'success',counts};
 }
};
