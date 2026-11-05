import {parse as parseDomain} from 'tldts';
import {requireThingtimeCapability} from '~/api/utils/capabilities/requireCapability.client';
import {nativePasswordVerificationRequest,passwordRequest} from './client';
import {passwordWebsiteOrigin} from './websites';
export type VaultRequest={version:1;id:string;type:'catalog'|'fill'|'totp-import';origin:string;entryId?:string;totp?:string;query?:string;cursor?:string;target:{tabId:number;frameId:0;documentId:string};presentation?:{fontSize:number}};
type NativeBase={version:1;id:string;expectedOwnerId:string;apiOrigin:string;entryId:string;requestHash:string};
export type NativeApprovalRequest=NativeBase&({type:'fill';origin:string}|{type:'native-consumer';consumerId:'org.gnome.keyring'});
type FillRequest=Pick<VaultRequest,'id'|'origin'|'entryId'>&{requestHash?:string};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const proofValue=/^[A-Za-z0-9_-]{43}$/;
export function validateVaultRequest(input:unknown):VaultRequest {
 const v=input as VaultRequest;const u=new URL(v?.origin);
 const local=['localhost','127.0.0.1'].includes(u.hostname);
 if(v?.version!==1||!/^[-a-f0-9]{36}$/.test(v.id)||!['catalog','fill','totp-import'].includes(v.type)||u.origin!==v.origin||u.username||u.password||(u.protocol!=='https:'&&!(local&&u.protocol==='http:'))||!v.target||!Number.isInteger(v.target.tabId)||v.target.frameId!==0||typeof v.target.documentId!=='string'||!v.target.documentId)throw new DOMException('Invalid password workspace request.','SecurityError');
 const domain=parseDomain(u.hostname,{allowPrivateDomains:true});
 if(!local&&(!domain.domain||domain.publicSuffix===u.hostname||domain.isIp))throw new DOMException('Unsupported website domain.','SecurityError');
 if(v.type==='fill'&&(typeof v.entryId!=='string'||!v.entryId))throw new DOMException('Choose a saved account.','DataError');
 if(v.type==='totp-import'&&(typeof v.totp!=='string'||!/^otpauth:\/\/totp\//i.test(v.totp)))throw new DOMException('Choose an authenticator setup code.','DataError');
 return structuredClone(v);
}
export function validateNativeApprovalRequest(input:unknown,ownerId:string):NativeApprovalRequest {
 const r=input as NativeApprovalRequest;
 if(r?.version!==1||r.expectedOwnerId!==ownerId||typeof r.id!=='string'||!UUID.test(r.id)||typeof r.entryId!=='string'||!UUID.test(r.entryId)||typeof r.requestHash!=='string'||!proofValue.test(r.requestHash))throw new Error('The native password approval request changed.');
 const api=new URL(r.apiOrigin);
 if(api.origin!==r.apiOrigin||(api.protocol!=='https:'&&!(api.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(api.hostname))))throw new Error('The native vault origin is invalid.');
 const base={version:1 as const,id:r.id,expectedOwnerId:ownerId,apiOrigin:api.origin,entryId:r.entryId,requestHash:r.requestHash};
 if(r.type==='native-consumer'&&r.consumerId==='org.gnome.keyring')return {...base,type:r.type,consumerId:r.consumerId};
 if(r.type==='fill'){
  const website=new URL(r.origin);
  if(website.protocol==='https:'&&website.origin===r.origin)return {...base,type:r.type,origin:website.origin};
 }
 throw new Error('The native credential destination is invalid.');
}
export const fillContext=(r:FillRequest)=>({purpose:'fill' as const,rp:new URL(r.origin).hostname,origin:r.origin,entryId:r.entryId!,...(r.requestHash?{requestHash:r.requestHash}:{})});
export const ensurePasswordFill=()=>requireThingtimeCapability('api.passwords','1.6.1');
/** Keep discovery metadata only. Preserve absence for pre-1.7 APIs, and
 * never turn a malformed or empty exact-origin list into a hostname grant. */
export function browserPasswordCatalogEntry(item:{id:string;title?:string;username?:string;domains?:string[];origins?:unknown}){
 const {id,title='',username='',domains=[]}=item;
 const origins=item.origins;
 return {id,title,username,domains,...(origins===undefined?{}:{origins:Array.isArray(origins)?origins.filter((value):value is string=>typeof value==='string'&&passwordWebsiteOrigin(value)===value):[]}),fillEligible:true as const};
}
export async function fillVerification(ownerId:string,r:VaultRequest,signal:AbortSignal){await ensurePasswordFill();signal.throwIfAborted();return passwordRequest(ownerId,{operation:'verification-status',context:fillContext(r)},signal);}
export async function loadPasswordCatalog(ownerId:string,r:VaultRequest,signal:AbortSignal){
 await ensurePasswordFill();const catalog:(ReturnType<typeof browserPasswordCatalogEntry>&{hasPassword:true})[]=[];const seen=new Set<string>();let cursor:string|undefined;
 do{
  signal.throwIfAborted();
  const result=await passwordRequest(ownerId,{operation:'catalog',...(cursor?{cursor}:{})},signal);
  signal.throwIfAborted();
  for(const item of result.catalog||[]){
   if(item.fillEligible!==true)continue;
   if(r.type==='fill'){
    if(item.id===r.entryId)return [{...browserPasswordCatalogEntry(item),hasPassword:true as const}];
   }else catalog.push({...browserPasswordCatalogEntry(item),hasPassword:true});
  }
  cursor=result.nextCursor||undefined;
  if(cursor&&seen.has(cursor))throw Error('The account list could not finish. Reconnect and retry.');
  if(cursor)seen.add(cursor);
 }while(cursor);
 return catalog;
}

type VerifyRequest=(body:Record<string,unknown>)=>Promise<{verified?:boolean;requestId?:string;sessionBinding?:string}>;
async function verifyApproval(id:string,context:ReturnType<typeof fillContext>|undefined,password:string,signal:AbortSignal,request:VerifyRequest){
 signal.throwIfAborted();
 const verified=await request({operation:'verify-passkey',requestId:id,...(context?{context}:{}),...(password?{password}:{})});
 password='';signal.throwIfAborted();
 if(verified.verified!==true||verified.requestId!==id||typeof verified.sessionBinding!=='string'||!proofValue.test(verified.sessionBinding))throw Error('Verify your Thingtime account again.');
 return {requestId:id,binding:verified.sessionBinding,...(context?{context}:{})};
}

export async function nativeApprovalDetails(ownerId:string,r:NativeApprovalRequest,signal:AbortSignal){
 const request=(body:Record<string,unknown>)=>nativePasswordVerificationRequest(ownerId,r.apiOrigin,body,signal);
 const seen=new Set<string>();let cursor:string|undefined, selected;
 do{
  signal.throwIfAborted();const page=await request({operation:'catalog',...(cursor?{cursor}:{})});
  selected=page.catalog?.find((item:{id:string;fillEligible?:boolean;origins?:string[]})=>item.id===r.entryId&&item.fillEligible===true&&(r.type==='native-consumer'||item.origins?.includes(r.origin)));
  cursor=page.nextCursor||undefined;
  if(cursor&&seen.has(cursor))throw Error('The account list could not finish.');
  if(cursor)seen.add(cursor);
 }while(cursor&&!selected);
 if(!selected)throw Error('The selected account is unavailable.');
 const required=r.type==='native-consumer'||(await request({operation:'verification-status',context:fillContext(r)})).required!==false;
 signal.throwIfAborted();return {account:[selected.title,selected.username].filter(Boolean).join(' · '),required};
}

export function verifyNativeApproval(ownerId:string,r:NativeApprovalRequest,password:string,signal:AbortSignal){
 if(r.type==='native-consumer'&&!password)throw Error('Enter the current Thingtime account password.');
 return verifyApproval(r.id,r.type==='fill'?fillContext(r):undefined,password,signal,body=>nativePasswordVerificationRequest(ownerId,r.apiOrigin,body,signal));
}

export async function runPasswordFill(ownerId:string,r:VaultRequest,password:string,signal:AbortSignal){
 await ensurePasswordFill();
 const proof=await verifyApproval(r.id,fillContext(r),password,signal,body=>passwordRequest(ownerId,body,signal));password='';
 const values=await passwordRequest(ownerId,{operation:'fill',id:r.entryId,passkeySession:proof},signal);signal.throwIfAborted();
 if(typeof values.username!=='string'||typeof values.password!=='string')throw Error('Saved account fields are unavailable.');
 return {username:values.username,password:values.password};
}
