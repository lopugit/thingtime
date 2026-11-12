import React from 'react';
import {useCurrentUser} from '~/hooks/useCurrentUser';
import {AccountSwitcher} from '../Account/AccountSwitcher';
import {SettingsDocumentHost} from '../Settings/SettingsDocumentHost';
import {TransientBlockHost} from '../Builder/TransientBlockHost';
import {WebpageBlocksRenderer} from '../Builder/WebpageBlocksRenderer';
import {BROWSER_EXTENSION_ACCOUNT_BLOCKS,BROWSER_EXTENSION_ACCOUNT_FOOTER} from './browserExtensionAccountBlocks';
export function BrowserExtensionAccounts(){
 const ownerId=useCurrentUser()?.id||'anonymous';
 React.useEffect(()=>{const previous=document.documentElement.style.fontSize;const font=Number(new URLSearchParams(location.search).get('fontSize'));if(Number.isSafeInteger(font)&&font>0)document.documentElement.style.fontSize=`${font}px`;return()=>{document.documentElement.style.fontSize=previous;};},[]);
 const headerDirty=React.useRef(false),footerDirty=React.useRef(false);
 const [returnStatus,setReturnStatus]=React.useState('');
 React.useEffect(()=>{
  const receive=(event:Event)=>{try{const value=JSON.parse((event as CustomEvent).detail);if(!value.ok)setReturnStatus('The original workspace is no longer available. Open Thingtime from its browser toolbar.');}catch{}};
  document.addEventListener('thingtime:extension-accounts-completed',receive);
  return()=>document.removeEventListener('thingtime:extension-accounts-completed',receive);
 },[]);
 const actions={'accounts.return':()=>{
  const operation=new URLSearchParams(location.search).get('operation');
  if(!operation){setReturnStatus('Open this account window from the Thingtime browser workspace.');return;}
  document.dispatchEvent(new CustomEvent('thingtime:extension-accounts-complete',{detail:JSON.stringify({operation,canClose:!headerDirty.current&&!footerDirty.current&&!document.querySelector('input[type=password]')})}));
 }};
 return <div style={{maxWidth:640,margin:'0 auto',padding:'24px 16px'}}>
  <SettingsDocumentHost documentKey="browser-extension-accounts" scopeKey={ownerId} title="Browser account layout" defaultDocument={BROWSER_EXTENSION_ACCOUNT_BLOCKS}>
   {({blocks,chrome,editing,dirty})=>{headerDirty.current=editing||dirty;return <><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare/>{editing?<p>Account actions pause while editing this layout.</p>:<AccountSwitcher stayOnPage/>}</>;}}
  </SettingsDocumentHost>
  <SettingsDocumentHost documentKey="browser-extension-account-return" scopeKey={ownerId} title="Browser account return layout" defaultDocument={BROWSER_EXTENSION_ACCOUNT_FOOTER}>
   {({blocks,chrome,editing,dirty})=>{footerDirty.current=editing||dirty;return <TransientBlockHost scopeKey={`${ownerId}:browser-extension-account-return`} enabled={!editing} actions={actions} scope={{result:{returnStatus}}}><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare/></TransientBlockHost>;}}
  </SettingsDocumentHost>
 </div>;
}
