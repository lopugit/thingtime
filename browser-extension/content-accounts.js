(() => {
 'use strict';if(window.top!==window)return;
 const pending=new Map();let dead=false;
 const receive=event=>{let value;try{value=JSON.parse(event.detail);}catch{return;}const done=pending.get(value?.nonce);if(value?.version!==1||!done)return;done(value);};
 document.addEventListener('thingtime:extension-accounts-response',receive);
 document.addEventListener('thingtime:extension-accounts-changed',event=>{let value;try{value=JSON.parse(event.detail);}catch{return;}void chrome.runtime.sendMessage({action:'accounts-changed',ownerId:typeof value.ownerId==='string'?value.ownerId:null,refresh:value.refresh===true}).catch(()=>{});});
 document.addEventListener('thingtime:extension-accounts-complete',event=>{let value;try{value=JSON.parse(event.detail);}catch{return;}if(typeof value.operation!=='string')return;void chrome.runtime.sendMessage({action:'accounts-complete',operation:value.operation,canClose:value.canClose===true}).then(result=>document.dispatchEvent(new CustomEvent('thingtime:extension-accounts-completed',{detail:JSON.stringify({ok:result?.ok===true})}))).catch(()=>{});});
 function cancel(nonce){
  const finish=pending.get(nonce);if(!finish)return;
  finish({version:1,nonce,error:true});
  document.dispatchEvent(new CustomEvent('thingtime:extension-accounts-cancel',{detail:JSON.stringify({version:1,nonce})}));
 }
 chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
  if(message?.action==='accounts-cancel'){cancel(message.nonce);return false;}
  if(message?.action!=='accounts-discover'||dead||typeof message.nonce!=='string')return false;
  const nonce=message.nonce,operation=message.operation==='catalog'?'catalog':'discover';
  // A complete catalog may need several authenticated pages. Keep roster
  // discovery short, but give the paginated request its own bounded lease.
  const timer=setTimeout(()=>cancel(nonce),operation==='catalog'?120_000:2500);
  const finish=value=>{clearTimeout(timer);pending.delete(nonce);respond(value);};pending.set(nonce,finish);
  document.dispatchEvent(new CustomEvent('thingtime:extension-accounts-request',{detail:JSON.stringify({version:1,operation,ownerId:message.ownerId,nonce})}));return true;
 });
 window.addEventListener('pagehide',()=>{dead=true;for(const nonce of [...pending.keys()])cancel(nonce);document.removeEventListener('thingtime:extension-accounts-response',receive);},{once:true});
})();
