import { parseTimelineEntry, parseTimelineEvent, timelineEventText, timelineScopeKey, type TimelineEntry, type TimelineEvent, type TimelineScope } from '../timeline/contract';
import { splitTimelineEvent, joinTimelineEvent, parseTimelineEventRecord, timelineLinkId, type TimelineEventRecord, type TimelineLink } from '../timeline/records';
import { TimelineLocalStore, timelineLocalRow, timelineLocalIndex, validateTimelineIndex, validateTimelineRow, orderPendingTimelineRows,
 type LocalTimelineRow, type TimelineLocalBackend, type TimelineLocalIndex, type TimelineLocalSelection } from '../timeline/localStore';
import { recordLocalThingChanges } from './timeline';
import { captureThingChanges } from './thingChanges';
import type { LocalThing } from './things';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';

type AccountScope = Extract<WorkspaceScope, {kind:'account'}>;
const EVENTS='timeline-events', LINKS='timeline-links', INDEX='timeline-index', META='timeline-meta';
type Stored = Omit<LocalTimelineRow,'event'> & {event:TimelineEventRecord; reserve:string};
type Header = TimelineLocalIndex & {reserve:string};
export const accountTimelineScope=(scope:AccountScope):TimelineScope=>({apiOrigin:scope.origin,ownerId:scope.ownerId,dataPlane:scope.dataPlane});
const failure=(message:string):never=>{throw new WorkspaceError('ACCOUNT_HISTORY',message,409);};
/** Receipt/control space is admitted with the edit, so acknowledgements do not
 * require new quota after the device fills. Snapshot and link bytes are exact. */
function reserved<T extends {receipt:unknown;status:unknown;bytes:number;accessedAt:number}>(row:T):T & {reserve:string} {
 const {receipt,status,bytes,accessedAt}=row;
 return {...row,reserve:' '.repeat(Math.max(0,2048-new TextEncoder().encode(JSON.stringify({receipt,status,bytes,accessedAt})).length))};
}
async function readRow(tx:WorkspaceTransaction,scope:TimelineScope,id:string):Promise<LocalTimelineRow|null>{
 const stored=await tx.get<Stored>(EVENTS,id);if(!stored)return null;
 const event=parseTimelineEventRecord(stored.event),key=timelineScopeKey(scope);
 const ids=[timelineLinkId(id,'thing',0),timelineLinkId(id,'branch',0),timelineLinkId(id,'operation',0),
  ...Array.from({length:event.parentCount},(_,n)=>timelineLinkId(id,'parent',n)),...Array.from({length:event.dependencyCount},(_,n)=>timelineLinkId(id,'dependency',n))];
 const links:TimelineLink[]=[];for(const id of ids){const link=await tx.get<TimelineLink>(LINKS,id);if(!link)failure('Account History relationships are incomplete.');links.push(link!);}
 const {reserve:_reserve,...value}=stored;
 const row=validateTimelineRow({...value,event:joinTimelineEvent(event,links)},key);
 if(row.event.id!==id||row.event.ownerId!==scope.ownerId)failure('Account History identity changed.');
 const header=await tx.get<Header>(INDEX,id);if(!header)failure('Account History index is missing.');
 const {reserve:_headerReserve,...index}=header!;validateTimelineIndex(index,key);
 if(JSON.stringify(index)!==JSON.stringify(timelineLocalIndex(row)))failure('Account History index does not match its event.');
 return row;
}
async function putRow(tx:WorkspaceTransaction,row:LocalTimelineRow){
 const split=splitTimelineEvent(row.event);
 await tx.put(EVENTS,row.event.id,reserved({...row,event:split.event}));
 for(const link of split.links)await tx.put(LINKS,link.id,link);
 await tx.put(INDEX,row.event.id,reserved(timelineLocalIndex(row)));
}
async function append(tx:WorkspaceTransaction,scope:TimelineScope,input:TimelineEvent){
 const event=parseTimelineEvent(input);
 if(event.ownerId!==scope.ownerId||event.actorId!==scope.ownerId||event.source!=='client'||event.mode!=='draft'||!event.clientId)
  failure('Device History cannot claim server mutation authority.');
 const previous=await readRow(tx,scope,event.id);
 if(previous){if(timelineEventText(previous.event)!==timelineEventText(event))failure('History event identity was reused.');return;}
 for(const [id,thingId] of [...event.parentIds.map(id=>[id,event.thingId]),...event.dependencies.map(ref=>[ref.eventId,ref.thingId])]){
  const ancestor=await readRow(tx,scope,id);if(!ancestor||ancestor.event.thingId!==thingId)failure('Account History dependencies are missing.');
 }
 await putRow(tx,timelineLocalRow(timelineScopeKey(scope),event,null,Date.parse(event.occurredAt)));
}

/** Content, canonical event/link records and the local head commit together.
 * These are authored private drafts until the normal server supplies receipts;
 * they never fabricate server revisions, ownership or acceptance ordering. */
export async function captureAccountThingChanges<T>(tx:WorkspaceTransaction,scope:AccountScope,run:(tx:WorkspaceTransaction)=>Promise<T>,now:()=>string,uuid:()=>string):Promise<T>{
 return captureThingChanges(tx,run,async(tx,changes)=>{
  if(!changes.size)return;
  let clientId=await tx.get<string>(META,'client');
  if(!clientId){clientId=`workspace-${uuid()}`;await tx.put(META,'client',clientId);}
  const timeline=accountTimelineScope(scope);
  await recordLocalThingChanges(tx,changes,now,uuid,undefined,{ownerId:scope.ownerId,clientId,branchId:`device-${clientId}`,mode:'draft',
   read:id=>readRow(tx,timeline,id),append:event=>append(tx,timeline,event)});
 },async(tx,id)=>{
  const row=await tx.get<LocalThing>('things',id);if(!row)return null;
  const state=await tx.get<{audience:{acl:string[]}}>('thing-sync',id);
  return {...row,acl:state?.audience.acl || (row as any).acl || ['tt:user']};
 });
}

/** Authoritative device versions live in the existing scoped workspace, using
 * the identical normalized Timeline records. Cache pruning never deletes them. */
export class AccountTimeline {
 readonly timelineScope:TimelineScope;
 constructor(private db:WorkspaceDatabase,readonly scope:AccountScope,private lease:WorkspaceLease){
  if(scope.kind!=='account')failure('Anonymous History cannot enter account synchronization.');
  this.timelineScope=accountTimelineScope(scope);timelineScopeKey(this.timelineScope);
 }
 private tx<T>(mode:IDBTransactionMode,run:(tx:WorkspaceTransaction)=>Promise<T>){return this.db.transaction(this.scope,mode,this.lease,run);}
 async rows(selection?:TimelineLocalSelection):Promise<LocalTimelineRow[]>{
  return this.tx('readonly',async tx=>{
   const result:LocalTimelineRow[]=[];
   for(const {id,value} of await tx.list<Header>(INDEX)){
    validateTimelineIndex(value,timelineScopeKey(this.timelineScope));
    if((selection?.thingId&&value.thingId!==selection.thingId)||(selection?.thingIds&&!selection.thingIds.includes(value.thingId))||(selection?.status&&value.status!==selection.status))continue;
    const row=await readRow(tx,this.timelineScope,id);if(!row)failure('Account History payload is missing.');result.push(row!);
   }
   return result;
  });
 }
 async entries(ids:string[]):Promise<LocalTimelineRow[]>{
  if(ids.length>128||new Set(ids).size!==ids.length)failure('Invalid History dependency batch.');
  return this.tx('readonly',async tx=>{const rows:LocalTimelineRow[]=[];for(const id of ids){const row=await readRow(tx,this.timelineScope,id);if(row)rows.push(row);}return rows;});
 }
 async accept(inputs:TimelineEntry[]):Promise<void>{
  const entries=inputs.map(parseTimelineEntry);
  if(entries.some(({event})=>event.ownerId!==this.scope.ownerId))failure('History receipt belongs to another account.');
  await this.tx('readwrite',async tx=>{
   for(const {event,receipt} of entries){
    const local=await readRow(tx,this.timelineScope,event.id);if(!local)continue;
    if(timelineEventText(local.event)!==timelineEventText(event))failure('Account acknowledged different History content.');
    if(local.receipt&&JSON.stringify(local.receipt)!==JSON.stringify(receipt))failure('History receipt identity changed.');
    if(!local.receipt)await putRow(tx,timelineLocalRow(timelineScopeKey(this.timelineScope),event,receipt,local.accessedAt));
   }
  });
 }
}

function mergeRows(cached:LocalTimelineRow[],authored:LocalTimelineRow[]):LocalTimelineRow[]{
 const result=new Map(cached.map(row=>[row.event.id,row]));
 for(const row of authored){
  const prior=result.get(row.event.id);
  if(prior&&(timelineEventText(prior.event)!==timelineEventText(row.event)||(prior.receipt&&row.receipt&&JSON.stringify(prior.receipt)!==JSON.stringify(row.receipt))))failure('Cached History differs from its device version.');
  result.set(row.event.id,row.receipt||!prior?.receipt?row:prior);
 }
 return [...result.values()].sort((a,b)=>(b.receipt?.position??Number.MAX_SAFE_INTEGER)-(a.receipt?.position??Number.MAX_SAFE_INTEGER)||b.event.occurredAt.localeCompare(a.event.occurredAt));
}
/** Reuse the existing Timeline sync queue and UI. Its cache/draft store remains
 * intact, while atomically authored workspace versions are another source of
 * the SAME rows. Receipt updates reach durable device history before the cache. */
export class AccountTimelineStore extends TimelineLocalStore {
 constructor(scope:TimelineScope,backend:TimelineLocalBackend,private authored:AccountTimeline){
  super(scope,backend);
  if(timelineScopeKey(scope)!==timelineScopeKey(authored.timelineScope))failure('Account History scope changed.');
 }
 override async pendingWrites(){return orderPendingTimelineRows(mergeRows(await super.pendingWrites(),await this.authored.rows({status:'pending'})).filter(row=>row.status==='pending'));}
 override async forThing(id:string|null){return mergeRows(await super.forThing(id),await this.authored.rows(id===null?undefined:{thingId:id}));}
 override async forThings(ids:string[]){return mergeRows(await super.forThings(ids),await this.authored.rows({thingIds:ids}));}
 override async entries(ids:string[]){return mergeRows(await super.entries(ids),await this.authored.entries(ids));}
 override async accept(entries:TimelineEntry[]){await this.authored.accept(entries);await super.accept(entries);}
}
