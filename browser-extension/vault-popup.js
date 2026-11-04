import {scanQrFile,scanQrScreen} from './qr.js';
export function initializePasswordWorkspace(){
 const $=id=>document.getElementById(id),list=$('vault-accounts'),status=$('vault-status'),search=$('vault-search');
 let profile=null,catalogLoading=false;let catalog=[],catalogOwner=null,catalogOrigin=null,origin='',target=null,connected=false,generation=0,shown=50,qr=null,controller=null,dead=false;
 const tell=value=>{status.textContent=value;};
 const matching=entry=>{try{return entry.domains?.some(d=>d.toLowerCase()===new URL(origin).hostname.toLowerCase());}catch{return false;}};
 function clearAccount(){generation++;catalogLoading=false;clearQr();connected=false;catalog=[];catalogOwner=null;catalogOrigin=null;target=null;profile=null;render();}
 async function discoverAccount(){
  const current=++generation;
  try{
   const result=await chrome.runtime.sendMessage({action:'accounts-discover'});if(dead||generation!==current)return;
   const next=result?.ok?result:null;if(catalogOwner!==next?.ownerId||catalogOrigin!==next?.origin){catalog=[];connected=false;target=null;catalogOwner=null;catalogOrigin=null;}profile=next;const active=profile?.accounts?.find(a=>a.active);
   if(!active){catalog=[];connected=false;target=null;}
   $('thingtime-account-heading').textContent=active?.displayName||active?.username||'Sign in to Thingtime';
   $('thingtime-account-detail').textContent=active?`@${active.username} · ${profile.accounts.length} signed-in account${profile.accounts.length===1?'':'s'}`:'Use an account already signed in to this browser.';
   $('thingtime-account-open').textContent=profile?.locked?'Unlock':active?'Switch account':'Sign in';
   $('thingtime-account-status').textContent=profile?.locked?'Connection locked. Unlock to reconnect.':active?'Signed in on the selected Thingtime origin. Passwords remain in Thingtime.':'Open Thingtime to sign in. No account popup opens automatically.';
   if(!active)return;
   catalogLoading=true;tell('Loading your saved accounts. Passwords remain in Thingtime.');render();
   const loaded=await chrome.runtime.sendMessage({action:'accounts-catalog'});if(dead||generation!==current)return;
   if(!loaded?.ok||loaded.ownerId!==active.id){tell('Saved accounts could not be loaded. Choose Refresh passwords to retry.');return;}
   catalog=loaded.catalog||[];catalogOwner=loaded.ownerId;catalogOrigin=loaded.origin;connected=true;
   const cached=await chrome.runtime.sendMessage({action:'vault-cached'});if(dead||generation!==current)return;
   target=cached?.target||null;origin=cached?.origin||'';$('vault-site').textContent=origin||'Select a website with the toolbar to autofill';
   tell('Matching accounts appear first. Passwords remain in Thingtime.');
  }catch{if(!dead&&generation===current)tell('Saved accounts are unavailable. Choose Refresh passwords to retry.');}
  finally{if(!dead&&generation===current){catalogLoading=false;render();}}
 }
 for(const id of ['thingtime-account-open','thingtime-account-add'])$(id).addEventListener('click',async()=>{if(profile?.locked){clearAccount();const result=await chrome.runtime.sendMessage({action:'accounts-unlock'});if(result?.ownerId)await discoverAccount();else await chrome.runtime.sendMessage({action:'accounts-open'});}else{clearAccount();await chrome.runtime.sendMessage({action:'accounts-open'});}});
 $('thingtime-account-lock').addEventListener('click',async()=>{clearAccount();await chrome.runtime.sendMessage({action:'accounts-lock'});$('thingtime-account-status').textContent='Connection locked. Unlock to reconnect.';});
 function render(){
  $('vault-connect').textContent=profile?.locked?'Unlock':profile?.ownerId?'Refresh passwords':'Sign in';$('vault-connect').disabled=false;
  const query=search.value.trim().toLocaleLowerCase();const values=catalog.filter(e=>!query||`${e.title}\n${e.username}\n${(e.domains||[]).join(' ')}`.toLocaleLowerCase().includes(query)).sort((a,b)=>Number(matching(b))-Number(matching(a))||a.title.localeCompare(b.title));
  list.replaceChildren();$('vault-count').textContent=catalogLoading&&!catalog.length?'Loading saved accounts…':`${values.length} saved account${values.length===1?'':'s'}`;
  for(const entry of values.slice(0,shown)){
   const boundTarget=target;const card=document.createElement('article');card.className='vault-account';const copy=document.createElement('div');const title=document.createElement('h3');title.textContent=entry.title||'Saved account';const username=document.createElement('p');username.className='vault-username';username.textContent=entry.username||'No saved email or username';const site=document.createElement('p');site.className='hint';site.textContent=matching(entry)?'Matches this website':(entry.domains||[]).join(', ')||'No saved website';copy.append(title,username,site);const button=document.createElement('button');button.type='button';button.textContent='Autofill';button.disabled=!matching(entry);if(button.disabled)button.title='This account is saved for another website.';
   button.addEventListener('click',async()=>{const current=++generation;button.disabled=true;tell('Complete any required verification in the Thingtime popup.');try{const result=await chrome.runtime.sendMessage({action:'vault-fill',entryId:entry.id,target:boundTarget});if(current!==generation||dead)return;tell(result?.ok?'Filled the selected account. The form was not submitted.':result?.error||'Autofill did not complete.');}catch{if(current===generation)tell('The vault connection ended. Reconnect and retry.');}finally{if(current===generation)render();}});card.append(copy,button);list.append(card);
  }
  if(!values.length){const p=document.createElement('p');p.className='hint';p.textContent=catalog.length?'No accounts match this search.':catalogLoading?'Loading your saved accounts…':profile?.ownerId?'No saved password accounts in this vault.':'Sign in to Thingtime to see saved accounts here.';list.append(p);}
  $('vault-more').hidden=shown>=values.length;
 }
 async function load(refresh=false){const current=++generation;$('vault-connect').disabled=true;try{const result=await chrome.runtime.sendMessage({action:refresh?'vault-catalog':'vault-cached'});if(current!==generation||dead)return;if(!result?.ok){tell(result?.error||'Reconnect to Thingtime.');catalog=[];render();return;}connected=result.connected===true;catalog=profile?.ownerId&&result.ownerId===profile.ownerId?Array.isArray(result.catalog)?result.catalog:[]:[];catalogOwner=result.ownerId||null;catalogOrigin=profile?.origin||null;target=result.target||null;origin=result.origin||'';$('vault-site').textContent=origin||'Select a website with the toolbar';tell(catalog.length?'Matching accounts appear first. Search also finds accounts saved for other sites.':'Open your vault to load its redacted account list. Passwords stay out of this workspace.');render();}catch{if(current===generation)tell('The vault connection is unavailable. Try Connect vault.');}finally{if(current===generation)$('vault-connect').disabled=false;}}
 $('vault-connect').addEventListener('click',async()=>{if(profile?.locked){await chrome.runtime.sendMessage({action:'accounts-unlock'});await discoverAccount();}else if(profile?.ownerId)await discoverAccount();else await chrome.runtime.sendMessage({action:'accounts-open'});});$('vault-refresh').addEventListener('click',()=>void discoverAccount());search.addEventListener('input',()=>{shown=50;render();});$('vault-more').addEventListener('click',()=>{shown+=50;render();});$('vault-lock').addEventListener('click',async()=>{clearAccount();await chrome.runtime.sendMessage({action:'accounts-lock'});tell('Browser vault connection locked.');});
 function clearQr(){qr=null;controller?.abort();controller=null;$('qr-save').hidden=true;$('qr-cancel').hidden=true;$('qr-status').textContent='';}
 async function decode(work){clearQr();const current=++generation;const active=controller=new AbortController();$('qr-status').textContent='Choose the screen or image containing your authenticator setup QR code.';try{const value=await work(active.signal);if(active.signal.aborted||current!==generation||dead)return;qr=value;const u=new URL(value);$('qr-status').textContent=`Authenticator setup found: ${u.searchParams.get('issuer')||decodeURIComponent(u.pathname.slice(1))||'TOTP'}. Review it in Thingtime before saving.`;$('qr-save').hidden=false;$('qr-cancel').hidden=false;}catch(error){if(!active.signal.aborted&&current===generation&&!dead)$('qr-status').textContent=error.message;}finally{if(controller===active)controller=null;}}
 $('qr-upload-button').addEventListener('click',()=>$('qr-file').click());
 $('qr-screen').addEventListener('click',()=>void decode(signal=>scanQrScreen(signal)));$('qr-file').addEventListener('change',event=>{const file=event.target.files?.[0];event.target.value='';if(file)void decode(signal=>scanQrFile(file,signal));});$('qr-cancel').addEventListener('click',clearQr);
 $('qr-save').addEventListener('click',async()=>{if(!qr)return;const value=qr;qr=null;$('qr-save').hidden=true;try{const result=await chrome.runtime.sendMessage({action:'vault-import-totp',totp:value});if(!dead)$('qr-status').textContent=result?.ok?'Authenticator saved in Thingtime.':result?.error||'The import did not finish.';}catch{if(!dead)$('qr-status').textContent='Reconnect to Thingtime and scan again.';}finally{if(!dead)$('qr-cancel').hidden=true;}});
 chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='session')return;const closed=changes.vaultRouting&&(changes.vaultRouting.newValue||[]).length<(changes.vaultRouting.oldValue||[]).length;if(changes.accountEpoch){clearAccount();void discoverAccount();return;}if(changes.workspaceTarget||closed){generation++;catalogLoading=false;clearQr();connected=false;catalog=[];target=null;if(changes.workspaceTarget)origin='';render();tell('The website or vault connection changed. Reconnect its account list.');void load(false);}});
 window.addEventListener('pagehide',()=>{dead=true;generation++;clearQr();catalog=[];void chrome.runtime.sendMessage({action:'vault-lock'}).catch(()=>{});},{once:true});
 window.addEventListener('focus',()=>{if(!controller)void discoverAccount();});
 void load();void discoverAccount();
}
