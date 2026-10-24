import type { TimelineNameQueue } from '../timeline/nameQueue';
import { timelineScopeKey } from '../timeline/contract';
import { createVersionExportReader, parseTimelineVersionExport } from '../timeline/exportVersion';
import { TIMELINE_SNAPSHOT_PARTS_ADAPTER } from '../timeline/snapshotParts';
import { TimelineNameStore } from '../timeline/nameStore';
import type { TimelineLocalStore } from '../timeline/localStore';
import type { TimelineNoteStore } from '../timeline/noteStore';
import { WorkspaceError, type WorkspaceLease } from './storage';

/** Export retained immutable History only. The account's live Things, private
 * network credentials, queues and authoritative receipts are never changed. */
export async function exportAccountTimelineVersion(eventId:string,{store,notes,names:retainedNames,lease,now=()=>new Date()}:{store:TimelineLocalStore;notes:TimelineNoteStore;names?:TimelineNameQueue;lease:WorkspaceLease;now?:()=>Date},signal?:AbortSignal){
 if(retainedNames&&retainedNames.key!==timelineScopeKey(store.scope))throw new WorkspaceError('HISTORY_EXPORT','Version names belong to another workspace.',409);
 const assertAvailable=()=>{lease.assertCurrent();signal?.throwIfAborted();};
 const checked=async<T>(run:()=>Promise<T>)=>{assertAvailable();const result=await run();assertAvailable();return result;};
 const entries=(ids:string[])=>checked(()=>store.entries(ids));
 const refuse=(status:number,message:string):never=>{throw new WorkspaceError(status===409?'HISTORY_NOT_RETAINED':'HISTORY_EXPORT',message,status);};
 const result=await createVersionExportReader({
  entries,
  nodes:async ids=>(await entries(ids)).map(({event})=>({id:event.id,thingId:event.thingId,parentIds:event.parentIds,afterAdapter:event.after?.adapter??null})),
  snapshot:async(entry,side)=>{
   if(entry.event[side]?.adapter===TIMELINE_SNAPSHOT_PARTS_ADAPTER)refuse(409,'This version needs snapshot parts that are not retained on this device. Export it while connected.');
   return entry.event[side];
  },
  notes:async entry=>(await checked(()=>notes.forEvents([entry.event.id]))).get(entry.event.id)??[],
  names:async entry=>{
   if(retainedNames){const cached=await checked(()=>retainedNames.accepted([entry.event.id]));if(cached.has(entry.event.id)){const name=cached.get(entry.event.id);return name?[name]:[];}}
   // Accepted naming effects are canonical immutable records. A name supplied
   // only by an older client's remote page may be absent; context says so.
   const names=new TimelineNameStore(store.scope),rows=await checked(()=>store.forThing(entry.event.thingId));
   for(const row of rows.filter(row=>row.receipt).sort((a,b)=>a.receipt!.position-b.receipt!.position))names.applyEffect(row.event);
   return [...names.forEvents([entry.event.id]).values()];
  },
  now,refuse,retainedLocation:'this device',allowClientDrafts:true,context:{source:'device',complete:false}
 })(store.scope.ownerId,eventId);
 if(!result)throw new WorkspaceError('HISTORY_NOT_RETAINED','This version is not retained on this device. Load it in History while connected, then retry.',409);
 const archive=parseTimelineVersionExport(result,{ownerId:store.scope.ownerId,id:eventId});
 assertAvailable();return {ok:true as const,export:archive,assertAvailable};
}
