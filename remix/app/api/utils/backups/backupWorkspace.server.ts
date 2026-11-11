import { waitUntil } from '@vercel/functions';
import { backupDigest, backupId, backupJson } from '../../../backups/manifest';
import type { BackupWorkspaceAvailability, BackupWorkspaceCatalog, BackupWorkspaceCommand, BackupWorkspaceEntry, BackupWorkspacePage, BackupWorkspaceReview } from '../../../backups/workspace';
import { getCurrentUser } from '../auth/getCurrentUser';
import { internalRequestActor } from '../auth/internalRequestActor';
import { EXPECTED_ACTOR_HEADER } from '../auth/expectedActor';
import { signContentProof, verifyContentProof } from '../auth/jwt';
import { mongoDataPlane } from '../mongodb/dataPlane';
import { getGatewaySettings, withGatewayWork } from '../deployment/environmentGateway';
import { findViewableThing } from '../things/things';
import { backupJobs, type CompletedBackupJob } from './backupJobs';
import { backupJobDigest } from './backupJobCore';
import { backupDestinationRegistry } from './backupDestinations';
import { backupDispatcher } from './backupDispatch.server';
import { openBackupWorkerView, type BackupAccess } from './portableBackup';
import { readAccountRestoreReview } from './accountRestoreSteps';
import { readSnapshotCatalogPage, readSnapshotCatalogState, snapshotCatalogEntry } from './backupCatalog';
export class BackupWorkspaceError extends Error {constructor(readonly status:number,message:string){super(message);}}
const fail=(status:number,message:string):never=>{throw new BackupWorkspaceError(status,message);};
const encode=(value:unknown)=>Buffer.from(backupJson(value)).toString('base64url');
const decode=(value:string)=>{try{if(value.length>8192)throw Error();const bytes=Buffer.from(value,'base64url');if(bytes.toString('base64url')!==value)throw Error();return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));}catch{return fail(400,'Invalid backup continuation');}};
const cursor=(value?:string)=>{if(!value)return undefined;const parsed=decode(value);if(!parsed||Object.keys(parsed).sort().join(',')!=='at,id'||!Number.isSafeInteger(parsed.at)||!backupId(parsed.id))return fail(400,'Invalid backup continuation');return parsed as {at:number;id:string};};
const uuid=(value:unknown)=>{if(typeof value!=='string'||!backupId(value))return fail(400,'Invalid backup operation identity');return value;};
const identity=(value:unknown)=>{if(typeof value!=='string'||! /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value))return fail(400,'Invalid saved item identity');return value;};
const exact=(value:any,fields:string)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===fields;
const stableId=(value:unknown)=>{const a=backupJobDigest(value).slice(0,32).split('');a[12]='4';a[16]='8';const s=a.join('');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;};
/** Only fixed scalar authority selectors cross HTTP. Labels/paths are re-read,
 * never filesystem/object-store selectors or executable archived commands. */
export function parseBackupWorkspaceCommand(input:any):BackupWorkspaceCommand{
 if(input?.action==='snapshot'&&exact(input,'action,destinationId,requestId')){uuid(input.requestId);if(typeof input.destinationId!=='string'||! /^[a-z0-9][a-z0-9-]{0,63}$/.test(input.destinationId))return fail(400,'Invalid registered destination');return input;}
 if(input?.action==='review'&&exact(input,'action,requestId,selection')&&exact(input.selection,'destination,snapshotId,sourceRootId')&&exact(input.selection.destination,'id,revision')){uuid(input.requestId);uuid(input.selection.snapshotId);identity(input.selection.sourceRootId);identity(input.selection.destination.id);identity(input.selection.destination.revision);return input;}
 if(input?.action==='restore'&&exact(input,'action,requestId,reviewHash,reviewId')){uuid(input.requestId);uuid(input.reviewId);if(!backupDigest(input.reviewHash))return fail(400,'Invalid reviewed certificate');return input;}
 if(['pause','resume','retry','cancel'].includes(input?.action)&&exact(input,'action,jobId')){uuid(input.jobId);return input;}
 return fail(400,'Invalid backup command');
}
type Open=typeof backupDestinationRegistry.open;
type Dependencies={jobs:typeof backupJobs;discover:typeof backupDestinationRegistry.discover;open:Open;kick(jobId:string,origin:string):void;worker(origin:string):Promise<BackupWorkspaceAvailability>};
const defaults:Dependencies={jobs:backupJobs,discover:backupDestinationRegistry.discover,open:backupDestinationRegistry.open,
 kick:(id,origin)=>{waitUntil(withGatewayWork(()=>backupDispatcher.dispatch(id,origin)).catch(()=>{}));},
 worker:async origin=>{const deployment=getGatewaySettings()?.deploymentId??process.env.VERCEL_DEPLOYMENT_ID;if(!deployment)return {available:false,reason:'worker-unavailable'};return await backupJobs.executionConfirmation(origin,deployment)?{available:true}:{available:false,reason:'worker-unverified'};}};
export function createBackupWorkspaceService(overrides:Partial<Dependencies>={}){
 const deps={...defaults,...overrides};
 const scope=async(request:Request)=>{
  const origin=new URL(request.url).origin,user=await getCurrentUser(request);
  if(internalRequestActor(request)||!user||user.temporary||user.isCharacter||user.accountKind!=='user')return fail(user?403:401,'Use your full Thingtime account session');
  const expected=request.headers.get(EXPECTED_ACTOR_HEADER);if(expected!==null&&expected!==user.id)return fail(409,'The active account changed');
  if(mongoDataPlane()!=='home')return fail(409,'Backups require home storage');
  const authorize=async()=>{request.signal.throwIfAborted();const current=await getCurrentUser(request);if(!current||current.id!==user.id||current.temporary||current.isCharacter||current.accountKind!=='user'||mongoDataPlane()!=='home')return fail(401,'The backup authorization changed');};
  const access:BackupAccess={scope:{apiOrigin:origin,ownerId:user.id,dataPlane:'home'},authorize,signal:request.signal};
  return {user,origin,access,authorize};
 };
 const openSnapshot=async(source:CompletedBackupJob,access:BackupAccess)=>{
  if(source.operation.kind!=='snapshot'||!source.cursor.planHash||!source.cursor.sealHash)return fail(409,'A sealed snapshot is required');
  const opened=await deps.open(source.operation.destinationId,access);return {store:opened.store,snapshotId:source.operation.snapshotId,planHash:source.cursor.planHash,sealHash:source.cursor.sealHash};
 };
 const catalog=async(request:Request,input:{snapshotCursor?:string;jobCursor?:string}={}):Promise<BackupWorkspaceCatalog>=>{
  const current=await scope(request),[snapshots,jobs,storage,worker]=await Promise.all([deps.jobs.catalog(request,'snapshots',cursor(input.snapshotCursor)),deps.jobs.catalog(request,'jobs',cursor(input.jobCursor)),deps.discover(current.origin),deps.worker(current.origin)]);
  await current.authorize();
  return {snapshots:{items:snapshots.items.map(({job,source})=>({id:job.id,name:'Snapshot · '+new Date((source?.cursor.snapshotSeconds??0)*1000||Date.parse(job.createdAt)).toLocaleString('en-GB',{timeZone:'UTC'}),createdAt:job.createdAt,integrity:'verified',coverage:'partial',description:'Supported content; verified at capture. Current bytes are rechecked before restore. Whole-account readiness remains false.'})),nextCursor:snapshots.next?encode(snapshots.next):null},
   jobs:{items:jobs.items.map(value=>value.job),nextCursor:jobs.next?encode(jobs.next):null},destinations:storage.destinations,
   storage:storage.availability==='configured'?{available:true}:{available:false,reason:storage.reason??'not-configured'},worker,
   coverageNote:'Files, retained file history and ordinary saved content use an independently sealed snapshot. Unsupported families remain excluded; review certifies only the chosen graph. Configured storage is unverified until a snapshot completes.'};
 };
 const entries=async(request:Request,id:string,continuation?:string):Promise<BackupWorkspacePage<BackupWorkspaceEntry>>=>{
  const current=await scope(request),source=await deps.jobs.readCompleted(request,uuid(id),'snapshot'),snapshot=await openSnapshot(source,current.access),view=await openBackupWorkerView(snapshot.store,snapshot.snapshotId,current.access,{planHash:snapshot.planHash,sealHash:snapshot.sealHash});
  const stateHash=source.cursor.catalogStateHash;
  const state=stateHash?await readSnapshotCatalogState(snapshot.store,snapshot.snapshotId,snapshot.planHash,stateHash,current.access):null;
  let page=state?state.pages-1:view.plan.pages-1,hash=state?state.headHash:view.plan.headHash;
  const audience=current.origin,purpose='thingtime-backup-browse-v1';
  const binding=(position:{page:number;hash:string})=>backupJobDigest([current.access.scope,id,snapshot.planHash,snapshot.sealHash,stateHash??null,position]);
  if(continuation){const data=decode(continuation);if(!exact(data,'position,proof')||!exact(data.position,'hash,page')||!Number.isSafeInteger(data.position.page)||data.position.page<0||!backupDigest(data.position.hash)||typeof data.proof!=='string'||!await verifyContentProof(data.proof,purpose,binding(data.position),audience))return fail(400,'Invalid snapshot continuation');page=data.position.page;hash=data.position.hash;}
  if(page<0){await current.authorize();return {items:[],nextCursor:null};}if(!hash)return fail(409,'The snapshot catalogue is unavailable');
  let items:BackupWorkspaceEntry[],previous:string|null;
  if(state){const found=await readSnapshotCatalogPage(snapshot.store,snapshot.snapshotId,snapshot.planHash,hash,page,current.access);items=found.entries;previous=found.previous;}
  else{const found=await view.readPlanPage(page,hash);items=found.items.map(snapshotCatalogEntry).filter((value):value is BackupWorkspaceEntry=>value!==null);previous=found.previous;}
  let nextCursor:string|null=null;if(page>0){if(!previous)return fail(409,'Snapshot catalogue chain changed');const position={page:page-1,hash:previous};nextCursor=encode({position,proof:await signContentProof(purpose,binding(position),audience)});}
  await current.authorize();return {items,nextCursor};
 };
 const job=async(request:Request,id:string)=>{const current=await scope(request),view=await deps.jobs.current(request,uuid(id));await current.authorize();return view;};
 const review=async(request:Request,id:string):Promise<BackupWorkspaceReview>=>{
  const current=await scope(request),completed=await deps.jobs.readCompleted(request,uuid(id),'review');
  const value=await readAccountRestoreReview({jobId:id,guard:current.authorize,completedSource:(sourceId,kind)=>deps.jobs.readCompleted(request,sourceId,kind)},
   {access:current.access,openSnapshot:source=>openSnapshot(source,current.access)},completed);
  const folder=await findViewableThing(value.destination.id,current.user);await current.authorize();
  if(!folder||folder.ownerId!==current.user.id||!folder.thingtime?.includes('folder')||folder.timelineHeadId!==value.destination.revision)
   return {...value,executable:false,limitations:[...value.limitations,'The selected destination changed. Review the selection again.']};
  return {...value,destination:{...value.destination,name:typeof folder?.crystal?.name==='string'?folder.crystal.name:value.destination.name,path:typeof folder?.crystal?.name==='string'?folder.crystal.name:value.destination.path}};
 };
 const command=async(request:Request,raw:unknown)=>{
  const input=parseBackupWorkspaceCommand(raw),current=await scope(request);
  if(['pause','resume','retry','cancel'].includes(input.action)){
   const control=input as Extract<BackupWorkspaceCommand,{jobId:string}>;
   if(control.action==='resume'||control.action==='retry'){const worker=await deps.worker(current.origin);if(worker.available!==true&&worker.reason!=='worker-unverified')return fail(503,'Background backup execution is unavailable');}
   const view=await deps.jobs.control(request,control.jobId,control.action);
   if(control.action==='resume'||control.action==='retry')deps.kick(view.id,current.origin);return view;
  }
  const worker=await deps.worker(current.origin);if(worker.available!==true&&worker.reason!=='worker-unverified')return fail(503,'Background backup execution is unavailable');
  let operation:any,binding:string;
  if(input.action==='snapshot'){
   const opened=await deps.open(input.destinationId,current.access);binding=opened.binding;
   operation={kind:'snapshot',snapshotId:stableId(['snapshot',current.user.id,current.origin,input.requestId,input.destinationId]),destinationId:input.destinationId};
  }else if(input.action==='review'){
   const source=await deps.jobs.readCompleted(request,input.selection.snapshotId,'snapshot');if(source.operation.kind!=='snapshot')return fail(409,'A sealed snapshot is required');
   const destination=await findViewableThing(input.selection.destination.id,current.user);
   if(!destination||destination.ownerId!==current.user.id||!destination.thingtime?.includes('folder')||destination.timelineHeadId!==input.selection.destination.revision)return fail(409,'The selected destination changed');
   binding=(await deps.open(source.operation.destinationId,current.access)).binding;
   operation={kind:'review',sourceJobId:source.jobId,sourceRootId:input.selection.sourceRootId,destinationId:input.selection.destination.id,destinationRevision:input.selection.destination.revision};
  }else if(input.action==='restore'){
   const selected=await review(request,input.reviewId);if(selected.hash!==input.reviewHash||!selected.executable)return fail(409,'Review this exact selection before restoring');
   const completed=await deps.jobs.readCompleted(request,input.reviewId,'review');if(completed.operation.kind!=='review')return fail(409,'A completed review is required');
   const snapshot=await deps.jobs.readCompleted(request,completed.operation.sourceJobId,'snapshot');if(snapshot.operation.kind!=='snapshot')return fail(409,'A completed snapshot is required');
   binding=(await deps.open(snapshot.operation.destinationId,current.access,completed.destinationBinding)).binding;
   operation={kind:'restore',reviewJobId:input.reviewId,reviewHash:input.reviewHash};
  }else return fail(400,'Invalid backup command');
  await current.authorize();const view=await deps.jobs.admit(request,{requestId:input.requestId,operation,destinationBinding:binding});deps.kick(view.id,current.origin);return view;
 };
 return {catalog,entries,job,review,command};
}
export const backupWorkspaceService=createBackupWorkspaceService();
