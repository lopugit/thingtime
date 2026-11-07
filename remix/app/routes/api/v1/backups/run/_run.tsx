import { timingSafeEqual } from 'node:crypto';
import { json, readJsonBody } from '~/api/http';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { internalRequestActor } from '~/api/utils/auth/internalRequestActor';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { EXPECTED_ACTOR_HEADER } from '~/api/utils/auth/expectedActor';
import { mongoDataPlane } from '~/api/utils/mongodb/dataPlane';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { runBackupDispatchOutbox } from '~/api/utils/backups/backupDispatch.server';
const headers={ 'Cache-Control':'private, no-store',Pragma:'no-cache','X-Content-Type-Options':'nosniff' };
export function createBackupDispatchHandlers(overrides:Partial<{
 secret():string|undefined;admin:typeof requireAdmin;plane:typeof mongoDataPlane;
 run:typeof runBackupDispatchOutbox;limit:typeof enforceRateLimit;
}>={}){
 const deps={secret:()=>process.env.CRON_SECRET,admin:requireAdmin,plane:mongoDataPlane,run:runBackupDispatchOutbox,limit:enforceRateLimit,...overrides};
 const reply=(body:unknown,status=200)=>json(body,{status,headers});
 const execute=async(request:Request)=>{
  if(new URL(request.url).search)return reply({ok:false,error:'Backup dispatch does not accept selectors'},400);
  try{return reply({ok:true,dispatch:await deps.run(resolvePublicOrigin(request).origin)});}
  catch{return reply({ok:false,error:'Backup dispatch is temporarily unavailable'},503);}
 };
 const loader=async({request}:{request:Request})=>{
  if(request.method!=='GET')return reply({ok:false,error:'Method not allowed'},405);
  const secret=deps.secret()?.trim(),provided=Buffer.from(request.headers.get('authorization')||''),expected=secret?Buffer.from(`Bearer ${secret}`):null;
  if(!expected || provided.length!==expected.length || !timingSafeEqual(provided,expected))return reply({ok:false,error:'Unauthorized scheduler'},401);
  return execute(request);
 };
 const action=async({request}:{request:Request})=>{
  if(request.method!=='POST')return reply({ok:false,error:'Method not allowed'},405);
  const origin=resolvePublicOrigin(request).origin;
  if((request.headers.has('Origin')&&request.headers.get('Origin')!==origin)||request.headers.get('Sec-Fetch-Site')==='cross-site'||internalRequestActor(request))
   return reply({ok:false,error:'Use the full administrator session on this origin'},403);
  const gate=await deps.admin(request);if('error'in gate)return reply({ok:false,error:gate.error.message},gate.error.status);
  if(gate.user.temporary||gate.user.isCharacter||gate.user.accountKind!=='user')return reply({ok:false,error:'A full administrator account is required'},403);
  if(request.headers.has(EXPECTED_ACTOR_HEADER)&&request.headers.get(EXPECTED_ACTOR_HEADER)!==gate.user.id)return reply({ok:false,error:'The active account changed'},409);
  if(deps.plane()!=='home')return reply({ok:false,error:'Backup dispatch requires home storage'},409);
  if(request.body){try{const body=await readJsonBody(request,1024);if(!body||Array.isArray(body)||Object.keys(body).length)return reply({ok:false,error:'Backup dispatch does not accept commands'},400);}catch{return reply({ok:false,error:'Invalid backup dispatch request'},400);}}
  const limit=await deps.limit(request,'backups.dispatch',`user:${gate.user.id}`,{failClosed:true});
  if(!limit.allowed){const init=rateLimitedResponseInit(limit);return json({ok:false,error:'Retry backup dispatch shortly'},{...init,headers:{...Object.fromEntries(new Headers(init.headers)),...headers}});}
  return execute(request);
 };
 return {loader,action};
}
export const {loader,action}=createBackupDispatchHandlers();
