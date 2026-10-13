import { getHomeThingsCollection } from '../mongodb/collections';
import { AI_TASK_KIND } from './backgroundTaskCore';

type FinalStatus = 'completed' | 'needs-attention' | 'stopped';

/** A lease expiry is not proof of worker death. Cancel admission first and keep
 * the conversation claim until every reserved executor acknowledges its final
 * saved output. An uncertain worker requires review, never automatic replay. */
export const finalizeLopuWorkflow = async (rootId: string, status: FinalStatus) => {
 const things = await getHomeThingsCollection();
 const filter = {shareId:rootId,thingtime:AI_TASK_KIND};
 const row = await things.findOne(filter);
 if (!row || row.workflowFinalizedAt) return true;
 // The first finalizer establishes the outcome; duplicate steps cannot replace
 // it or regress a completed acknowledgment to a pending state.
 await things.updateOne({...filter,workflowFinalStatus:{$exists:false}}, {$set:{cancelRequested:true,workflowFinalStatus:row.cancelRequested?'stopped':status,updatedAt:new Date()},$unset:{workflowInput:''}});
 const established = await things.findOne(filter);
 if (!established || established.workflowFinalizedAt) return true;
 const finalStatus: FinalStatus = established.workflowFinalStatus;
 // A cancelled, never-claimed first part cannot begin after this root fence.
 await things.updateOne({...filter,cancelRequested:true,workerStarted:{$ne:true},activeWorkerRequestId:row.crystal.requestId},{$unset:{activeWorkerRequestId:''}});
 // Unclaimed children can be retired atomically: cancellation wins any later
 // claim. Claimed rows remain writable until their executor flushes receipts.
 await things.updateMany({ownerId:row.ownerId,taskScope:row.taskScope,thingtime:AI_TASK_KIND,rootTaskId:rootId,'crystal.status':'running',workerStarted:{$ne:true}}, {
  $set:{cancelRequested:true,'crystal.status':finalStatus==='stopped'?'stopped':'needs-attention','crystal.stage':'Stopped before starting',updatedAt:new Date()},
  $unset:{uniqueKeys:''}
 });
 // After cancellation, a missing task cannot cross the executor's immediate
 // cancellation preflight. An inserted/claimed task is observable here before
 // it can invoke a handler; keep its reservation unless completion is known.
 const reservedRoot = await things.findOne(filter);
 if (reservedRoot?.activeWorkerRequestId) {
  const reserved = await things.findOne({ownerId:row.ownerId,taskScope:row.taskScope,thingtime:AI_TASK_KIND,'crystal.requestId':reservedRoot.activeWorkerRequestId});
  if (!reserved || reserved.workerFinishedAt || (reserved.cancelRequested && !reserved.workerStarted)) {
   await things.updateOne({...filter,activeWorkerRequestId:reservedRoot.activeWorkerRequestId},{$unset:{activeWorkerRequestId:''}});
  }
 }
 const unfinished = await things.findOne({ownerId:row.ownerId,taskScope:row.taskScope,thingtime:AI_TASK_KIND,
  $or:[{shareId:rootId},{rootTaskId:rootId}],workerStarted:true,workerFinishedAt:{$exists:false}});
 const latest = await things.findOne(filter);
 if (unfinished || latest?.activeWorkerRequestId) {
  await things.updateOne({...filter,workflowFinalizedAt:{$exists:false}}, {$set:{'crystal.workflowStatus':'needs-attention','crystal.stage':'Waiting for worker to stop',
   'crystal.error':'Stop requested. The conversation remains locked until the worker saves its final output and acknowledges completion.',updatedAt:new Date()}});
  await import('./liveActivity').then(m=>m.refreshLopuLiveActivitiesForOwner(row.ownerId,row.taskScope)).catch(()=>{});
  return false;
 }
 const finished = await things.updateOne({...filter,activeWorkerRequestId:{$exists:false},workflowFinalizedAt:{$exists:false}}, {
  $set:{'crystal.workflowStatus':finalStatus,workflowFinalizedAt:new Date(),updatedAt:new Date(),
   ...(latest?.crystal.status==='running'?{'crystal.status':finalStatus}:{}),
   'crystal.stage':finalStatus==='stopped'?'Stopped':finalStatus==='completed'?'Completed':'Needs attention',
   ...(finalStatus==='stopped'?{'crystal.error':null}:{})},
  $unset:{uniqueKeys:'',workflowInput:''}
 });
 await import('./liveActivity').then(m=>m.refreshLopuLiveActivitiesForOwner(row.ownerId,row.taskScope)).catch(()=>{});
 return !!finished.matchedCount;
};
