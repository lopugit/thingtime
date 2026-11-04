import {BrowserExtensionAccounts} from './BrowserExtensionAccounts';
import React from 'react';
import {Box,Spinner,Text,VisuallyHidden} from '@chakra-ui/react';
import {Link} from 'react-router';
import {useCurrentUser} from '~/hooks/useCurrentUser';
import {passwordRequest} from '~/passwords/client';
import {parseTotp} from '~/passwords/totp';
import {validateVaultRequest,loadPasswordCatalog,fillVerification,runPasswordFill,fillContext,validateNativeApprovalRequest,nativeApprovalDetails,verifyNativeApproval,type NativeApprovalRequest,type VaultRequest} from '~/passwords/browserPasswordFill';
import {SettingsDocumentHost} from '../Settings/SettingsDocumentHost';
import {TransientBlockHost} from '../Builder/TransientBlockHost';
import type {TransientBlockActions} from '../Builder/transientBlockActions';
import {WebpageBlocksRenderer} from '../Builder/WebpageBlocksRenderer';
import {PasswordVerificationSettings} from './PasswordVerificationSettings';
import {PasswordBrandMark} from './PasswordBrandMark';
import {BROWSER_PASSWORD_FILL_BLOCKS} from './browserPasswordFillBlocks';
const emit=(name:string,value:Record<string,unknown>)=>document.dispatchEvent(new CustomEvent(`thingtime:password-vault-${name}`,{detail:JSON.stringify({version:1,...value})}));
type ApprovalBridge={
 passwordApprovalReady:(ownerId:string)=>Promise<unknown>;
 passwordApprovalRespond:(response:{id:string;ownerId:string}&({cancelled:true}|{proof:Awaited<ReturnType<typeof verifyNativeApproval>>}))=>Promise<void>;
};
function nativeApprovalBridge():ApprovalBridge|undefined {
 const bridge=(window as unknown as {thingtimeDesktop?:Partial<ApprovalBridge>}).thingtimeDesktop;
 return typeof bridge?.passwordApprovalReady==='function'&&typeof bridge.passwordApprovalRespond==='function'?bridge as ApprovalBridge:undefined;
}
export function BrowserPasswordFillProvider(){
 const user=useCurrentUser(),bridge=nativeApprovalBridge();
 React.useEffect(()=>{const previous=document.title;document.title='Thingtime';return()=>{document.title=previous;};},[]);
 return <Box maxW="640px" mx="auto" px={4} py={8}>{bridge?(user&&!user.temporary?<NativeSession key={user.id} ownerId={user.id} vaultAccount={user.username||user.id} bridge={bridge}/>:<Text role="status">Open Thingtime on the intended vault account to approve this request.</Text>):user&&!user.temporary?<Session key={user.id} ownerId={user.id}/>:<BrowserExtensionAccounts/>}</Box>;
}

function ApprovalLayout({root,scopeKey,busy,actions,result,children}:{root:React.RefObject<HTMLDivElement|null>;scopeKey:string;busy:boolean;actions:TransientBlockActions;result:Record<string,unknown>;children?:React.ReactNode}){
 return <div ref={root}><SettingsDocumentHost documentKey="browser-password-fill" title="Password approval layout" defaultDocument={BROWSER_PASSWORD_FILL_BLOCKS} scopeKey={scopeKey} layoutEditingDisabled={busy}>{({blocks,chrome,editing})=><TransientBlockHost scopeKey={scopeKey} enabled={!editing} actions={actions} scope={{result}}><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare/></TransientBlockHost>}</SettingsDocumentHost>{children}</div>;
}

function NativeSession({ownerId,vaultAccount,bridge}:{ownerId:string;vaultAccount:string;bridge:ApprovalBridge}){
 const root=React.useRef<HTMLDivElement>(null);
 const live=React.useRef<{request:NativeApprovalRequest;controller:AbortController;busy:boolean}|null>(null);
 const [request,setRequest]=React.useState<NativeApprovalRequest|null>(null);
 const [account,setAccount]=React.useState(''),[required,setRequired]=React.useState(true);
 const [busy,setBusy]=React.useState(true),[error,setError]=React.useState('');
 const clear=React.useCallback(()=>{const input=root.current?.querySelector<HTMLInputElement>('input[name=password]');if(input)input.value='';},[]);
 React.useEffect(()=>{
  const controller=new AbortController();
  const load=async()=>{
   try{
    const pending=validateNativeApprovalRequest(await bridge.passwordApprovalReady(ownerId),ownerId);
    controller.signal.throwIfAborted();
    const details=await nativeApprovalDetails(ownerId,pending,controller.signal);
    controller.signal.throwIfAborted();
    live.current={request:pending,controller,busy:false};
    setAccount(details.account);setRequired(details.required);setRequest(pending);setBusy(false);
   }catch{if(!controller.signal.aborted)setError('This approval is unavailable. Close this window and start a new request.');}
  };
  void load();
  window.addEventListener('blur',clear);
  return()=>{controller.abort();live.current=null;clear();window.removeEventListener('blur',clear);};
 },[bridge,clear,ownerId]);

 const approve=async()=>{
  const operation=live.current;
  if(!operation||operation.busy||!navigator.userActivation?.isActive)return;
  let password=root.current?.querySelector<HTMLInputElement>('input[name=password]')?.value||'';
  if(required&&!password){setError('Enter your current Thingtime account password.');return;}
  operation.busy=true;setBusy(true);setError('');clear();
  try{
   const proof=await verifyNativeApproval(ownerId,operation.request,password,operation.controller.signal);
   password='';
   if(live.current===operation)await bridge.passwordApprovalRespond({id:operation.request.id,ownerId,proof});
  }catch{
   if(live.current===operation){setRequired(true);setError('Verification did not complete. Check your account password and try again.');}
  }finally{password='';operation.busy=false;if(live.current===operation)setBusy(false);}
 };
 const cancel=async()=>{
  const operation=live.current;
  if(!operation)return;
  live.current=null;operation.controller.abort();clear();setBusy(true);
  try{await bridge.passwordApprovalRespond({id:operation.request.id,ownerId,cancelled:true});}
  catch{setError('This approval has ended. Close this window.');}
 };
 if(!request)return <Text role={error?'alert':'status'}>{error||'Checking the selected account and its confirmation settings…'}</Text>;
 const website=request.type==='fill';
 return <ApprovalLayout root={root} scopeKey={`${ownerId}:${request.id}`} busy={busy} actions={{'vault.approve':approve,'vault.cancel':cancel}} result={{
  title:website?'Autofill with Thingtime':'Unlock the GNOME login keyring',origin:website?request.origin:'GNOME login keyring',account:`${account} · Vault account ${vaultAccount} on ${new URL(request.apiOrigin).host}`,required,busy,error,hasError:!!error,canPreferences:false,importing:false,
  privacy:website?'Thingtime fills the selected login in the task browser without submitting the form.':'Thingtime sends the selected password directly to the GNOME login keyring.',
  approveLabel:website?(required?'Verify and autofill':'Autofill'):'Verify and unlock',
 }}/>;
}

function Session({ownerId}:{ownerId:string}){
 const [request,setRequest]=React.useState<VaultRequest|null>(null),[preferencesOpen,setPreferencesOpen]=React.useState(false),[required,setRequired]=React.useState(true),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[selectedAccount,setSelectedAccount]=React.useState(''),[status,setStatus]=React.useState('Connect from your Thingtime browser password workspace.');
 const root=React.useRef<HTMLDivElement>(null);const live=React.useRef<{request:VaultRequest;controller:AbortController;busy:boolean;saveId:string;writeId:string;policyGeneration:number}|null>(null);
 const clear=()=>root.current?.querySelectorAll<HTMLInputElement>('input[type=password]').forEach(input=>{input.value='';});
 const finish=React.useCallback((payload:Record<string,unknown>|null,message:string)=>{const op=live.current;if(!op)return;live.current=null;op.controller.abort();clear();setBusy(false);setRequest(null);setStatus(message);if(payload)emit('response',{id:op.request.id,ownerId,...payload});},[ownerId]);
 const approve=React.useCallback(async()=>{const op=live.current;if(!op||op.busy)return;op.busy=true;setBusy(true);setError('');let password=root.current?.querySelector<HTMLInputElement>('input[name=password]')?.value||'';try{
  if(op.request.type==='fill'){const values=await runPasswordFill(ownerId,op.request,password,op.controller.signal);password='';clear();if(live.current!==op)return;finish({values},'Account approved for autofill. Check the original website for the fill result.');values.username='';values.password='';}
  else if(op.request.type==='totp-import'){const config=parseTotp(op.request.totp!);const title=root.current?.querySelector<HTMLInputElement>('input[name=title]')?.value||config.issuer||'Authenticator';const website=root.current?.querySelector<HTMLInputElement>('input[name=website]')?.value||'';if(website){const url=new URL(website);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('Use a website URL.');}const result=await passwordRequest(ownerId,{operation:'save',id:op.saveId,writeId:op.writeId,revision:0,entry:{title,passwordType:'login',fields:[{id:'username',label:'Username',type:'text',value:config.account},{id:'website',label:'Website',type:'url',value:website},{id:'totp',label:'Verification code',type:'totp',value:op.request.totp}]}},op.controller.signal);if(live.current!==op)return;if(result.record?.id!==op.saveId)throw Error('The authenticator save could not be confirmed.');finish({saved:true},'Authenticator saved in Thingtime.');}
 }catch{if(live.current===op)setError('The request could not complete. Check your connection or verification and try again.');}finally{password='';op.busy=false;if(live.current===op)setBusy(false);}},[finish,ownerId]);
 React.useEffect(()=>{
 const ready=()=>emit('ready',{});
 const cancel=(event:Event)=>{
  const op=live.current;if(op?.request.type!=='catalog')return;
  let input;
  try{input=JSON.parse((event as CustomEvent).detail);}catch{return;}
  if(input?.version!==1||input.id!==op.request.id)return;
  event.preventDefault();
  finish(null,'Ready for your next password request.');
 };
 const receive=async(event:Event)=>{
  if(live.current)return;
  let op:NonNullable<typeof live.current>|null=null;
  try{
   const input=JSON.parse((event as CustomEvent).detail),r=validateVaultRequest(input);
   if(input.expectedOwnerId&&input.expectedOwnerId!==ownerId){emit('response',{id:r.id,ownerId,error:{name:'NotAllowedError'}});return;}
   const operation={request:r,controller:new AbortController(),busy:false,saveId:crypto.randomUUID(),writeId:crypto.randomUUID(),policyGeneration:0};
   op=operation;live.current=operation;setRequest(r);setPreferencesOpen(false);setError('');setRequired(true);setSelectedAccount('');
   if(Number.isSafeInteger(r.presentation?.fontSize)&&r.presentation!.fontSize>0)document.documentElement.style.fontSize=`${r.presentation!.fontSize}px`;
   if(r.type==='catalog'){
    operation.busy=true;setBusy(true);
    const catalog=await loadPasswordCatalog(ownerId,r,operation.controller.signal);
    if(live.current===operation)finish({catalog},'Your browser password workspace is connected. Close this window to lock its cached account list.');
   }else if(r.type==='fill'){
    operation.busy=true;setBusy(true);
    const [selected]=await loadPasswordCatalog(ownerId,r,operation.controller.signal);
    if(live.current!==operation)return;
    if(!selected)throw Error('Choose an available saved account.');
    setSelectedAccount([selected.title,selected.username].filter(Boolean).join(' · '));
    const version=++operation.policyGeneration;
    const policy=await fillVerification(ownerId,r,operation.controller.signal);
    if(live.current!==operation||operation.policyGeneration!==version)return;
    operation.busy=false;setBusy(false);
    setRequired(policy.required!==false);if(policy.required===false)void approve();
   }else{parseTotp(r.totp!);setRequired(false);}
  }catch(reason){
   if(!op||live.current!==op)return;
   const status=typeof reason==='object'&&reason!==null&&'status' in reason?reason.status:undefined;
   const retryable=op.request.type==='catalog'&&(reason instanceof TypeError||reason instanceof DOMException&&reason.name==='TimeoutError'||status===429||typeof status==='number'&&status>=500);
   finish({error:{name:retryable?'NetworkError':'NotAllowedError'}},retryable?'Saved accounts could not be refreshed. Try again from the browser workspace.':'Reconnect from the browser password workspace.');
  }
 };
 const refreshPolicy=async()=>{const op=live.current;if(!op||op.request.type!=='fill'||op.busy)return;const version=++op.policyGeneration;try{const policy=await fillVerification(ownerId,op.request,op.controller.signal);if(live.current===op&&version===op.policyGeneration)setRequired(policy.required!==false);}catch{if(live.current===op)setRequired(true);}};
 const lock=()=>finish({error:{name:'AbortError'}},'Vault access was locked. Choose the account again.');
 window.addEventListener('thingtime:password-verification-changed',refreshPolicy);window.addEventListener('thingtime:hide-vault-values',lock);
 document.addEventListener('thingtime:password-vault-init',ready);document.addEventListener('thingtime:password-vault-request',receive);document.addEventListener('thingtime:password-vault-cancel',cancel);window.addEventListener('blur',clear);ready();
 return()=>{window.removeEventListener('thingtime:password-verification-changed',refreshPolicy);window.removeEventListener('thingtime:hide-vault-values',lock);document.removeEventListener('thingtime:password-vault-init',ready);document.removeEventListener('thingtime:password-vault-request',receive);document.removeEventListener('thingtime:password-vault-cancel',cancel);window.removeEventListener('blur',clear);live.current?.controller.abort();live.current=null;clear();emit('invalidate',{});};},[approve,finish,ownerId]);
 if(!request||request.type==='catalog'){
  const loading=request?.type==='catalog'&&busy;
  return <>
   <Box display="flex" gap={3} alignItems="center"><PasswordBrandMark/><Text as="h1" fontSize="2xl">Thingtime password workspace</Text>{loading&&<Spinner size="sm" aria-hidden="true" sx={{'@media (prefers-reduced-motion: reduce)':{animation:'none'}}}/>}</Box>
   <Text my={4} role="status"><span aria-hidden={loading||undefined}>{status}</span>{loading&&<VisuallyHidden>Loading saved accounts</VisuallyHidden>}</Text>
   <button onClick={()=>{void passwordRequest(ownerId,{operation:'verification-lock'}).finally(()=>emit('invalidate',{}));}}>Lock browser connection</button><Text mt={4}><Link to="/passwords">Open password manager</Link></Text>
  </>;
 }
 const importing=request.type==='totp-import';let account=selectedAccount;let defaultTitle='Authenticator';if(importing){const config=parseTotp(request.totp!);account=[config.issuer,config.account].filter(Boolean).join(' · ');defaultTitle=config.issuer||defaultTitle;}
 return <ApprovalLayout root={root} scopeKey={`${ownerId}:${request.id}`} busy={busy} actions={{'vault.preferences':()=>setPreferencesOpen(value=>!value),'vault.approve':approve,'vault.cancel':()=>finish({error:{name:'AbortError'}},'Request cancelled.')}} result={{title:importing?'Save an authenticator in Thingtime':'Autofill with Thingtime',origin:request.origin,account,canPreferences:!importing,preferencesOpen,privacy:importing?'The image was decoded on your device. Only Save stores these settings in your Thingtime vault.':'Only the selected account is filled into the original website. Thingtime never submits the form.',required:required&&!importing,importing,defaultTitle,busy,error,hasError:!!error,approveLabel:importing?'Save authenticator':required?'Verify and autofill':'Autofill'}}>{!importing&&<div id="vault-preferences" hidden={!preferencesOpen}><PasswordVerificationSettings key={`${request.id}:${request.entryId}`} ownerId={ownerId} context={fillContext(request)}/></div>}</ApprovalLayout>;
}
