import React from 'react';
import {useCurrentUser} from '~/hooks/useCurrentUser';
import {passwordRequest} from '~/passwords/client';
import {extensionAccounts} from '~/passwords/browserExtensionAccounts';

/** An isolated extension channel requests metadata; the page never transfers
 * authentication. Exact-origin/document checks live in the extension adapter. */
export function BrowserExtensionAccountBridge(){
 const user=useCurrentUser();
 React.useEffect(()=>{
  const active=new Set<AbortController>();let dead=false;
  const receive=(event:Event)=>{let value:any;try{value=JSON.parse((event as CustomEvent).detail);}catch{return;}
   if(value?.version!==1||!['discover','catalog'].includes(value.operation)||typeof value.nonce!=='string'||!/^[-a-f0-9]{36}$/i.test(value.nonce))return;
   const controller=new AbortController();active.add(controller);
   void (async()=>{const accounts=await extensionAccounts(controller.signal);if(value.operation!=='catalog')return {accounts};const ownerId=accounts.find(a=>a.active)?.id;if(!ownerId||ownerId!==value.ownerId)throw Error('The account changed.');const catalog:any[]=[];let cursor:string|undefined;const seen=new Set<string>();do{const result=await passwordRequest(ownerId,{operation:'catalog',...(cursor?{cursor}:{})},controller.signal);for(const item of result.catalog||[])if(item.fillEligible===true)catalog.push({id:item.id,title:item.title||'',username:item.username||'',domains:item.domains||[],fillEligible:true});cursor=result.nextCursor||undefined;if(cursor&&seen.has(cursor))throw Error('Repeated catalog cursor.');if(cursor)seen.add(cursor);}while(cursor);const latest=await extensionAccounts(controller.signal);if(latest.find(a=>a.active)?.id!==ownerId)throw Error('The account changed.');return {accounts:latest,catalog,ownerId};})().then(result=>{if(!dead)document.dispatchEvent(new CustomEvent('thingtime:extension-accounts-response',{detail:JSON.stringify({version:1,nonce:value.nonce,...result})}));}).catch(()=>{if(!dead)document.dispatchEvent(new CustomEvent('thingtime:extension-accounts-response',{detail:JSON.stringify({version:1,nonce:value.nonce,error:true})}));}).finally(()=>active.delete(controller));
  };
  const changed=()=>document.dispatchEvent(new CustomEvent('thingtime:extension-accounts-changed',{detail:JSON.stringify({ownerId:user?.id||null})}));
  const refresh=()=>document.dispatchEvent(new CustomEvent('thingtime:extension-accounts-changed',{detail:JSON.stringify({refresh:true})}));
  document.addEventListener('thingtime:extension-accounts-request',receive);
  window.addEventListener('thingtime:root-data-refresh',refresh);changed();
  return()=>{dead=true;for(const c of active)c.abort();document.removeEventListener('thingtime:extension-accounts-request',receive);window.removeEventListener('thingtime:root-data-refresh',refresh);};
 },[user?.id]);
 return null;
}
