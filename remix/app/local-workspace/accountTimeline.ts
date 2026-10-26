import { parseTimelineEntry, parseTimelineEvent, timelineEventText, timelineScopeKey, type TimelineEntry, type TimelineEvent, type TimelineScope } from '../timeline/contract';
import { splitTimelineEvent, joinTimelineEvent, parseTimelineEventRecord, timelineLinkId, type TimelineEventRecord, type TimelineLink } from '../timeline/records';
import { TimelineLocalStore, timelineLocalRow, timelineLocalIndex, validateTimelineIndex, validateTimelineRow, orderPendingTimelineRows,
 type LocalTimelineRow, type TimelineLocalBackend, type TimelineLocalIndex, type TimelineLocalSelection } from '../timeline/localStore';
import { recordLocalThingChanges, type LocalMutationCapture, type ThingHistoryWriter } from './timeline';
import { captureThingChanges, type ThingChanges } from './thingChanges';
import { themeContentSnapshot } from '../timeline/themeContent';
import { isTransferTheme } from '../utils/thingTransfer/theme';
import { algorithmContentSnapshot } from '../timeline/algorithmContent';
import { isTransferAlgorithm } from '../utils/thingTransfer/algorithm';
import type { LocalThing } from './things';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';
import { accountSuiteAliases } from './accountSuiteIdentity';

type AccountScope = Extract<WorkspaceScope, {kind:'account'}>;
const EVENTS='timeline-events', LINKS='timeline-links', INDEX='timeline-index', META='timeline-meta';
type Stored = Omit<LocalTimelineRow,'event'> & {event:TimelineEventRecord; reserve:string};
type Header = TimelineLocalIndex & {reserve:string};
export const accountTimelineScope=(scope:AccountScope):TimelineScope=>({apiOrigin:scope.origin,ownerId:scope.ownerId,dataPlane:scope.dataPlane,...(scope.delegatedBy === undefined ? {} : {delegatedBy:scope.delegatedBy})});
const failure=(message:string):never=>{throw new WorkspaceError('ACCOUNT_HISTORY',message,409);};
/** Receipt/control space is admitted with the edit, so acknowledgements do not
 * require new quota after the device fills. Snapshot and link bytes are exact. */
function reserved<T extends {receipt:unknown;status:unknown;bytes:number;accessedAt:number}>(row:T):T & {reserve:string} {
 const {receipt,status,bytes,accessedAt}=row;
 return {...row,reserve:' '.repeat(Math.max(0,2048-new TextEncoder().encode(JSON.stringify({receipt,status,bytes,accessedAt})).length))};
}
export async function readAccountTimelineRow(tx:WorkspaceTransaction,scope:TimelineScope,id:string):Promise<LocalTimelineRow|null>{
 const stored=await tx.get<Stored>(EVENTS,id);if(!stored)return null;
 const event=parseTimelineEventRecord(stored.event),key=timelineScopeKey(scope);
 const ids=[timelineLinkId(id,'thing',0),timelineLinkId(id,'branch',0),timelineLinkId(id,'operation',0),
  ...Array.from({length:event.parentCount},(_,n)=>timelineLinkId(id,'parent',n)),...Array.from({length:event.dependencyCount},(_,n)=>timelineLinkId(id,'dependency',n))];
 const links:TimelineLink[]=[];for(const id of ids){const link=await tx.get<TimelineLink>(LINKS,id);if(!link)failure('Account History relationships are incomplete.');links.push(link!);}
 const {reserve:_reserve,...value}=stored;
 // Older authored rows already live inside the principal/actor workspace.
 // Re-key only that trusted partition's metadata; never adopt the unscoped
 // shared cache, whose originating principal cannot be proven.
 const legacyKey=scope.delegatedBy === undefined ? key : timelineScopeKey({...scope,delegatedBy:undefined});
 const row=validateTimelineRow({...value,scope:value.scope===legacyKey?key:value.scope,event:joinTimelineEvent(event,links)},key);
 if(row.event.id!==id||row.event.ownerId!==scope.ownerId)failure('Account History identity changed.');
 const header=await tx.get<Header>(INDEX,id);if(!header)failure('Account History index is missing.');
 const {reserve:_headerReserve,...storedIndex}=header!;
 const index={...storedIndex,scope:storedIndex.scope===legacyKey?key:storedIndex.scope};validateTimelineIndex(index,key);
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
 const previous=await readAccountTimelineRow(tx,scope,event.id);
 if(previous){if(timelineEventText(previous.event)!==timelineEventText(event))failure('History event identity was reused.');return;}
 for(const [id,thingId] of [...event.parentIds.map(id=>[id,event.thingId]),...event.dependencies.map(ref=>[ref.eventId,ref.thingId])]){
  const ancestor=await readAccountTimelineRow(tx,scope,id);if(!ancestor||ancestor.event.thingId!==thingId)failure('Account History dependencies are missing.');
 }
 await putRow(tx,timelineLocalRow(timelineScopeKey(scope),event,null,Date.parse(event.occurredAt)));
}

/** Content, canonical event/link records and the local head commit together.
 * These are authored private drafts until the normal server supplies receipts;
 * they never fabricate server revisions, ownership or acceptance ordering. */
export async function captureAccountThingChanges<T>(tx:WorkspaceTransaction,scope:AccountScope,run:(tx:WorkspaceTransaction)=>Promise<T>,now:()=>string,uuid:()=>string,captures?:Map<string, LocalMutationCapture>):Promise<T>{
 return captureThingChanges(tx,run,(tx,changes)=>recordAccountChanges(tx,scope,changes,now,uuid,captures),async(tx,id)=>{
  const row=await tx.get<LocalThing>('things',id);if(!row)return null;
  const state=await tx.get<{audience:{acl:string[]}}>('thing-sync',id);
  return {...row,acl:state?.audience.acl || (row as any).acl || ['tt:user']};
 });
}

async function recordAccountChanges(tx:WorkspaceTransaction,scope:AccountScope,changes:ThingChanges,now:()=>string,uuid:()=>string,captures?:Map<string,LocalMutationCapture>,themeSnapshots?:ThingHistoryWriter['themeSnapshots'],algorithmSnapshots?:ThingHistoryWriter['algorithmSnapshots']){
  if(!changes.size)return;
  let clientId=await tx.get<string>(META,'client');
  if(!clientId){clientId=`workspace-${uuid()}`;await tx.put(META,'client',clientId);}
  const timeline=accountTimelineScope(scope);
  await recordLocalThingChanges(tx,changes,now,uuid,captures,{ownerId:scope.ownerId,clientId,branchId:`device-${clientId}`,mode:'draft',themeSnapshots,algorithmSnapshots,
   read:id=>readAccountTimelineRow(tx,timeline,id),append:event=>append(tx,timeline,event)});
}

/** Identity adoption authors a device History head, never a server receipt.
 * Existing event payloads, component captures and hashes stay byte-for-byte. */
export async function recordAccountSuiteAdoptions(tx:WorkspaceTransaction,scope:AccountScope,changes:ThingChanges,now:()=>string,uuid:()=>string){
 const captures=new Map<string,LocalMutationCapture>();
 for(const [id,change] of changes){
  const head=await tx.get<string>(META,`head:${id}`);
  captures.set(id,{id:`device-event-${uuid()}`,operationId:uuid(),operation:change.after?'update':'delete',parentIds:head?[head]:[],label:'Adopted account suite identity'});
 }
 await recordAccountChanges(tx,scope,changes,now,uuid,captures);
}

/** Called only by the dedicated theme mutation, after its ownership/state
 * checks. Read hydration and remote acknowledgements never author a version.
 * Visibility comes from that writer's intent, not the generic Thing ACL. */
export async function recordAccountThemeChange(tx:WorkspaceTransaction,scope:AccountScope,before:LocalThing|null,after:LocalThing|null,visibility:{before:'private'|'public';after:'private'|'public'},now:()=>string,uuid:()=>string,capture?:LocalMutationCapture){
 const id=after?.id??before?.id;
 if(!id||[before,after].some(row=>row&&(!isTransferTheme(row)||row.id!==id)))failure('Invalid theme History mutation.');
 const snapshot=(row:LocalThing|null,visibility:'private'|'public')=>row?themeContentSnapshot({crystal:row.crystal,tags:row.tags??[],visibility,folderId:row.folderId??null}):null;
 await recordAccountChanges(tx,scope,new Map([[id!,{before,after}]]),now,uuid,capture?new Map([[id!,capture]]):undefined,new Map([[id!,{before:snapshot(before,visibility.before),after:snapshot(after,visibility.after)}]]));
}

/** Only the dedicated profile writer may capture protected algorithm content.
 * Remote catalogue refreshes and receipts do not author device versions. */
export async function recordAccountAlgorithmChange(tx:WorkspaceTransaction,scope:AccountScope,before:LocalThing|null,after:LocalThing|null,now:()=>string,uuid:()=>string,capture?:LocalMutationCapture){
 const id=after?.id??before?.id;
 if(!id||[before,after].some(row=>row&&(!isTransferAlgorithm(row)||row.id!==id)))failure('Invalid algorithm History mutation.');
 const snapshot=(row:LocalThing|null)=>row?algorithmContentSnapshot({crystal:row.crystal,folderId:row.folderId??null}):null;
 await recordAccountChanges(tx,scope,new Map([[id!,{before,after}]]),now,uuid,capture?new Map([[id!,capture]]):undefined,undefined,new Map([[id!,{before:snapshot(before),after:snapshot(after)}]]));
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
   const aliases=await accountSuiteAliases(tx),canonical=(id:string)=>aliases.get(id)||id;
   for(const {id,value} of await tx.list<Header>(INDEX)){
    const key=timelineScopeKey(this.timelineScope),legacyKey=timelineScopeKey({...this.timelineScope,delegatedBy:undefined});
    validateTimelineIndex({...value,scope:value.scope===legacyKey?key:value.scope},key);
    if((selection?.thingId&&canonical(value.thingId)!==canonical(selection.thingId))||(selection?.thingIds&&!selection.thingIds.some(id=>canonical(id)===canonical(value.thingId)))||(selection?.status&&value.status!==selection.status))continue;
    const row=await readAccountTimelineRow(tx,this.timelineScope,id);if(!row)failure('Account History payload is missing.');result.push(row!);
   }
   return result;
  });
 }
 async entries(ids:string[]):Promise<LocalTimelineRow[]>{
  if(ids.length>128||new Set(ids).size!==ids.length)failure('Invalid History dependency batch.');
  return this.tx('readonly',async tx=>{const rows:LocalTimelineRow[]=[];for(const id of ids){const row=await readAccountTimelineRow(tx,this.timelineScope,id);if(row)rows.push(row);}return rows;});
 }
 async retain(inputs: TimelineEntry[]): Promise<void> {
  const entries=inputs.map(parseTimelineEntry);
  if(entries.length>2048||entries.some(({event})=>event.ownerId!==this.scope.ownerId))failure('Invalid retained account History scope.');
  await this.tx('readwrite',async tx=>{
   for(const {event,receipt} of entries){
    const previous=await readAccountTimelineRow(tx,this.timelineScope,event.id);
    if(previous && (timelineEventText(previous.event)!==timelineEventText(event) || (previous.receipt && JSON.stringify(previous.receipt)!==JSON.stringify(receipt))))failure('Retained History identity changed.');
    if(!previous || !previous.receipt)await putRow(tx,timelineLocalRow(timelineScopeKey(this.timelineScope),event,receipt,previous?.accessedAt??Date.now()));
   }
  });
 }

 async accept(inputs:TimelineEntry[]):Promise<void>{
  const entries=inputs.map(parseTimelineEntry);
  if(entries.some(({event})=>event.ownerId!==this.scope.ownerId))failure('History receipt belongs to another account.');
  await this.tx('readwrite',async tx=>{
   for(const {event,receipt} of entries){
    const local=await readAccountTimelineRow(tx,this.timelineScope,event.id);if(!local)continue;
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
