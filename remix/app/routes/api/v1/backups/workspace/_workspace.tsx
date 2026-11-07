import { json, readJsonBody, requestWithSignal, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { internalRequestActor } from '~/api/utils/auth/internalRequestActor';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { EXPECTED_ACTOR_HEADER } from '~/api/utils/auth/expectedActor';
import { mongoDataPlane } from '~/api/utils/mongodb/dataPlane';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { backupWorkspaceService, BackupWorkspaceError } from '~/api/utils/backups/backupWorkspace.server';
import { awaitBackupAbort } from '~/api/utils/backups/backupTransport.server';
import { StorageMutationError } from '~/api/utils/storage/storageCore';
const headers={'Cache-Control':'private, no-store',Pragma:'no-cache','X-Content-Type-Options':'nosniff'};
export function createBackupWorkspaceHandlers(overrides:Partial<{service:typeof backupWorkspaceService;limit:typeof enforceRateLimit}>={}){
 const deps={service:backupWorkspaceService,limit:enforceRateLimit,...overrides};
 const reply=(value:unknown,status=200)=>json(value,{status,headers});
 const handle=async(input:Request,mutation:boolean)=>{
  const signal=AbortSignal.any([input.signal,AbortSignal.timeout(30_000)]);
  if(internalRequestActor(input))return reply({ok:false,error:'Use your full account on this origin'},403);
  const request=requestWithSignal(input,signal);
  try{
   const origin=resolvePublicOrigin(request).origin;
   if((request.headers.has('Origin')&&request.headers.get('Origin')!==origin)||request.headers.get('Sec-Fetch-Site')==='cross-site'||internalRequestActor(input))return reply({ok:false,error:'Use your full account on this origin'},403);
   const user=await awaitBackupAbort(getCurrentUser(request),signal);
   if(!user)return reply({ok:false,error:'Unauthorized'},401);
   if(user.temporary||user.isCharacter||user.accountKind!=='user')return reply({ok:false,error:'Use your full Thingtime account'},403);
   if(request.headers.has(EXPECTED_ACTOR_HEADER)&&request.headers.get(EXPECTED_ACTOR_HEADER)!==user.id)return reply({ok:false,error:'The active account changed'},409);
   if(mongoDataPlane()!=='home')return reply({ok:false,error:'Backups require home storage'},409);
   const limit=await awaitBackupAbort(deps.limit(request,mutation?'backups.workspace.write':'backups.workspace.read',`user:${user.id}`,{failClosed:true}),signal);
   if(!limit.allowed){const init=rateLimitedResponseInit(limit);return json({ok:false,error:'Retry this backup operation shortly'},{...init,headers:{...Object.fromEntries(new Headers(init.headers)),...headers}});}
   const params=new URL(request.url).searchParams;
   if(mutation){if(params.size)return reply({ok:false,error:'Backup commands do not accept query selectors'},400);
    const invalidType=requireJsonContentType(request);if(invalidType)return reply({ok:false,error:'Use application/json'},415);
    const command=await awaitBackupAbort(readJsonBody(request,16*1024),signal),job=await awaitBackupAbort(deps.service.command(request,command),signal);return reply({ok:true,job});}
   const view=params.get('view')??'catalog',allowed=view==='catalog'?['view','snapshotCursor','jobCursor']:view==='snapshot'?['view','id','cursor']:['view','id'];
   if([...params.keys()].some(key=>!allowed.includes(key))||[...params.keys()].some(key=>params.getAll(key).length!==1))return reply({ok:false,error:'Invalid backup selectors'},400);
   if(view==='catalog')return reply({ok:true,...await awaitBackupAbort(deps.service.catalog(request,{snapshotCursor:params.get('snapshotCursor')??undefined,jobCursor:params.get('jobCursor')??undefined}),signal)});
   const id=params.get('id');if(!id)return reply({ok:false,error:'Choose a saved backup operation'},400);
   if(view==='snapshot')return reply({ok:true,...await awaitBackupAbort(deps.service.entries(request,id,params.get('cursor')??undefined),signal)});
   if(view==='job')return reply({ok:true,job:await awaitBackupAbort(deps.service.job(request,id),signal)});
   if(view==='review')return reply({ok:true,review:await awaitBackupAbort(deps.service.review(request,id),signal)});
   return reply({ok:false,error:'Invalid backup view'},400);
  }catch(error){
   if(error instanceof Response&&error.status===413)return reply({ok:false,error:'Backup control request is too large'},413);
   if(error instanceof BackupWorkspaceError)return reply({ok:false,error:error.message},error.status);
   if(error instanceof StorageMutationError&&error.status<500)return reply({ok:false,error:'The saved backup operation, destination or authorization changed'},error.status);
   return reply({ok:false,error:signal.aborted?'This backup request timed out. Check saved progress before retrying.':'The backup workspace is temporarily unavailable'},503);
  }
 };
 return {loader:({request}:{request:Request})=>request.method==='GET'?handle(request,false):Promise.resolve(reply({ok:false,error:'Method not allowed'},405)),
 action:({request}:{request:Request})=>request.method==='POST'?handle(request,true):Promise.resolve(reply({ok:false,error:'Method not allowed'},405))};
}
export const {loader,action}=createBackupWorkspaceHandlers();
