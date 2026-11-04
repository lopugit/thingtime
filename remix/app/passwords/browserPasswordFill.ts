import {parse as parseDomain} from 'tldts';
import {requireThingtimeCapability} from '~/api/utils/capabilities/requireCapability.client';
import {passwordRequest} from './client';
export type VaultRequest={version:1;id:string;type:'catalog'|'fill'|'totp-import';origin:string;entryId?:string;totp?:string;query?:string;cursor?:string;target:{tabId:number;frameId:0;documentId:string};presentation?:{fontSize:number}};
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
export const fillContext=(r:VaultRequest)=>({purpose:'fill' as const,rp:new URL(r.origin).hostname,origin:r.origin,entryId:r.entryId!});
export const ensurePasswordFill=()=>requireThingtimeCapability('api.passwords','1.6.1');
export async function fillVerification(ownerId:string,r:VaultRequest,signal:AbortSignal){await ensurePasswordFill();signal.throwIfAborted();return passwordRequest(ownerId,{operation:'verification-status',context:fillContext(r)},signal);}
export async function loadPasswordCatalog(ownerId:string,r:VaultRequest,signal:AbortSignal){
 await ensurePasswordFill();const catalog:any[]=[];const seen=new Set<string>();let cursor:string|undefined;
 do{signal.throwIfAborted();const result=await passwordRequest(ownerId,{operation:'catalog',...(cursor?{cursor}:{})},signal);signal.throwIfAborted();for(const item of result.catalog||[])if(item.fillEligible===true)catalog.push({id:item.id,title:item.title||'',username:item.username||'',domains:item.domains||[],hasPassword:true,fillEligible:true});cursor=result.nextCursor||undefined;if(cursor&&seen.has(cursor))throw Error('The account list could not finish. Reconnect and retry.');if(cursor)seen.add(cursor);}while(cursor);
 return catalog;
}
export async function runPasswordFill(ownerId:string,r:VaultRequest,password:string,signal:AbortSignal){
 await ensurePasswordFill();signal.throwIfAborted();const context=fillContext(r);
 const verified=await passwordRequest(ownerId,{operation:'verify-passkey',requestId:r.id,context,...(password?{password}:{})},signal);password='';signal.throwIfAborted();
 if(verified.verified!==true||verified.requestId!==r.id||typeof verified.sessionBinding!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(verified.sessionBinding))throw Error('Verify your Thingtime account again.');
 const values=await passwordRequest(ownerId,{operation:'fill',id:r.entryId,passkeySession:{requestId:r.id,binding:verified.sessionBinding,context}},signal);signal.throwIfAborted();
 if(typeof values.username!=='string'||typeof values.password!=='string')throw Error('Saved account fields are unavailable.');
 return {username:values.username,password:values.password};
}
