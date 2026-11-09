import { start } from 'workflow/api';
import { THINGS_KIND_CREATED_INDEX } from '../mongodb/thingIndexContracts';
import { getHomeThingsCollection } from '../mongodb/collections';
import { runWithHomeMongoEndpoint } from '../mongodb/endpoint';
import { requireGatewayDatabaseAccess, runAdmittedGatewayWork, withGatewayWork } from '../deployment/environmentGateway';
import { backupJobs } from './backupJobs';
import { BACKUP_JOB_KIND } from './backupJobCore';
import { runBackupWorkflow } from './backupWorkflow.server';
import { awaitBackupAbort } from './backupTransport.server';

type DispatchResult = 'attached' | 'not-started' | 'unconfirmed' | 'superseded';
type Dependencies = {
 jobs: Pick<typeof backupJobs,'reserveDispatch'|'attachWorkflow'|'markDispatchUnconfirmed'|'retireInvalidAuthorization'|'deferDispatch'>;
 start(jobId:string,dispatchId:string):Promise<{runId:string}>;
 due(origin:string,before:number,after?:{at:number;id:string}):Promise<{items:string[];next:{at:number;id:string}|null}>;
 now():number;
};
const defaults:Dependencies={jobs:backupJobs,start:(jobId,dispatchId)=>start(runBackupWorkflow,[jobId,dispatchId]),now:Date.now,
 due:async(origin,before,after)=>{
  const things=await getHomeThingsCollection(),stamp=new Date(before);
  const rows=await things.find({thingtime:BACKUP_JOB_KIND,backupVersion:1,backupPlane:'home',backupOrigin:origin,
   backupStatus:'queued',backupCancelRequested:{$ne:true},backupWorkflowRunId:null,createdAt:{$type:'date',$lte:stamp},
   backupDispatchAttempts:{$not:{$gte:5}},$and:[{$or:[{backupDispatchNextAt:null},{backupDispatchNextAt:{$lte:stamp}}]},
    ...(after?[{$or:[{createdAt:{$gt:new Date(after.at)}},{createdAt:new Date(after.at),shareId:{$lt:after.id}}]}]:[])]},
   {projection:{_id:0,shareId:1,createdAt:1},maxTimeMS:5000,hint:THINGS_KIND_CREATED_INDEX}).sort({createdAt:1,shareId:-1}).limit(25).toArray();
  const last=rows.at(-1);return {items:rows.map(row=>row.shareId),next:rows.length===25&&last?{at:new Date(last.createdAt).getTime(),id:last.shareId}:null};
 }
 };
/** Durable job roots form the dispatch outbox. Detached request work only
 * reduces latency; the supported scheduler recovers a request/process crash.
 * SDK starts are not retried blindly. A superseded attempt cannot initialize
 * or claim an old lease even if its original scheduling reply arrives late. */
export function createBackupDispatcher(overrides:Partial<Dependencies>={}){
 const deps={...defaults,...overrides};
 const dispatch=async(jobId:string,origin:string,recoverExpired=false,deadlineMs=30_000):Promise<DispatchResult>=>{
  if(new URL(origin).origin!==origin || deadlineMs<1 || deadlineMs>30_000)throw Error('Invalid backup dispatch boundary');
  const signal=AbortSignal.timeout(deadlineMs);
  const reservation=await awaitBackupAbort(deps.jobs.reserveDispatch(jobId,origin,recoverExpired),signal);
  if(!reservation.start || !reservation.dispatchId)return 'not-started';
  const dispatchId=reservation.dispatchId;
  try{
   const run=await awaitBackupAbort(deps.start(jobId,dispatchId),signal,late=>{
    // Late accepted receipt is useful, but never restarts or overrides a newer
    // attempt. The coordinator still checks the exact current session+attempt.
    void deps.jobs.attachWorkflow(jobId,dispatchId,late.runId).catch(()=>{});
   });
   return await awaitBackupAbort(deps.jobs.attachWorkflow(jobId,dispatchId,run.runId),signal)?'attached':'superseded';
  }catch{
   await awaitBackupAbort(deps.jobs.markDispatchUnconfirmed(jobId,dispatchId),AbortSignal.timeout(5000)).catch(()=>{});
   return 'unconfirmed';
  }
 };
 const drain=async(origin:string)=>{
  const started=deps.now(),result={examined:0,attached:0,unconfirmed:0,skipped:0,retired:0,unavailable:0};
  let cursor:{at:number;id:string}|undefined;
  for(;;){
   if(45_000-(deps.now()-started)<=6000)break;
   const page=await awaitBackupAbort(deps.due(origin,started,cursor),AbortSignal.timeout(5000));
   for(const id of page.items){
    const remaining=45_000-(deps.now()-started);if(remaining<=6000)return result;
    result.examined++;
    try{const state=await dispatch(id,origin,true,Math.min(30_000,remaining-5000));if(state==='attached')result.attached++;else if(state==='unconfirmed')result.unconfirmed++;else result.skipped++;}
    catch{
     // Only positive invalidity can retire; transient auth/database failures
     // remain queued and the stable keyset continues to later healthy jobs.
     const retired=await awaitBackupAbort(deps.jobs.retireInvalidAuthorization(id,origin),AbortSignal.timeout(5000)).catch(()=>false);
     if(retired)result.retired++;else{result.unavailable++;await awaitBackupAbort(deps.jobs.deferDispatch(id,origin),AbortSignal.timeout(5000)).catch(()=>{});}
    }
   }
   if(!page.next)break;
   if(cursor && page.next.at===cursor.at && page.next.id===cursor.id)throw Error('Backup dispatch scan did not advance');
   cursor=page.next;
  }
  return result;
 };
 return {dispatch,drain};
}
export const backupDispatcher=createBackupDispatcher();
export const runBackupDispatchOutbox=(origin:string)=>withGatewayWork(async()=>{
 await requireGatewayDatabaseAccess();
 return runAdmittedGatewayWork(()=>runWithHomeMongoEndpoint(()=>backupDispatcher.drain(origin)));
});
