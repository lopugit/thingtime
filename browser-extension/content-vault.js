(() => {
  'use strict';
  if (window.top !== window) return;
  const dispatch=(name,value)=>document.dispatchEvent(new CustomEvent(name,{detail:JSON.stringify(value)}));
  const detail=event=>{try{return JSON.parse(event.detail);}catch{return null;}};
  let providerActive=null, dead=false, enabled=true, armed=null;
  const host=document.createElement('div'); host.setAttribute('data-thingtime-autofill','');
  const root=host.attachShadow({mode:'open'});
  root.innerHTML='<style>:host{all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646;font:14px system-ui;color:#221e35}button,input{font:inherit}button{cursor:pointer;border:1px solid #d9d0ef;border-radius:12px;background:#faf7ff;color:#322846;padding:7px 10px;box-shadow:0 3px 14px #37254b22;pointer-events:auto}button:focus-visible,input:focus-visible{outline:3px solid #8a63ce;outline-offset:2px}.chip{position:fixed;display:flex;align-items:center;gap:7px}.field{padding:4px;width:28px;height:28px;justify-content:center;box-sizing:border-box}.tree{width:19px;height:19px;image-rendering:pixelated;pointer-events:none}.panel{position:fixed;top:60px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 24px);width:340px;max-height:calc(100vh - 84px);overflow:auto;padding:12px;border:1px solid #d9d0ef;border-radius:18px;background:#fff;box-shadow:0 12px 40px #2e214433;pointer-events:auto;box-sizing:border-box}.panel h2{font-size:16px;margin:0 0 8px}.panel p{margin:6px 0;overflow-wrap:anywhere}.panel button.account{display:block;width:100%;text-align:left;margin-top:8px;box-shadow:none}.account span{display:block;font-size:12px;color:#6a6176}.close{float:right;padding:2px 8px}.status{font-size:12px;color:#6a6176}</style>';
  const tree=()=>{const i=document.createElement('img');i.className='tree';i.src=chrome.runtime.getURL('thingtime-icon-32.png');i.alt='';i.setAttribute('aria-hidden','true');return i;};
  const forms=new Map(); const ids=new WeakMap(); let panel=null, opener=null; const chips=new Map();
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return e.isConnected&&!e.disabled&&!e.readOnly&&r.width>80&&r.height>16&&r.bottom>0&&r.top<innerHeight&&s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity)!==0;};
  const eligible=e=>e instanceof HTMLInputElement && visible(e) && !['new-password','one-time-code'].includes(e.autocomplete);
  const username=e=>eligible(e)&&(['email','text','tel'].includes(e.type))&&(/username|email/.test(e.autocomplete)||e.type==='email'||/email|user|login|account/i.test(`${e.name} ${e.id}`));
  function inspect(form){
    if(!form?.isConnected)return null;
    const fields=[...form.querySelectorAll('input')];const passwords=fields.filter(e=>eligible(e)&&e.type==='password');const users=fields.filter(username);
    if(!passwords.length&&!users.length)return null;
    let action;try{action=new URL(form.action||location.href,location.href);}catch{return null;}
    if(action.origin!==location.origin||action.username||action.password||!['https:','http:'].includes(action.protocol))return null;
    return {form,password:passwords[0]||null,username:users[0]||null,actionOrigin:action.origin};
  }
  const modalSelector='dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';
  function activeModal(){return [...document.querySelectorAll(modalSelector)].filter(visible).at(-1)||null;}
  function placeHost(){
    // Keep controls in the website's active modal accessibility/focus scope.
    // A manual popover retains viewport positioning above transformed/clipped
    // modal containers without modifying the website's styles or ARIA tree.
    const parent=activeModal()||document.documentElement;
    const popover=typeof host.showPopover==='function';
    if(host.parentElement!==parent){if(popover&&host.matches(':popover-open'))host.hidePopover();parent.append(host);}
    if(popover&&!host.matches(':popover-open'))host.showPopover();
  }
  function candidates(){return [...(activeModal()||document).querySelectorAll('form')].map(inspect).filter(Boolean);}
  function formId(form){let id=ids.get(form);if(!id){id=crypto.randomUUID();ids.set(form,id);forms.set(id,form);}return id;}
  function clearPanel(){panel?.remove();panel=null;if(!dead&&opener?.isConnected)opener.focus();opener=null;}
  async function choose(selected,trigger){
    clearPanel();opener=trigger;armed=null;panel=document.createElement('section');panel.className='panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Choose a Thingtime account');const close=document.createElement('button');close.className='close';close.textContent='×';close.setAttribute('aria-label','Close account chooser');close.onclick=clearPanel;panel.append(close);const title=document.createElement('h2');title.textContent='Choose a saved account';panel.append(title);const site=document.createElement('p');site.className='status';site.textContent=location.origin;panel.append(site);const status=document.createElement('p');status.className='status';status.textContent='Connecting to your Thingtime vault…';panel.append(status);root.append(panel);panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();clearPanel();}else if(event.key==='Tab'){const controls=[...current.querySelectorAll('button:not(:disabled),input:not(:disabled)')];const first=controls[0],last=controls.at(-1);if(event.shiftKey&&root.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&root.activeElement===last){event.preventDefault();first.focus();}}});close.focus();
    const current=panel;
    try{
      let result=await chrome.runtime.sendMessage({action:'vault-cached'});
      if(!result?.catalog?.length)result=await chrome.runtime.sendMessage({action:'vault-catalog'});
      if(panel!==current||dead)return;
      if(!result?.ok)throw Error(result?.error||'Open Thingtime from the toolbar to reconnect.');
      const list=result.catalog.filter(e=>e.hasPassword&&e.domains?.some(domain=>domain.toLowerCase()===location.hostname.toLowerCase()));
      status.textContent=list.length?'Choose an account. Thingtime never submits the form.':'No account is saved for this website. Search all accounts in the Thingtime workspace.';
      for(const entry of list){const b=document.createElement('button');b.className='account';const name=document.createElement('strong');name.textContent=entry.title||'Saved account';const sub=document.createElement('span');sub.textContent=entry.username||'No saved username';b.append(name,sub);b.addEventListener('click',async event=>{if(!event.isTrusted)return;b.disabled=true;status.textContent='Complete any required verification in Thingtime.';const filled=await chrome.runtime.sendMessage({action:'vault-fill',entryId:entry.id,formId:formId(selected.form)}).catch(()=>null);if(panel!==current)return;if(filled?.ok)clearPanel();else{status.textContent=filled?.error||'Autofill did not complete. Try again.';b.disabled=false;}});current.append(b);}
      const all=document.createElement('button');all.textContent='Open password workspace';all.addEventListener('click',event=>{if(event.isTrusted)void chrome.runtime.sendMessage({action:'vault-open-workspace'});});current.append(all);
    }catch(error){if(panel===current){
      const stale=/extension context invalidated|receiving end does not exist|could not establish connection/i.test(String(error?.message));
      status.textContent=stale?'Thingtime was updated or reloaded. Reload this website to reconnect.':'Open Thingtime from the toolbar to reconnect, then choose the account again.';
      if(stale){const reload=document.createElement('button');reload.textContent='Reload website';reload.addEventListener('click',event=>{if(event.isTrusted)location.reload();});current.append(reload);}
    }}
  }
  function render(){
    if(dead)return;
    placeHost();
    for(const [id,form] of forms)if(!form.isConnected)forms.delete(id);
    const list=enabled?candidates():[],desired=new Map();
    if(list.length){desired.set('top',{value:list[0],field:null});for(const value of list)for(const field of [value.username,value.password].filter(Boolean))desired.set(field,{value,field});}
    else clearPanel();
    for(const [id,item] of chips)if(!desired.has(id)){item.button.remove();chips.delete(id);}
    for(const [id,position] of desired){let item=chips.get(id);if(!item){const button=document.createElement('button');button.className=`chip${position.field?' field':''}`;button.setAttribute('aria-label','Choose a saved Thingtime account');button.append(tree());item={button,value:position.value};button.addEventListener('click',event=>{if(event.isTrusted)void choose(item.value,button);});if(!position.field){const text=document.createElement('span');text.textContent='Thingtime accounts';button.append(text);}chips.set(id,item);root.append(button);}item.value=position.value;const button=item.button,field=position.field;
      if(!field){button.style.top='12px';button.style.left='50%';button.style.transform='translateX(-50%)';}
      else{const r=field.getBoundingClientRect();const occupied=[...field.parentElement.querySelectorAll('button')].some(other=>{const b=other.getBoundingClientRect();return b.width>0&&b.left<r.right&&b.right>r.right-36&&b.top<r.bottom&&b.bottom>r.top;});button.style.left=`${Math.max(0,r.right-(occupied?68:36))}px`;button.style.top=`${r.top+r.height/2-14}px`;}
    }
  }
  let scheduled=false;const schedule=()=>{if(!scheduled&&!dead){scheduled=true;requestAnimationFrame(()=>{scheduled=false;render();});}};
  const observer=new MutationObserver(schedule);
  function start(){if(!document.documentElement)return;if(typeof host.showPopover==='function'){host.popover='manual';host.style.cssText='margin:0;padding:0;border:0;background:transparent;overflow:visible;';}placeHost();observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['type','autocomplete','action','hidden','disabled','readonly','open','role','aria-modal','aria-hidden']});schedule();}
  if(document.documentElement)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
  window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&panel){event.preventDefault();event.stopPropagation();clearPanel();}},true);
  const state=async()=>{try{const s=await chrome.runtime.sendMessage({action:'state'});enabled=s.autofillEnabled!==false;schedule();}catch{enabled=false;schedule();}};void state();chrome.storage.onChanged.addListener(state);
  document.addEventListener('thingtime:password-vault-ready',()=>void chrome.runtime.sendMessage({action:'vault-provider-ready'}).catch(()=>{}));
  document.addEventListener('thingtime:password-vault-response',event=>{const m=detail(event);if(m?.version!==1||m.id!==providerActive)return;providerActive=null;void chrome.runtime.sendMessage({...m,action:'vault-provider-response'}).catch(()=>{});});
  document.addEventListener('thingtime:password-vault-invalidate',()=>{providerActive=null;void chrome.runtime.sendMessage({action:'vault-provider-invalidate'}).catch(()=>{});});
  chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
    if(message.action==='vault-provider-init'){dispatch('thingtime:password-vault-init',{version:1});respond({ok:true});}
    else if(message.action==='vault-provider-request'){providerActive=message.request.id;dispatch('thingtime:password-vault-request',message.request);respond({ok:true});}
    else if(message.action==='vault-prepare'){
      const value=message.formId?inspect(forms.get(message.formId)):candidates()[0];
      if(!value){respond({ok:false});return;}
      armed={...value,formId:formId(value.form),nonce:crypto.randomUUID()};respond({ok:true,formId:armed.formId,nonce:armed.nonce,origin:location.origin,actionOrigin:armed.actionOrigin});
    }else if(message.action==='vault-fill-values'){
      const pending=armed;armed=null;const now=pending&&inspect(pending.form);
      if(!pending||!now||dead||message.nonce!==pending.nonce||message.formId!==pending.formId||message.origin!==location.origin||now.actionOrigin!==location.origin||now.username!==pending.username||now.password!==pending.password){respond({ok:false});return;}
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      for(const [field,value] of [[now.username,message.username],[now.password,message.password]])if(field&&typeof value==='string'){setter.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));}
      message.username='';message.password='';respond({ok:true});
    }
  });
  window.addEventListener('pagehide',()=>{dead=true;armed=null;providerActive=null;observer.disconnect();host.remove();forms.clear();},{once:true});
})();
