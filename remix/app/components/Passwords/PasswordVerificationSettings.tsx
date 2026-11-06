import React from 'react';
import {readLocalCache,writeLocalCache} from '~/hooks/localCache';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import { passwordVerificationRequest } from '~/passwords/client';
import { VERIFICATION_WINDOWS, entryVerificationWindow, type EntryVerificationWindow, type VerificationContext } from '~/passwords/verificationPolicy';

export const verificationOptions = (global = false) => [...(global ? [{id:'global',label:'Use global setting'}] : []), ...VERIFICATION_WINDOWS.map(([id,label]) => ({id,label}))];
const element = (id: string, tag: string, text = '', props = {}, children?: WebpageBlock[]): WebpageBlock => ({id:`pv-${id}`,type:'element',tag,text,props,children,css:{'min-width':'0','overflow-wrap':'anywhere','line-height':'1.5',...(tag === 'section' ? {display:'flex','flex-direction':'column',gap:'10px',padding:'16px',border:'1px solid var(--tt-border, #ddd)','border-radius':'12px'} : {}),...(['select','button'].includes(tag) ? {font:'inherit',padding:'10px','min-height':'44px',border:'1px solid var(--tt-border, #ddd)','border-radius':'8px',background:'var(--tt-card, white)',color:'inherit'} : {})}} as WebpageBlock);
export const PASSWORD_VERIFICATION_SETTINGS_BLOCKS: WebpageBlock[] = [element('section','section','',{'aria-label':'Password confirmation preferences'},[
  element('title','h2','{result.title}'),
  {id:'pv-reuse-toggle',type:'condition',condition:{arg:'result.global',equals:true},children:[element('reuse-label','label','',{},[element('reuse','input','',{type:'checkbox',name:'reuse',checked:'{result.reuseRecentDeviceVerification}','data-tt-action':'$transient','data-tt-action-inputs':{operation:'verification.reuse'},'aria-label':'Reuse recent device verification'}),element('reuse-text','span','Reuse recent device verification')])]} as WebpageBlock,
  element('label','label',"Don’t ask for my Thingtime password for",{htmlFor:'{result.controlId}'}),
  element('window','select','',{id:'{result.controlId}',name:'window',value:'{result.window}','data-tt-action':'$transient','data-tt-action-inputs':{operation:'verification.window'},'aria-label':'Password confirmation interval',disabled:'{result.busy}'},[
    {id:'pv-options',type:'collection',props:{itemsPath:'result.options',size:'all',transparent:true},children:[element('option','option','{item.label}',{value:'{item.id}'})]} as unknown as WebpageBlock,
  ]),
  element('help','p','{result.help}'),
  element('save','button','{result.saveLabel}',{type:'button',disabled:'{result.busy}','data-tt-action':'$transient','data-tt-action-inputs':{operation:'verification.save'}}),
  {id:'pv-global-actions',type:'condition',condition:{arg:'result.global',equals:true},children:[
    element('lock','button','Clear values and end current approvals',{type:'button',disabled:'{result.busy}','data-tt-action':'$transient','data-tt-action-inputs':{operation:'verification.lock'}}),
    element('forget','button','Forget this device / require password again',{type:'button',disabled:'{result.busy}','data-tt-action':'$transient','data-tt-action-inputs':{operation:'verification.forget'}}),
  ]} as WebpageBlock,
  element('status','p','{result.status}',{role:'status'}),
])];
/** The same editable control serves the manager default and the entry draft.
 * Saving a preference never enrolls device trust. Only current verification does. */
type PasswordVerificationSettingsProps={ownerId:string;entryWindow?:EntryVerificationWindow;onEntryChange?:(value:EntryVerificationWindow)=>void;context?:VerificationContext};
export function PasswordVerificationSettings(props:PasswordVerificationSettingsProps){
  const {ownerId,context,onEntryChange}=props;
  const identity=JSON.stringify([window.location.origin,ownerId,!!onEntryChange,context?.purpose,context?.rp,context?.entryId,context?.origin,context?.requestHash]);
  return <PasswordVerificationSettingsScope key={identity} {...props}/>;
}
function PasswordVerificationSettingsScope({ownerId,entryWindow,onEntryChange,context}:PasswordVerificationSettingsProps) {
  const entry = !!onEntryChange || !!context?.entryId;
  const isDraft=!!onEntryChange,hasContext=!!context;
  const purpose=context?.purpose,rp=context?.rp,entryId=context?.entryId,origin=context?.origin,requestHash=context?.requestHash;
  const persistedContext=React.useMemo(()=>hasContext?{purpose:purpose!,rp:rp!,...(entryId?{entryId}:{}),...(origin?{origin}:{}),...(requestHash?{requestHash}:{})}:undefined,[hasContext,purpose,rp,entryId,origin,requestHash]);
  type Settings = {window:EntryVerificationWindow;revision:string|null;reuseRecentDeviceVerification?:boolean};
  const cacheKey=`tt-password-verification-settings:${JSON.stringify([window.location.origin,ownerId])}`;
  const [settings,setSettings] = React.useState<Settings>(()=>entry?{window:entryWindow??'global',revision:null}:(readLocalCache<Settings>(cacheKey) || {window:'5m',revision:null,reuseRecentDeviceVerification:true}));
  const [selection,setSelection]=React.useState<Settings>(settings);
  const [ready,setReady]=React.useState(!!onEntryChange||(!entry&&!!readLocalCache(cacheKey)));
  const edited=React.useRef(false),readyRef=React.useRef(ready);readyRef.current=ready;
  const [status,setStatus] = React.useState(''), [busy,setBusy] = React.useState(false);
  const controller = React.useRef(new AbortController()), saving=React.useRef(false), generation=React.useRef(0);
  const remember=(value:Settings)=>{setSettings(value);setSelection(value);edited.current=false;if(!entry)writeLocalCache(cacheKey,value);};
  React.useEffect(() => {
    const active = new AbortController(),lifetimeFence=generation; controller.current = active;
    const load=()=>{if(isDraft||saving.current)return;const version=++generation.current;
      void passwordVerificationRequest(ownerId,persistedContext?.entryId?{operation:'verification-status',context:persistedContext}:{operation:'verification-settings'},active.signal).then(value=>{
        if(active.signal.aborted||version!==generation.current||saving.current)return;
        const next=persistedContext?.entryId?{window:value.entryWindow??'global',revision:null}:value.settings;
        if(!edited.current||!readyRef.current)setSettings(next);if(!edited.current)setSelection(next);setReady(true);if(!entry)writeLocalCache(cacheKey,next);
      }).catch(error=>{if(!active.signal.aborted&&version===generation.current)setStatus(error.message);});
    };
    load(); window.addEventListener('focus',load);window.addEventListener('thingtime:password-verification-changed',load);
    return()=>{active.abort();lifetimeFence.current++;window.removeEventListener('focus',load);window.removeEventListener('thingtime:password-verification-changed',load);};
  },[ownerId,entry,isDraft,cacheKey,persistedContext]);
  const lifecycle=async(operation:'verification-lock'|'verification-forget')=>{
    if(saving.current)return;const active=controller.current,version=++generation.current;
    const current=()=>active===controller.current&&version===generation.current&&!active.signal.aborted;
    if(!current())return;saving.current=true;setBusy(true);
    try{
      await passwordVerificationRequest(ownerId,{operation},active.signal);
      if(!current())return;
      window.dispatchEvent(new Event('thingtime:hide-vault-values'));
      setStatus(operation==='verification-lock'?'Current approvals ended and visible values cleared. Never device trust is preserved.':'Device forgotten for this account. The next approval requires your password.');
    }catch(error){if(current())setStatus(error instanceof Error?error.message:'The operation could not finish.');}
    finally{if(current()){saving.current=false;setBusy(false);}}
  };
  return <SettingsDocumentHost documentKey={entry?'password-entry-verification':'password-verification-default'} title="Password confirmation layout" defaultDocument={PASSWORD_VERIFICATION_SETTINGS_BLOCKS} scopeKey={`${ownerId}:${context?.entryId??(entry?'entry':'global')}`} layoutEditingDisabled={busy}>
    {({blocks,chrome,editing})=><TransientBlockHost scopeKey={`${ownerId}:${context?.entryId??(entry?'entry':'global')}`} enabled={!editing} actions={{
      'verification.window':({value})=>{edited.current=true;setSelection(previous=>({...previous,window:entryVerificationWindow(value)}));},
      'verification.reuse':({value})=>{edited.current=true;setSelection(previous=>({...previous,reuseRecentDeviceVerification:value===true}));},
      'verification.save':async invocation=>{
        if(saving.current||!ready)return;const active=controller.current,version=++generation.current;
        const current=()=>active===controller.current&&version===generation.current&&!active.signal.aborted&&!invocation.signal.aborted;
        if(!current())return;saving.current=true;setBusy(true);setStatus('');
        try{
          const chosenWindow=entryVerificationWindow(invocation.readField('window'));
          if(onEntryChange){onEntryChange(chosenWindow);remember({...settings,window:chosenWindow});setStatus('Applied to this draft. Save the entry to keep this choice.');}
          else{
            const result=await passwordVerificationRequest(ownerId,{operation:'verification-settings',window:chosenWindow,...(context?.entryId?{id:context.entryId}:{revision:settings.revision,reuseRecentDeviceVerification:invocation.readField('reuse')===true})},active.signal);
            if(!current())return;
            remember(context?.entryId?{window:chosenWindow,revision:null}:result.settings);
            window.dispatchEvent(new Event('thingtime:password-verification-changed'));
            setStatus('Preference saved. Only a successful current password approval can enroll this device.');
          }
        }catch(error){if(current())setStatus(error instanceof Error?error.message:'The preference could not be saved.');}
        finally{if(current()){saving.current=false;setBusy(false);}}
      },
      'verification.lock':()=>lifecycle('verification-lock'),
      'verification.forget':()=>lifecycle('verification-forget'),
    }} scope={{result:{controlId:`password-verification-window-${entry?'entry':'global'}`,title:entry?'This entry’s password confirmation':'Password confirmation',window:selection.window,options:verificationOptions(entry),global:!entry,reuseRecentDeviceVerification:selection.reuseRecentDeviceVerification!==false,busy:busy||!ready,status,saveLabel:onEntryChange?'Apply to entry':'Save preference',help:entry?'Use global follows the manager default. An entry override applies to passkey and autofill approvals when reuse is on. Opening existing entries still uses your signed-in session.':'Skip repeated Thingtime password confirmations for the selected time. Never remembers this device after one password check, including future sign-ins. Turning reuse off asks every time. Websites and macOS may still require device verification.'}}}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
    </TransientBlockHost>}
  </SettingsDocumentHost>;
}
