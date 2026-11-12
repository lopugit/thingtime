import {safeOrigin,PROVIDER_PATH} from './protocol.js';
import {workspacePreferences} from './workspace.js';
const project=accounts=>(Array.isArray(accounts)?accounts:[]).filter(a=>typeof a?.id==='string').map(a=>({id:a.id,username:typeof a.username==='string'?a.username:'',displayName:typeof a.displayName==='string'?a.displayName:'',active:a.active===true}));
export function createAccountController(api,{settings,invalidate,randomUUID=()=>crypto.randomUUID()}){
 let value=null,generation=0,locked=false,owned=null,loading=null;
 const pendingCatalog=new Map();
 const ready=api.storage.session.get(['accountLocked','accountPopup']).then(saved=>{locked=saved.accountLocked===true;const popup=saved.accountPopup;try{const url=new URL(popup?.url);if(Number.isInteger(popup.tabId)&&Number.isInteger(popup.windowId)&&safeOrigin(popup.origin)===url.origin&&url.pathname===PROVIDER_PATH&&url.searchParams.get('view')==='accounts'&&/^[-a-f0-9]{36}$/i.test(url.searchParams.get('operation')||'')&&[...url.searchParams.keys()].every(key=>['view','operation','fontSize'].includes(key)))owned=popup;}catch{}});
 const clear=()=>{
  generation++;value=null;loading=null;
  for(const [nonce,{tabId,documentId}] of pendingCatalog)
   void api.tabs.sendMessage(tabId,{action:'accounts-cancel',nonce},{documentId}).catch(()=>{});
  pendingCatalog.clear();
  invalidate();void api.storage.session.set({accountEpoch:randomUUID()});
 };
 async function live(tabId,documentId,origin){const [tab,frame]=await Promise.all([api.tabs.get(tabId).catch(()=>null),api.webNavigation.getFrame({tabId,frameId:0}).catch(()=>null)]);return tab&&!tab.pendingUrl&&safeOrigin(tab.url)===origin&&frame?.documentId===documentId&&safeOrigin(frame.url)===origin;}
 async function discover(catalog=false){
  await ready;const epoch=generation;const config=await settings(),origin=safeOrigin(config.origin);if(!origin)return {ok:false};
  if(locked)return {ok:true,locked:true,accounts:[],epoch:generation};
  const tabs=await api.tabs.query({});
  // Reuse the document that just proved this account's identity before
  // considering another tab that may have no account bridge mounted.
  if(value?.origin===origin)tabs.sort((a,b)=>Number(b.id===value.tabId)-Number(a.id===value.tabId));
  for(const tab of tabs){
   if(safeOrigin(tab.url)!==origin||tab.pendingUrl)continue;
   const frame=await api.webNavigation.getFrame({tabId:tab.id,frameId:0}).catch(()=>null);if(!frame?.documentId)continue;
   if(epoch!==generation||locked)return {ok:false};
   const nonce=randomUUID();if(catalog)pendingCatalog.set(nonce,{tabId:tab.id,documentId:frame.documentId});
   const reply=await api.tabs.sendMessage(tab.id,{action:'accounts-discover',nonce,operation:catalog?'catalog':'discover',ownerId:value?.ownerId},{documentId:frame.documentId}).catch(()=>null);
   pendingCatalog.delete(nonce);
   if(epoch!==generation||locked||safeOrigin((await settings()).origin)!==origin)return {ok:false};
   if(reply?.version!==1||reply.nonce!==nonce)continue;
   const valid=await live(tab.id,frame.documentId,origin);const currentOrigin=safeOrigin((await settings()).origin);if(epoch!==generation||locked||currentOrigin!==origin)return {ok:false};if(!valid)continue;if(reply.error){if(catalog)return {ok:false,error:'Saved accounts are unavailable.'};continue;}
   const accounts=project(reply.accounts);const ownerId=accounts.find(a=>a.active)?.id||null;
   if(value&&(value.ownerId!==ownerId||value.origin!==origin)){clear();return discover(catalog);}
   value={origin,ownerId,accounts,tabId:tab.id,documentId:frame.documentId};return {ok:true,...value,epoch:generation,...(catalog?{catalog:(Array.isArray(reply.catalog)?reply.catalog:[]).filter(a=>typeof a?.id==='string'&&a.fillEligible===true).map(a=>({id:a.id,title:typeof a.title==='string'?a.title:'',username:typeof a.username==='string'?a.username:'',domains:Array.isArray(a.domains)?a.domains.filter(d=>typeof d==='string'):[],...(Array.isArray(a.origins)?{origins:a.origins.filter(v=>typeof v==='string'&&safeOrigin(v)===v)}:{}),fillEligible:true}))}:{} )};
  }
  if(value)clear();return {ok:true,accounts:[],ownerId:null,origin,epoch:generation,available:false};
 }
 function catalog(){
  if(loading)return loading;
  const request=discover(true);loading=request;
  const settled=()=>{if(loading===request)loading=null;};
  void request.then(settled,settled);
  return request;
 }
 async function open(){
  await ready;locked=false;await api.storage.session.set({accountLocked:false});clear();const epoch=generation;const config=await settings(),origin=safeOrigin(config.origin);if(!origin)return {ok:false};
  if(owned?.origin===origin){const tab=await api.tabs.get(owned.tabId).catch(()=>null);if(tab?.windowId===owned.windowId&&tab.url===owned.url&&(!tab.pendingUrl||tab.pendingUrl===owned.url)){if(epoch!==generation||locked)return {ok:false};await api.tabs.update(owned.tabId,{active:true});await api.windows.update(owned.windowId,{focused:true});return {ok:true};}}
  const stored=await api.storage.local.get('workspacePreferences'),p=workspacePreferences(stored.workspacePreferences);
  const selectedOrigin=safeOrigin((await settings()).origin);if(epoch!==generation||locked||selectedOrigin!==origin)return {ok:false};
  const nonce=randomUUID(); // Nonsecret operation identity, never a session handle.
  const url=`${origin}${PROVIDER_PATH}?view=accounts&operation=${nonce}&fontSize=${p.fontSize}`;const win=await api.windows.create({url,type:'popup',focused:true,width:p.width,height:p.height});
  const finalOrigin=safeOrigin((await settings()).origin);if(epoch!==generation||locked||finalOrigin!==origin){const tab=win.tabs?.[0];if(tab){const current=await api.tabs.get(tab.id).catch(()=>null);if(current?.windowId===win.id&&(current.url===url||current.pendingUrl===url))await api.tabs.remove(tab.id).catch(()=>{});}return {ok:false};}
  owned=win.tabs?.[0]?{tabId:win.tabs[0].id,windowId:win.id,documentId:null,origin,url}:null;await api.storage.session.set({accountPopup:owned});return {ok:true};
 }
 async function handle(message,sender,internal){
  if(message.action==='accounts-complete'){
   await ready;const current=owned,epoch=generation;const origin=safeOrigin((await settings()).origin);
   if(!current||sender.frameId!==0||sender.tab?.id!==current.tabId||sender.tab.windowId!==current.windowId||sender.url!==current.url||safeOrigin(sender.url)!==origin||new URL(current.url).searchParams.get('operation')!==message.operation||!await live(current.tabId,sender.documentId,origin))return {ok:false};
   const saved=await api.storage.session.get('workspaceWindowId');const win=Number.isInteger(saved.workspaceWindowId)?await api.windows.get(saved.workspaceWindowId,{populate:true}).catch(()=>null):null;
   const workspaceTab=win?.tabs?.find(tab=>tab.url===api.runtime.getURL('popup.html')&&!tab.pendingUrl);
   if(!workspaceTab||!await live(current.tabId,sender.documentId,origin))return {ok:false};const selected=safeOrigin((await settings()).origin);if(owned!==current||epoch!==generation||selected!==origin)return {ok:false};
   await api.tabs.update(workspaceTab.id,{active:true});await api.windows.update(win.id,{focused:true});
   const bridge=value;const alternate=bridge&&bridge.tabId!==current.tabId&&bridge.origin===origin&&await live(bridge.tabId,bridge.documentId,origin);const tab=await api.tabs.get(current.tabId).catch(()=>null);if(message.canClose===true&&alternate&&value===bridge&&owned===current&&tab?.url===current.url&&!tab.pendingUrl&&tab.windowId===current.windowId){owned=null;await api.storage.session.remove('accountPopup');await api.tabs.remove(current.tabId).catch(()=>{});}return {ok:true};
  }
  if(message.action==='accounts-changed'){
   const origin=safeOrigin((await settings()).origin);if(sender.frameId!==0||safeOrigin(sender.url)!==origin||!await live(sender.tab?.id,sender.documentId,origin))return {ok:false};
   if(owned?.tabId===sender.tab.id)owned.documentId=sender.documentId;
   if(message.refresh||value&&value.ownerId!==message.ownerId)clear();return {ok:true};
  }
  if(!internal)return {ok:false};
  if(message.action==='accounts-open')return open();
  if(message.action==='accounts-unlock'){await ready;locked=false;await api.storage.session.set({accountLocked:false});clear();return discover();}
  if(message.action==='accounts-lock'){await ready;locked=true;clear();await api.storage.session.set({accountLocked:true});return {ok:true};}
  if(message.action==='accounts-discover')return discover();
  if(message.action==='accounts-catalog')return catalog();
  return {ok:false};
 }
 api.tabs.onRemoved.addListener(id=>{if(value?.tabId===id)clear();if(owned?.tabId===id){owned=null;void api.storage.session.remove('accountPopup');}});
 api.webNavigation.onCommitted.addListener(d=>{if(d.frameId===0&&value?.tabId===d.tabId&&d.documentId!==value.documentId)clear();});
 api.storage.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes.origin){clear();}});
 return {handle,discover,admit:async()=>{await ready;return !locked;},current:()=>value?{ownerId:value.ownerId,origin:value.origin,epoch:generation}:null,clear};
}
