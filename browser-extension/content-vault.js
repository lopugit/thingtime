(() => {
  'use strict';
  if (window.top !== window) return;
  const dispatch=(name,value)=>document.dispatchEvent(new CustomEvent(name,{detail:JSON.stringify(value)}));
  const detail=event=>{try{return JSON.parse(event.detail);}catch{return null;}};
  let providerActive=null, dead=false, enabled=true, armed=null;
  const host=document.createElement('div'); host.setAttribute('data-thingtime-autofill','');
  const root=host.attachShadow({mode:'open'});
  root.innerHTML='<style>:host{all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646;font:14px system-ui;color:#221e35}button,input{font:inherit}button{cursor:pointer;border:1px solid #d9d0ef;border-radius:12px;background:#faf7ff;color:#322846;padding:7px 10px;box-shadow:0 3px 14px #37254b22;pointer-events:auto}button:focus-visible,input:focus-visible{outline:3px solid #8a63ce;outline-offset:2px}.chip{position:fixed;display:flex;align-items:center;gap:7px;white-space:nowrap}.field{padding:4px;width:28px;height:28px;justify-content:center;box-sizing:border-box}.tree{width:19px;height:19px;image-rendering:pixelated;pointer-events:none}.panel{position:fixed;top:60px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 24px);width:340px;max-height:calc(100vh - 84px);overflow:auto;padding:12px;border:1px solid #d9d0ef;border-radius:18px;background:#fff;box-shadow:0 12px 40px #2e214433;pointer-events:auto;box-sizing:border-box}.panel h2{font-size:16px;margin:0 0 8px}.panel p{margin:6px 0;overflow-wrap:anywhere}.panel button.account{display:block;width:100%;text-align:left;margin-top:8px;box-shadow:none}.account span{display:block;font-size:12px;color:#6a6176}.close{float:right;padding:2px 8px}.status{font-size:12px;color:#6a6176}.panel input{display:block;width:100%;box-sizing:border-box;margin:8px 0;padding:7px 9px;border:1px solid #d9d0ef;border-radius:9px;background:#faf7ff;color:#322846}.panel .account-list{margin:6px 0 10px}.spinner{display:inline-block;vertical-align:middle;width:12px;height:12px;border:2px solid #d9d0ef;border-top-color:#7040ba;border-radius:50%}[hidden]{display:none!important}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}@media(prefers-reduced-motion:no-preference){.spinner{animation:spin .8s linear infinite}}@keyframes spin{to{transform:rotate(360deg)}}</style>';
  const tree=()=>{const i=document.createElement('img');i.className='tree';i.src=chrome.runtime.getURL('thingtime-icon-32.png');i.alt='';i.setAttribute('aria-hidden','true');return i;};
  let panel=null, opener=null, selection=null;
  const chips=new Map();
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return e.isConnected&&!e.disabled&&!e.readOnly&&r.width>80&&r.height>16&&r.bottom>0&&r.top<innerHeight&&s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity)!==0;};
  const autocomplete=e=>(e.getAttribute('autocomplete')||'').toLowerCase().split(/\s+/);
  const eligible=e=>e instanceof HTMLInputElement && visible(e) && !e.matches(':disabled') &&
    !e.closest('[inert],[aria-hidden="true"]') && !autocomplete(e).some(token=>token==='new-password'||token==='one-time-code');
  const usernameType=e=>['email','text','tel'].includes(e.type);
  const username=e=>eligible(e)&&usernameType(e)&&(autocomplete(e).some(token=>token==='username'||token==='email')||e.type==='email'||/email|user|login|account/i.test(`${e.name} ${e.id}`));
  const modalSelector='dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';
  function activeModal(){return [...document.querySelectorAll(modalSelector)].filter(visible).at(-1)||null;}
  const formElements=Object.getOwnPropertyDescriptor(HTMLFormElement.prototype,'elements').get;
  const formAction=Object.getOwnPropertyDescriptor(HTMLFormElement.prototype,'action').get;
  function inspectForm(form,scope){
    if(!form?.isConnected||!scope.contains(form))return null;
    const fields=[...formElements.call(form)].filter(field=>field instanceof HTMLInputElement && field.form===form && scope.contains(field));
    const password=fields.find(e=>eligible(e)&&e.type==='password')||null;
    const user=fields.find(username)||null;
    if(!password&&!user)return null;
    let action;
    try{action=new URL(formAction.call(form),location.href);}catch{return null;}
    if(action.origin!==location.origin||action.username||action.password||!['https:','http:'].includes(action.protocol))return null;
    return {scope,form,password,username:user,action:action.href};
  }
  function inspectStandalone(field,scope){
    if(!eligible(field)||field.form||field.hasAttribute('form')||field.closest('form')||!scope.contains(field))return null;
    const tokens=autocomplete(field);
    const password=field.type==='password'?field:null;
    const user=usernameType(field)&&tokens.includes('username')?field:null;
    if(!password&&!user)return null;
    // A form-less step can fill its selected field only. Its browser
    // document is the destination; no submit target or nearby account is guessed.
    return {scope,form:null,password,username:user,action:location.href};
  }
  function recheck(target){
    if(!target||dead)return null;
    const scope=activeModal()||document;
    if(scope!==target.scope)return null;
    const current=target.form?inspectForm(target.form,scope):inspectStandalone(target.password||target.username,scope);
    return current&&current.username===target.username&&current.password===target.password&&current.action===target.action?current:null;
  }
  function placeHost(){
    // Keep controls in the website's active modal accessibility/focus scope.
    // A manual popover retains viewport positioning above transformed/clipped
    // modal containers without modifying the website's styles or ARIA tree.
    const parent=activeModal()||document.documentElement;
    const popover=typeof host.showPopover==='function';
    if(host.parentElement!==parent){if(popover&&host.matches(':popover-open'))host.hidePopover();parent.append(host);}
    if(popover&&!host.matches(':popover-open'))host.showPopover();
  }
  function candidates(){
    const scope=activeModal()||document;
    return [
      ...[...scope.querySelectorAll('form')].map(form=>inspectForm(form,scope)),
      ...[...scope.querySelectorAll('input[type=password],input[autocomplete]')].map(field=>inspectStandalone(field,scope))
    ].filter(Boolean);
  }
  function clearPanel(){
    if(selection&&armed?.targetId===selection.id)armed=null;
    selection=null;
    panel?.remove();panel=null;
    if(!dead&&opener?.isConnected)opener.focus();
    opener=null;
  }
  let catalogRequest=null;
  function refreshCatalog(backgroundRefresh){
    if(catalogRequest)return catalogRequest;
    const request=chrome.runtime.sendMessage({action:'vault-catalog',backgroundRefresh});
    catalogRequest=request;
    const settled=()=>{if(catalogRequest===request)catalogRequest=null;};
    void request.then(settled,settled);
    return request;
  }
  function matchesWebsite(entry){
    if(!entry.hasPassword)return false;
    if(Array.isArray(entry.origins))return entry.origins.includes(location.origin);
    return location.protocol==='https:'&&!location.port&&entry.domains?.some(domain=>domain.toLowerCase()===location.hostname.toLowerCase());
  }
  async function choose(selected,trigger){
    if(!recheck(selected))return;
    clearPanel();opener=trigger;armed=null;
    const choice={id:crypto.randomUUID(),target:selected};selection=choice;
    const current=panel=document.createElement('section');
    current.className='panel';current.setAttribute('role','dialog');current.setAttribute('aria-label','Choose a Thingtime account');
    const close=document.createElement('button');close.className='close';close.textContent='×';close.setAttribute('aria-label','Close account chooser');close.onclick=clearPanel;
    const title=document.createElement('h2');title.textContent='Choose a saved account';
    const site=document.createElement('p');site.className='status';site.textContent=location.origin;
    const progress=document.createElement('span');progress.setAttribute('role','status');
    const spinner=document.createElement('span');spinner.className='spinner';spinner.setAttribute('aria-hidden','true');
    const progressLabel=document.createElement('span');progressLabel.className='sr-only';progressLabel.textContent='Loading saved accounts';progress.append(spinner,progressLabel);
    const status=document.createElement('p');status.className='status';status.setAttribute('role','status');
    const search=document.createElement('input');search.type='search';search.placeholder='Search saved accounts';search.setAttribute('aria-label','Search saved accounts for this website');search.autocomplete='off';search.hidden=true;
    const rows=document.createElement('div');rows.className='account-list';
    const all=document.createElement('button');all.textContent='Open password workspace';all.addEventListener('click',event=>{if(event.isTrusted)void chrome.runtime.sendMessage({action:'vault-open-workspace'});});
    const retry=document.createElement('button');retry.textContent='Retry';retry.hidden=true;
    current.append(close,title,site,progress,status,search,rows,retry,all);root.append(current);
    current.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();clearPanel();}
      else if(event.key==='Tab'){
        const controls=[...current.querySelectorAll('button:not(:disabled):not([hidden]),input:not(:disabled):not([hidden])')];
        const first=controls[0],last=controls.at(-1);
        if(event.shiftKey&&root.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&root.activeElement===last){event.preventDefault();first.focus();}
      }
    });
    close.focus();
    let entries=[],ownerId=null,sessionId=null,identityVersion=0,refreshing=false,filling=false,failed=false;
    const invalidatedSessions=new Set();
    const valid=()=>panel===current&&!dead&&!!recheck(choice.target);
    const reset=()=>{ownerId=null;sessionId=null;entries=[];armed=null;refreshing=false;catalogRequest=null;identityVersion++;};
    choice.invalidate=id=>{
      if(typeof id!=='string')return;
      invalidatedSessions.add(id);
      if(sessionId!==id)return;
      reset();filling=false;failed=true;paint();
    };
    function paint(){
      const query=search.value.trim().toLowerCase();
      const list=entries.filter(e=>!query||[e.title,e.username,...(e.domains||[])].some(value=>value?.toLowerCase().includes(query)));
      const focusedEntry=root.activeElement?.dataset.entryId;
      rows.replaceChildren();search.hidden=!entries.length;progress.hidden=!refreshing;
      const retryFocused=root.activeElement===retry;
      retry.hidden=!failed||refreshing||filling;
      if(retryFocused&&retry.hidden)(search.hidden?close:search).focus();
      if(!filling)status.textContent=failed?'Saved accounts could not refresh.':list.length?'Choose an account, then submit on the website.':entries.length?'No accounts match this search.':refreshing?'':'No account is saved for this website. Search all accounts in the Thingtime workspace.';
      for(const entry of list){
        const b=document.createElement('button');b.className='account';b.dataset.entryId=entry.id;b.disabled=filling;
        const name=document.createElement('strong');name.textContent=entry.title||'Saved account';
        const sub=document.createElement('span');sub.textContent=entry.username||'No saved username';b.append(name,sub);
        b.addEventListener('click',async event=>{
          if(!event.isTrusted||filling)return;
          const expectedOwnerId=ownerId,currentIdentity=identityVersion;
          if(!expectedOwnerId)return;
          filling=true;paint();status.textContent='Complete any required verification in Thingtime.';
          try{
            const filled=await chrome.runtime.sendMessage({action:'vault-fill',entryId:entry.id,targetId:choice.id,expectedOwnerId});
            if(!valid()||currentIdentity!==identityVersion)return;
            if(filled?.ok){clearPanel();return;}
            if(filled?.connectionEnded){reset();failed=true;}
            filling=false;paint();status.textContent=filled?.error||'Autofill did not complete. Try again.';
          }catch{if(valid()&&currentIdentity===identityVersion){reset();refreshing=false;filling=false;failed=true;paint();status.textContent='Autofill did not complete. Try again.';}}
        });
        rows.append(b);if(focusedEntry===entry.id&&!b.disabled)b.focus();
      }
    }
    search.addEventListener('input',paint);
    async function refresh(){
      if(refreshing||filling)return;
      const currentIdentity=identityVersion;
      refreshing=true;failed=false;paint();
      try{
        // Only the worker can classify a failure as retryable after checking
        // the current provider document and the owner of the cached catalog.
        const result=await refreshCatalog(ownerId!==null);
        if(!valid()||currentIdentity!==identityVersion)return;
        if(result?.superseded)return;
        if(result?.ok&&!invalidatedSessions.has(result.sessionId)&&typeof result.ownerId==='string'&&(!ownerId||ownerId===result.ownerId)){
          ownerId=result.ownerId;
          sessionId=result.sessionId||null;
          entries=(result.catalog||[]).filter(matchesWebsite);
        }else{
          if(!result?.retryable||!ownerId||result.ownerId!==ownerId){ownerId=null;sessionId=null;entries=[];}
          failed=true;
        }
      }catch(error){
        if(!valid()||currentIdentity!==identityVersion)return;
        ownerId=null;sessionId=null;entries=[];failed=true;
        const stale=/extension context invalidated|receiving end does not exist|could not establish connection/i.test(String(error?.message));
        if(stale){retry.textContent='Reload website';retry.onclick=event=>{if(event.isTrusted)location.reload();};}
      }finally{if(valid()&&currentIdentity===identityVersion){refreshing=false;paint();}}
    }
    retry.onclick=event=>{if(event.isTrusted)void refresh();};
    try{
      const cached=await chrome.runtime.sendMessage({action:'vault-cached'});
      if(!valid())return;
      if(cached?.connected&&!invalidatedSessions.has(cached.sessionId)&&typeof cached.ownerId==='string'){
        ownerId=cached.ownerId;sessionId=cached.sessionId||null;entries=(cached.catalog||[]).filter(matchesWebsite);
      }
    }catch{}
    if(valid())void refresh();
  }
  function render(){
    if(dead)return;
    placeHost();
    const list=enabled?candidates():[],desired=new Map();
    if(list.length){desired.set('top',{value:list[0],field:null});for(const value of list)for(const field of [value.username,value.password].filter(Boolean))desired.set(field,{value,field});}
    if(!enabled||(selection&&!recheck(selection.target)))clearPanel();
    for(const [id,item] of chips)if(!desired.has(id)){item.button.remove();chips.delete(id);}
    for(const [id,position] of desired){let item=chips.get(id);if(!item){const button=document.createElement('button');button.className=`chip${position.field?' field':''}`;button.setAttribute('aria-label','Choose a saved Thingtime account');button.append(tree());item={button,value:position.value};button.addEventListener('click',event=>{if(event.isTrusted)void choose(item.value,button);});if(!position.field){const text=document.createElement('span');text.textContent='Thingtime accounts';button.append(text);}chips.set(id,item);root.append(button);}item.value=position.value;const button=item.button,field=position.field;
      if(!field){button.style.top='12px';button.style.left='50%';button.style.transform='translateX(-50%)';}
      else{const r=field.getBoundingClientRect();const occupied=[...field.parentElement.querySelectorAll('button')].some(other=>{const b=other.getBoundingClientRect();return b.width>0&&b.left<r.right&&b.right>r.right-36&&b.top<r.bottom&&b.bottom>r.top;});button.style.left=`${Math.max(0,r.right-(occupied?68:36))}px`;button.style.top=`${r.top+r.height/2-14}px`;}
    }
  }
  let scheduled=false;const schedule=()=>{if(!scheduled&&!dead){scheduled=true;requestAnimationFrame(()=>{scheduled=false;render();});}};
  const observer=new MutationObserver(schedule);
  function start(){if(!document.documentElement)return;if(typeof host.showPopover==='function'){host.popover='manual';host.style.cssText='margin:0;padding:0;border:0;background:transparent;overflow:visible;';}placeHost();observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['type','autocomplete','action','hidden','disabled','readonly','open','role','aria-modal','aria-hidden','form','id','inert']});schedule();}
  if(document.documentElement)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
  window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&panel){event.preventDefault();event.stopPropagation();clearPanel();}},true);
  const state=async()=>{try{const s=await chrome.runtime.sendMessage({action:'state'});enabled=s.autofillEnabled!==false;schedule();}catch{enabled=false;schedule();}};void state();chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='session'&&(changes.accountEpoch||changes.accountLocked)||area==='local'&&(changes.origin||changes.autofillEnabled)){
      catalogRequest=null;clearPanel();void state();
    }
  });
  document.addEventListener('thingtime:password-vault-ready',()=>void chrome.runtime.sendMessage({action:'vault-provider-ready'}).catch(()=>{}));
  document.addEventListener('thingtime:password-vault-response',event=>{const m=detail(event);if(m?.version!==1||m.id!==providerActive)return;providerActive=null;void chrome.runtime.sendMessage({...m,action:'vault-provider-response'}).catch(()=>{});});
  document.addEventListener('thingtime:password-vault-invalidate',()=>{providerActive=null;void chrome.runtime.sendMessage({action:'vault-provider-invalidate'}).catch(()=>{});});
  chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
    if(message.action==='vault-provider-init'){dispatch('thingtime:password-vault-init',{version:1});respond({ok:true});}
    else if(message.action==='vault-source-invalidate'){selection?.invalidate(message.sessionId);respond({ok:true});}
    else if(message.action==='vault-provider-request'){providerActive=message.request.id;dispatch('thingtime:password-vault-request',message.request);respond({ok:true});}
    else if(message.action==='vault-provider-cancel'){
      if(providerActive!==message.id){respond({ok:true});return;}
      const handled=!document.dispatchEvent(new CustomEvent('thingtime:password-vault-cancel',{cancelable:true,detail:JSON.stringify({version:1,id:message.id})}));
      if(handled)providerActive=null;
      respond({ok:handled});
    }
    else if(message.action==='vault-prepare'){
      armed=null;
      const selected=message.targetId===undefined?candidates()[0]:message.targetId===selection?.id?selection.target:null;
      const target=enabled&&recheck(selected);
      if(!target){respond({ok:false});return;}
      armed={target,targetId:message.targetId??crypto.randomUUID(),nonce:crypto.randomUUID()};
      respond({ok:true,targetId:armed.targetId,nonce:armed.nonce,origin:location.origin,actionOrigin:new URL(target.action).origin});
    }else if(message.action==='vault-fill-values'){
      const pending=armed;armed=null;
      const now=pending&&recheck(pending.target);
      if(!now||!enabled||message.nonce!==pending.nonce||message.targetId!==pending.targetId||message.origin!==location.origin){
        respond({ok:false});return;
      }
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      for(const [field,value] of [[now.username,message.username],[now.password,message.password]]){
        if(!field||typeof value!=='string')continue;
        // A synchronous page input handler can replace the next field or change
        // its form action while processing the username event.
        if(!recheck(pending.target)){respond({ok:false});return;}
        setter.call(field,value);
        field.dispatchEvent(new Event('input',{bubbles:true}));
        field.dispatchEvent(new Event('change',{bubbles:true}));
      }
      message.username='';message.password='';respond({ok:true});
    }
  });
  window.addEventListener('pagehide',()=>{dead=true;armed=null;providerActive=null;observer.disconnect();host.remove();selection=null;},{once:true});
})();
