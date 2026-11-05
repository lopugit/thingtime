import React from 'react';
import {useCurrentUser} from '~/hooks/useCurrentUser';
import {passwordRequest} from '~/passwords/client';
import {extensionAccounts} from '~/passwords/browserExtensionAccounts';
import {browserPasswordCatalogEntry} from '~/passwords/browserPasswordFill';

/** An isolated extension channel requests metadata; the page never transfers
 * authentication. Exact-origin/document checks live in the extension adapter. */
export function BrowserExtensionAccountBridge(){
 const user=useCurrentUser();
 React.useEffect(()=>{
  const active=new Map<string,AbortController>();let dead=false;
  const payload=(event:Event)=>{
   try{
    const value=JSON.parse((event as CustomEvent).detail);
    if(value?.version===1&&typeof value.nonce==='string'&&/^[-a-f0-9]{36}$/i.test(value.nonce))return value;
   }catch{}
   return null;
  };
  const cancel=(event:Event)=>{const value=payload(event);if(value)active.get(value.nonce)?.abort();};
  const receive=(event:Event)=>{
   const value=payload(event);
   if(!value||!['discover','catalog'].includes(value.operation)||active.has(value.nonce))return;
   const controller=new AbortController(),{signal}=controller;
   active.set(value.nonce,controller);
   const reply=(result:Record<string,unknown>)=>{
    if(!dead&&!signal.aborted)document.dispatchEvent(new CustomEvent('thingtime:extension-accounts-response',{detail:JSON.stringify({version:1,nonce:value.nonce,...result})}));
   };
   void (async()=>{
    const accounts=await extensionAccounts(signal);
    if(value.operation!=='catalog')return {accounts};
    const ownerId=accounts.find(account=>account.active)?.id;
    if(!ownerId||ownerId!==value.ownerId)throw Error('The account changed.');
    const catalog:ReturnType<typeof browserPasswordCatalogEntry>[]=[],seen=new Set<string>();
    let cursor:string|undefined;
    do{
     signal.throwIfAborted();
     const result=await passwordRequest(ownerId,{operation:'catalog',...(cursor?{cursor}:{})},signal);
     for(const item of result.catalog||[])if(item.fillEligible===true)catalog.push(browserPasswordCatalogEntry(item));
     cursor=result.nextCursor||undefined;
     if(cursor&&seen.has(cursor))throw Error('Repeated catalog cursor.');
     if(cursor)seen.add(cursor);
    }while(cursor);
    const latest=await extensionAccounts(signal);
    if(latest.find(account=>account.active)?.id!==ownerId)throw Error('The account changed.');
    return {accounts:latest,catalog,ownerId};
   })().then(reply).catch(()=>reply({error:true})).finally(()=>active.delete(value.nonce));
  };
  const changed=()=>document.dispatchEvent(new CustomEvent('thingtime:extension-accounts-changed',{detail:JSON.stringify({ownerId:user?.id||null})}));
  const refresh=()=>document.dispatchEvent(new CustomEvent('thingtime:extension-accounts-changed',{detail:JSON.stringify({refresh:true})}));
  document.addEventListener('thingtime:extension-accounts-request',receive);
  document.addEventListener('thingtime:extension-accounts-cancel',cancel);
  window.addEventListener('thingtime:root-data-refresh',refresh);changed();
  return()=>{dead=true;for(const controller of active.values())controller.abort();document.removeEventListener('thingtime:extension-accounts-request',receive);document.removeEventListener('thingtime:extension-accounts-cancel',cancel);window.removeEventListener('thingtime:root-data-refresh',refresh);};
 },[user?.id]);
 return null;
}
