import { getRequestMongoEndpoint } from '~/api/utils/mongodb/endpoint';
import { mongoDataPlane } from '~/api/utils/mongodb/dataPlane';
import { json, readJsonBody } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { characterPrincipal } from '~/api/utils/auth/characterSession';
import { isAdminDoc } from '~/api/utils/auth/admin';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { platformReporting } from '~/api/utils/automation/platformReporting';

export const createPlatformReportingRoute = (deps = {principal:characterPrincipal, reporting:platformReporting}) => {
  const handle = (request: Request, mutation: boolean) => withAdminPrivateResponse(async () => {
    if (request.method !== (mutation?'POST':'GET')) return json({ok:false,error:'Method not allowed'},{status:405});
    const principal=await deps.principal(request);
    if (!principal) return json({ok:false,error:'Full administrator session required'},{status:401});
    const user=principal.user;
    if (!isAdminDoc(user) || user.meta?.character || user.accountKind==='service' || user.meta?.temporary===true || ![undefined,null,'browser'].includes(principal.session.purpose) || principal.session.meta?.activeCharacterId || request.headers.has('X-Thingtime-Character')) return json({ok:false,error:'Use the administrator account directly'},{status:403});
    const actorId=String(user._id);
    const expected=request.headers.get('X-Thingtime-Expected-Actor');
    if ((mutation && !expected) || (expected!==null && expected!==actorId)) return json({ok:false,error:'The active account changed. Refresh and try again.'},{status:409});
    try {
      if (mongoDataPlane(await getRequestMongoEndpoint(request))!=='home') return json({ok:false,error:'Manage platform reporting on home storage'},{status:409});
      if (!mutation) {
        const description=await deps.reporting.describeConfig();
        return json({ok:true,status:description.config?(description.config.enabled?'enabled':'disabled'):'unconfigured',...description});
      }
      const origin=request.headers.get('Origin');
      if (request.headers.get('Sec-Fetch-Site')==='cross-site' || (origin && origin!==resolvePublicOrigin(request).origin)) return json({ok:false,error:'Same-origin request required'},{status:403});
      if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return json({ok:false,error:'JSON body required'},{status:415});
      const input=await readJsonBody(request,16*1024);
      if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!['enabled','ownerId','characterId','groupId','groupOwnerId','revision'].includes(key))) return json({ok:false,error:'Invalid reporting settings'},{status:400});
      const result=await deps.reporting.setConfig(actorId,input);
      return json(result,{status:result.ok === false?result.status:200});
    } catch { return json({ok:false,error:'Platform reporting settings unavailable'},{status:503}); }
  });
  return {loader:({request}:{request:Request})=>handle(request,false),action:({request}:{request:Request})=>handle(request,true)};
};
const route=createPlatformReportingRoute();
export const loader=route.loader;
export const action=route.action;
