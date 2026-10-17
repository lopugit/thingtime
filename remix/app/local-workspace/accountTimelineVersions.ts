import { parseVersionRequest, type VersionRequest } from '../timeline/publishedVersion';
import { readRecordedComponents } from '../timeline/recordedComponentReader';
import { versionContent, versionContentEquals } from '../timeline/versions';
import { thingContentSnapshot } from '../timeline/thingContent';
import { TIMELINE_EVENT_MAX_BYTES } from '../timeline/contract';
import type { TimelineLocalStore, LocalTimelineRow } from '../timeline/localStore';
import { LocalTimelineVersions, type LocalVersionAuthority } from './timelineVersions';
import { AccountTimeline, accountTimelineScope, readAccountTimelineRow } from './accountTimeline';
import { WorkspaceError, workspaceScopeKey, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';
import type { LocalThings, LocalThing } from './things';

type AccountScope = Extract<WorkspaceScope, {kind:'account'}>;
const fail=(message:string):never=>{throw new WorkspaceError('ACCOUNT_HISTORY_VERSION',message,409);};

/** The established planner and atomic writer run against the account partition.
 * Restores are device-authored edits; no account receipt is manufactured. */
export class AccountTimelineVersions {
 private history: AccountTimeline;
 private authority: LocalVersionAuthority<LocalTimelineRow>;
 constructor(private db:WorkspaceDatabase,private scope:AccountScope,private lease:WorkspaceLease,private things:LocalThings,private store:TimelineLocalStore){
  const timeline=accountTimelineScope(scope);
  if(workspaceScopeKey(things.scope)!==workspaceScopeKey(scope))fail('The History writer belongs to another workspace.');
  if(store.scope.ownerId!==timeline.ownerId||store.scope.dataPlane!==timeline.dataPlane||store.scope.apiOrigin!==timeline.apiOrigin)fail('History belongs to another workspace.');
  this.history=new AccountTimeline(db,scope,lease);
  const entry=(tx:WorkspaceTransaction,id:string)=>readAccountTimelineRow(tx,timeline,id);
  const thing=async(tx:WorkspaceTransaction,id:string)=>{
   const doc=await tx.get<LocalThing>('things',id),state=await tx.get<{audience:{acl:string[]};deleted?:unknown}>('thing-sync',id);
   if(!doc||!state||state.deleted)return undefined;
   return {...doc,acl:state.audience.acl};
  };
  this.authority={scope,ownerId:scope.ownerId,deviceDrafts:true,entry,thing,
   head:async(tx,id)=>{
    const head=await tx.get<string>('timeline-meta',`head:${id}`);
    if(head){const row=await entry(tx,head);if(!row||row.event.thingId!==id)fail('The device History head is unavailable.');return row;}
    const doc=await thing(tx,id);
    const current=doc?versionContent(thingContentSnapshot(doc)!):null;
    let match:LocalTimelineRow|null=null;
    for(const item of await tx.list<{thingId:string}>('timeline-index')){
     if(item.value.thingId!==id)continue;
     const row=await entry(tx,item.id);
     if(row?.receipt&&row.event.mode==='revision'&&(current?row.event.after?.adapter==='thing-content'&&versionContentEquals(versionContent(row.event.after),current):true)&&(!match||row.receipt.position>match.receipt!.position))match=row;
    }
    return match;
   },
   recorded:(tx,wanted)=>readRecordedComponents({ownerId:scope.ownerId,wanted,
    readSizes:async ids=>{const sizes=[];for(const id of ids){const row=await entry(tx,id);if(row)sizes.push({timelineEntryBytes:row.bytes});}return sizes;},
    readEntries:async ids=>{const rows=[];for(const id of ids){const row=await entry(tx,id);if(row)rows.push(row);}return rows;},
    error:(status,message)=>new WorkspaceError('ACCOUNT_HISTORY_VERSION',message,status)
   })
  };
 }
 async request(input:VersionRequest,signal?:AbortSignal){
  const check=()=>{this.lease.assertCurrent();signal?.throwIfAborted();};check();
  const request=parseVersionRequest(input);
  const run=async()=>{
   const result=await new LocalTimelineVersions(this.db,this.lease,this.things,this.authority).request(request,signal);check();
   return 'entry' in result ? {...result,entry:{event:result.entry.event,receipt:result.entry.receipt},savedLocally:true as const} : {...result,savedLocally:false as const};
  };
  // A committed retry does not depend on today's content or a surviving cache.
  if(request.command==='apply-version'&&(await this.history.entries([`version-${request.operationId}`])).length)return run();
  // Cache eviction cannot remove the basis between comparison and commit.
  // Only existing canonical receipts can enter the durable account partition.
  const source=(await this.store.entries([request.eventId]))[0];check();
  if(!source)fail('This version is not retained on this device. Load it in History while connected.');
  const rows=await this.store.forThing(source.event.thingId);check();
  const basis=await this.db.transaction(this.scope,'readonly',this.lease,async tx=>{
   const id=await tx.get<string>('timeline-meta',`head:${source.event.thingId}`);
   const doc=await this.authority.thing(tx,source.event.thingId);
   if(!doc&&!request.recover)fail('This Thing was deleted. Choose recovery in History to restore it.');
   return {id,content:doc?versionContent(thingContentSnapshot(doc)!):null};
  });check();
  const head=basis.id ? rows.find(row=>row.event.id===basis.id) : rows.filter(row=>row.receipt&&row.event.mode==='revision'&&(basis.content?row.event.after?.adapter==='thing-content'&&versionContentEquals(versionContent(row.event.after),basis.content):true)).sort((a,b)=>b.receipt!.position-a.receipt!.position)[0];
  const found=new Map<string,LocalTimelineRow>(), expanded=new Set<string>();
  let pending=[{id:source.event.id,ancestry:request.mode==='merge'},...(head?[{id:head.event.id,ancestry:request.mode==='merge'}]:[])];
  while(pending.length){
   const queue=pending;pending=[];
   for(const {id,ancestry} of queue){
    if(expanded.has(id))continue;
    const row=found.get(id)??(id===source.event.id?source:id===head?.event.id?head:(await this.store.entries([id]))[0]);check();
    if(!row)fail('Earlier versions or recorded components are not retained on this device.');
    found.set(id,row);expanded.add(id);
    const event=row.event,compact=event.after&&['folder-placement','webpage-draft','definition-source'].includes(event.after.adapter);
    const undoPage=id===source.event.id&&request.mode==='undo'&&event.dependencies.length>0;
    if(ancestry||compact||undoPage)pending.push(...event.parentIds.map(id=>({id,ancestry})));
    pending.push(...event.dependencies.map(link=>({id:link.eventId,ancestry:false})));
    if(found.size>2048)fail('This History comparison exceeds the retained version budget.');
   }
  }
  const entries=[...found.values()];
  if(entries.reduce((total,row)=>total+row.bytes,0)>4*TIMELINE_EVENT_MAX_BYTES)fail('This History comparison exceeds the retained byte budget.');
  await this.history.retain(entries.filter(row=>row.receipt!==null).map(row=>({event:row.event,receipt:row.receipt!})));check();
  return run();
 }
}
