import {scanQrFile,scanQrScreen} from './qr.js';
import {sameWorkspaceTarget} from './workspace.js';
export function initializePasswordWorkspace(){
 const $=id=>document.getElementById(id),list=$('vault-accounts'),status=$('vault-status'),search=$('vault-search');
 let profile=null,catalog=[],origin='',target=null,shown=50,qr=null,controller=null,dead=false;
 let accountGeneration=0,targetGeneration=0,qrGeneration=0,refreshing=null,filling=null;
 const tell=value=>{status.textContent=value;};
 const matching=entry=>{
  if(!target||!origin)return false;
  if(Array.isArray(entry.origins))return entry.origins.includes(origin);
  // Older first-party bridges only supplied hostnames. Never treat a hostname
  // as permission to offer credentials across a scheme or port boundary.
  try{const site=new URL(origin);return site.protocol==='https:'&&!site.port&&entry.domains?.some(d=>d.toLowerCase()===site.hostname);}catch{return false;}
 };
 function showProfile(){
  const active=profile?.accounts?.find(a=>a.active);
  $('thingtime-account-heading').textContent=active?.displayName||active?.username||(profile?.locked?'Connection locked':'Sign in to Thingtime');
  $('thingtime-account-detail').textContent=active?`@${active.username} · ${profile.accounts.length} signed-in account${profile.accounts.length===1?'':'s'}`:'Use an account already signed in to this browser.';
  $('thingtime-account-open').textContent=profile?.locked?'Unlock':active?'Switch account':'Sign in';
  $('thingtime-account-status').textContent=profile?.locked?'Connection locked. Unlock to reconnect.':active?'Signed in on the selected Thingtime origin. Passwords remain in Thingtime.':'Open Thingtime to sign in. No account popup opens automatically.';
 }
 function clearAccount(next=null){
  accountGeneration++;refreshing=null;filling=null;clearQr();catalog=[];shown=50;search.value='';profile=next;
  tell('');showProfile();render();
 }
 function discoverAccount(){
  if(dead||refreshing)return;
  const current=accountGeneration;
  const activeRequest={};refreshing=activeRequest;tell('');render();
  const valid=()=>!dead&&accountGeneration===current&&refreshing===activeRequest;
  void (async()=>{
   try{
    const result=await chrome.runtime.sendMessage({action:'accounts-discover'});if(!valid())return;
    if(!result?.ok){tell('Saved accounts are unavailable. Choose Refresh to retry.');return;}
    const active=result.accounts?.find(a=>a.active&&a.id===result.ownerId);
    const changed=profile?.ownerId!==result.ownerId||profile?.origin!==result.origin||profile?.locked!==result.locked;
    if(changed||!active){catalog=[];filling=null;clearQr();shown=50;if(profile?.ownerId)search.value='';}
    profile=result;showProfile();render();
    if(!active||result.locked)return;
    const loaded=await chrome.runtime.sendMessage({action:'accounts-catalog'});
    if(!valid())return;
    if(!loaded?.ok){tell('Saved accounts could not be loaded. Choose Refresh to retry.');return;}
    if(loaded.ownerId!==active.id||loaded.origin!==result.origin){clearAccount();return;}
    catalog=Array.isArray(loaded.catalog)?loaded.catalog:[];
   }catch{if(valid())tell('Saved accounts are unavailable. Choose Refresh to retry.');}
   finally{if(valid()){refreshing=null;render();}}
  })();
 }
 async function readTarget(invalidate=false){
  const current=++targetGeneration;
  if(invalidate){target=null;origin='';filling=null;clearQr();render();}
  const result=await chrome.runtime.sendMessage({action:'vault-cached'}).catch(()=>null);
  if(dead||current!==targetGeneration)return;
  const next=result?.ok?result.target||null:null;
  if(!target&&!next||sameWorkspaceTarget(target,next))return;
  target=next;origin=target?.origin||'';filling=null;clearQr();render();
 }
 async function openAccount(){
  if(profile?.locked){await chrome.runtime.sendMessage({action:'accounts-unlock'});discoverAccount();}
  else{clearAccount();await chrome.runtime.sendMessage({action:'accounts-open'});}
 }
 async function lockAccount(){
  clearAccount({locked:true,accounts:[]});
  await chrome.runtime.sendMessage({action:'accounts-lock'});
 }
 for(const id of ['thingtime-account-open','thingtime-account-add'])$(id).addEventListener('click',openAccount);
 for(const id of ['thingtime-account-lock','vault-lock'])$(id).addEventListener('click',lockAccount);
 function render(){
  $('vault-connect').textContent=profile?.locked?'Unlock':profile?.ownerId?'Refresh passwords':'Sign in';
  $('vault-site').textContent=origin||'Select a website with the toolbar to autofill';
  const query=search.value.trim().toLowerCase();
  const values=catalog.filter(e=>!query||[e.title,e.username,...(e.domains||[])].some(value=>value?.toLowerCase().includes(query))).sort((a,b)=>Number(matching(b))-Number(matching(a))||a.title.localeCompare(b.title));
  const progress=$('vault-progress');progress.hidden=!refreshing;
  $('vault-progress-label').textContent=refreshing?(catalog.length?'Refreshing saved accounts':'Loading saved accounts'):'';
  $('vault-count').textContent=refreshing&&!catalog.length?'':`${values.length} saved account${values.length===1?'':'s'}`;
  const focus=document.activeElement;
  const focusedEntry=focus?.dataset?.vaultEntryId;
  const scrollTop=list.scrollTop;
  let restoredFocus=false;
  list.replaceChildren();
  for(const entry of values.slice(0,shown)){
   const boundTarget=target,expectedOwnerId=profile?.ownerId,boundAccount=accountGeneration;
   const card=document.createElement('article');card.className='vault-account';const copy=document.createElement('div');const title=document.createElement('h3');title.textContent=entry.title||'Saved account';const username=document.createElement('p');username.className='vault-username';username.textContent=entry.username||'No saved email or username';const site=document.createElement('p');site.className='hint';site.textContent=matching(entry)?'Matches this website':(entry.domains||[]).join(', ')||'No saved website';copy.append(title,username,site);const button=document.createElement('button');button.type='button';button.textContent='Autofill';button.disabled=!!filling||!matching(entry);if(!matching(entry))button.title='Select a website that matches this saved account.';
   button.dataset.vaultEntryId=entry.id;
   button.addEventListener('click',async()=>{
    if(filling||boundTarget!==target||!expectedOwnerId||expectedOwnerId!==profile?.ownerId||boundAccount!==accountGeneration||!matching(entry))return;
    const operation={};filling=operation;button.disabled=true;tell('Complete any required verification in the Thingtime popup.');
    try{
     const result=await chrome.runtime.sendMessage({action:'vault-fill',entryId:entry.id,target:boundTarget,expectedOwnerId});
     if(filling===operation&&!dead)tell(result?.ok?'Filled the selected account. The form was not submitted.':result?.error||'Autofill did not complete.');
    }catch{if(filling===operation&&!dead)tell('The vault connection ended. Reconnect and retry.');}
    finally{if(filling===operation&&!dead){filling=null;render();}}
   });card.append(copy,button);list.append(card);
   if(focusedEntry===entry.id&&!button.disabled){button.focus({preventScroll:true});restoredFocus=true;}
  }
  if(!values.length&&(!refreshing||catalog.length)&&!status.textContent){
   const p=document.createElement('p');p.className='hint';p.textContent=catalog.length?'No accounts match this search.':profile?.locked?'Unlock to see your saved accounts.':profile?.ownerId?'No saved password accounts in this vault.':'Sign in to Thingtime to see saved accounts here.';list.append(p);
  }
  list.scrollTop=scrollTop;
  if(focusedEntry&&!restoredFocus)search.focus({preventScroll:true});
  $('vault-more').hidden=shown>=values.length;
 }
 $('vault-connect').addEventListener('click',()=>profile?.ownerId?discoverAccount():void openAccount());
 $('vault-refresh').addEventListener('click',discoverAccount);
 search.addEventListener('input',()=>{shown=50;list.scrollTop=0;render();});
 $('vault-more').addEventListener('click',()=>{shown+=50;render();});
 function clearQr(){qrGeneration++;qr=null;controller?.abort();controller=null;$('qr-save').hidden=true;$('qr-cancel').hidden=true;$('qr-status').textContent='';}
 async function decode(work){clearQr();const current=qrGeneration;const active=controller=new AbortController();$('qr-status').textContent='Choose the screen or image containing your authenticator setup QR code.';try{const value=await work(active.signal);if(active.signal.aborted||current!==qrGeneration||dead)return;qr=value;const u=new URL(value);$('qr-status').textContent=`Authenticator setup found: ${u.searchParams.get('issuer')||decodeURIComponent(u.pathname.slice(1))||'TOTP'}. Review it in Thingtime before saving.`;$('qr-save').hidden=false;$('qr-cancel').hidden=false;}catch(error){if(!active.signal.aborted&&current===qrGeneration&&!dead)$('qr-status').textContent=error.message;}finally{if(controller===active)controller=null;}}
 $('qr-upload-button').addEventListener('click',()=>$('qr-file').click());
 $('qr-screen').addEventListener('click',()=>void decode(signal=>scanQrScreen(signal)));$('qr-file').addEventListener('change',event=>{const file=event.target.files?.[0];event.target.value='';if(file)void decode(signal=>scanQrFile(file,signal));});$('qr-cancel').addEventListener('click',clearQr);
 $('qr-save').addEventListener('click',async()=>{if(!qr)return;const value=qr,current=qrGeneration;qr=null;$('qr-save').hidden=true;const valid=()=>!dead&&current===qrGeneration;try{const result=await chrome.runtime.sendMessage({action:'vault-import-totp',totp:value});if(valid())$('qr-status').textContent=result?.ok?'Authenticator saved in Thingtime.':result?.error||'The import did not finish.';}catch{if(valid())$('qr-status').textContent='Reconnect to Thingtime and scan again.';}finally{if(valid())$('qr-cancel').hidden=true;}});
 chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&changes.origin){clearAccount();void readTarget(true);return;}
  if(area!=='session')return;
  if(changes.accountEpoch||changes.accountLocked){
   const locked=changes.accountLocked?.newValue;
   clearAccount(locked===true||locked===undefined&&profile?.locked?{locked:true,accounts:[]}:null);
   if(locked!==true)discoverAccount();
  }
  if(changes.workspaceTarget)void readTarget(true);
 });
 window.addEventListener('pagehide',()=>{dead=true;clearAccount();void chrome.runtime.sendMessage({action:'vault-lock'}).catch(()=>{});},{once:true});
 window.addEventListener('focus',()=>{if(!controller&&!filling){void readTarget();discoverAccount();}});
 void readTarget();discoverAccount();
}
