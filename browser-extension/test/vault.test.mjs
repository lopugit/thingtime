import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVaultController} from '../vault.js';
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);},fire(...args){for(const fn of this.listeners)fn(...args);}});
const tick=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
function fixture(){
 const frames=new Map([[1,{url:'https://login.example.test/login',documentId:'source'}],[77,{url:'https://login.example.test/old-meta',documentId:'old'}]]);const sent=[],removed=[],focus=[],windows=[];let stored={},next=20;
 const api={runtime:{getURL:p=>`chrome-extension://fixture/${p}`},storage:{session:{get:async()=>stored,set:async v=>Object.assign(stored,v),remove:async k=>{delete stored[k];}},local:{get:async()=>({workspacePreferences:{width:1100,height:820,fontSize:18}})},onChanged:event()},tabs:{get:async id=>{const f=frames.get(id);return f?{id,url:f.url,windowId:id===1?10:id===77?11:99}:null;},remove:async id=>{removed.push(id);frames.delete(id);},update:async id=>{focus.push(['tab',id]);},onRemoved:event(),onUpdated:event(),sendMessage:async(id,message,options)=>{sent.push({id,message:structuredClone(message),options});return message.action==='vault-prepare'?{ok:true,nonce:'private-target-nonce',targetId:'target',origin:'https://login.example.test',actionOrigin:'https://login.example.test'}:{ok:true};}},windows:{create:async options=>{windows.push(options);const id=next++;frames.set(id,{url:options.url,documentId:'provider'});return{id:99,tabs:[{id,windowId:99}]};},update:async id=>{focus.push(['window',id]);}},webNavigation:{getFrame:async({tabId})=>frames.get(tabId),onCommitted:event()},alarms:{create:async()=>{},clear:async()=>{},onAlarm:event()}};
 let target={tabId:1,documentId:'source',origin:'https://login.example.test',windowId:10};const config={origin:'https://thingtime.com',autofillEnabled:true};
 const currentDocument=async(id,doc,origin,provider=false)=>{const f=frames.get(id);return f?.documentId===doc&&new URL(f.url).origin===origin&&(!provider||new URL(f.url).pathname==='/passwords/provider');};
 let epoch=0;const workspace={target:async()=>target,generation:()=>epoch};const setTarget=value=>{target=value;epoch++;};
 let admitted=true,identity=null;const vault=createVaultController(api,{accountAdmission:async()=>admitted,accountIdentity:()=>identity,settings:async()=>config,workspace,currentDocument});
 const sender={tab:{id:1,windowId:10,url:frames.get(1).url},url:frames.get(1).url,origin:target.origin,frameId:0,documentId:'source'};
 const provider=()=>({tab:{id:20,url:frames.get(20).url,windowId:99},url:frames.get(20).url,origin:config.origin,frameId:0,documentId:'provider'});
 const request=()=>sent.filter(x=>x.message.action==='vault-provider-request').at(-1).message.request;
 return{setAdmitted:value=>admitted=value,setOwner:ownerId=>identity={ownerId,origin:config.origin},api,vault,workspace,setTarget,frames,sent,removed,focus,windows,config,sender,provider,request};
}
async function connect(e){const p=e.vault.handle({action:'vault-catalog'},e.sender,false);await tick();await e.vault.handle({action:'vault-provider-ready'},e.provider(),false);const r=e.request();await e.vault.handle({action:'vault-provider-response',version:1,id:r.id,ownerId:'owner',catalog:[{id:'entry',title:'Synthetic login',username:'fixture@example.test',domains:['login.example.test'],hasPassword:true,fillEligible:true,password:'must-not-cache',privateKey:'must-not-cache'}]},e.provider(),false);return p;}
test('owned popup, allowlisted live catalog and selected fill bind exact original document',async()=>{
 const e=fixture();const catalog=await connect(e);assert.equal(e.windows[0].type,'popup');assert.equal(e.windows[0].width,1100);assert.equal(e.windows[0].height,820);assert.equal(JSON.stringify(catalog).includes('must-not-cache'),false);
 const fill=e.vault.handle({action:'vault-fill',entryId:'entry'},e.sender,false);await tick();const r=e.request();assert.equal(r.type,'fill');assert.deepEqual(r.target,{tabId:1,frameId:0,documentId:'source'});assert.equal(r.entryId,'entry');assert.equal(r.presentation.fontSize,18);
 await e.vault.handle({action:'vault-provider-response',version:1,id:r.id,ownerId:'owner',values:{username:'fixture@example.test',password:'synthetic-only'}},e.provider(),false);assert.equal((await fill).ok,true);
 const delivery=e.sent.find(x=>x.message.action==='vault-fill-values');assert.equal(delivery.id,1);assert.deepEqual(delivery.options,{documentId:'source'});assert.equal(delivery.message.nonce,'private-target-nonce');assert.deepEqual(e.focus.slice(-2),[['tab',1],['window',10]]);assert.equal(e.focus.some(x=>x[1]===77||x[1]===11),false);
 const cached=await e.vault.handle({action:'vault-cached'},e.sender,false);assert.equal(JSON.stringify(cached).includes('synthetic-only'),false);assert.equal(JSON.stringify(cached).includes('password'),false);
});
test('page claims, cross-origin frames and stale provider documents cannot request or return a fill',async()=>{
 const e=fixture();for(const sender of [{...e.sender,frameId:1},{...e.sender,origin:'https://attacker.test'},{...e.sender,documentId:'old'}])assert.equal((await e.vault.handle({action:'vault-fill',entryId:'entry'},sender,false)).ok,false);
 await connect(e);const fill=e.vault.handle({action:'vault-fill',entryId:'entry'},e.sender,false);await tick();const r=e.request();assert.equal((await e.vault.handle({action:'vault-provider-response',version:1,id:r.id,ownerId:'owner',values:{username:'x',password:'not-delivered'}},{...e.provider(),documentId:'stale'},false)).ok,false);
 e.frames.set(1,{url:'https://login.example.test/next',documentId:'new'});e.api.webNavigation.onCommitted.fire({tabId:1,frameId:0,documentId:'new',url:'https://login.example.test/next'});await tick();assert.equal((await fill).ok,false);assert.equal(e.sent.some(x=>x.message.password==='not-delivered'),false);
});
test('cross-origin form actions are refused before opening an approval',async()=>{const e=fixture();e.api.tabs.sendMessage=async()=>({ok:true,targetId:'target',nonce:'nonce',origin:e.sender.origin,actionOrigin:'https://attacker.test'});assert.equal((await e.vault.handle({action:'vault-fill',entryId:'entry'},e.sender,false)).ok,false);assert.equal(e.windows.length,0);});
test('account invalidation during requester focus cancels secret delivery and clears catalog',async()=>{
 const e=fixture();await connect(e);const fill=e.vault.handle({action:'vault-fill',entryId:'entry'},e.sender,false);await tick();const r=e.request();let release;const held=new Promise(resolve=>{release=resolve;});e.api.windows.update=async()=>held;
 const response=e.vault.handle({action:'vault-provider-response',version:1,id:r.id,ownerId:'owner',values:{username:'fixture',password:'cancelled-secret'}},e.provider(),false);await tick();await e.vault.handle({action:'vault-provider-invalidate'},e.provider(),false);release();await response;assert.equal((await fill).ok,false);assert.equal(e.sent.some(x=>x.message.password==='cancelled-secret'),false);assert.deepEqual((await e.vault.handle({action:'vault-cached'},e.sender,false)).catalog,[]);
});
test('workspace A→B during source lookup rejects A while both documents remain live',async()=>{
 const e=fixture();e.frames.set(2,{url:'https://b.example.test/',documentId:'source-b'});let release;const get=e.api.tabs.get;e.api.tabs.get=async id=>id===1?new Promise(resolve=>{release=async()=>resolve(await get(id));}):get(id);
 const request=e.vault.handle({action:'vault-catalog'},{},true);await tick();e.setTarget({tabId:2,documentId:'source-b',origin:'https://b.example.test',windowId:99});await release();assert.equal((await request).ok,false);assert.equal(e.windows.length,0);assert.equal(e.frames.has(1)&&e.frames.has(2),true);
});
test('displayed A catalog selection cannot silently fill B, or outlive retarget during form preparation',async()=>{
 const e=fixture();await connect(e);const bound={tabId:1,windowId:10,documentId:'source',origin:e.sender.origin};e.frames.set(2,{url:'https://b.example.test/',documentId:'source-b'});e.setTarget({tabId:2,documentId:'source-b',origin:'https://b.example.test',windowId:99});assert.equal((await e.vault.handle({action:'vault-fill',entryId:'entry',target:bound},{},true)).ok,false);
 e.setTarget({...bound,windowId:10});let release;const send=e.api.tabs.sendMessage;e.api.tabs.sendMessage=async(id,message,options)=>message.action==='vault-prepare'?new Promise(resolve=>{release=async()=>resolve(await send(id,message,options));}):send(id,message,options);
 const request=e.vault.handle({action:'vault-fill',entryId:'entry',target:bound},{},true);await tick();e.setTarget({tabId:2,documentId:'source-b',origin:'https://b.example.test',windowId:99});await release();assert.equal((await request).ok,false);assert.equal(e.sent.filter(x=>x.message.action==='vault-provider-request'&&x.message.request.type==='fill').length,0);
});
test('a workspace cache repaint cannot close a newly opening provider before its ready handshake',async()=>{
 const e=fixture();const pending=e.vault.handle({action:'vault-catalog'},e.sender,false);await tick();const cached=await e.vault.handle({action:'vault-cached'},e.sender,false);assert.deepEqual(cached.catalog,[]);assert.equal(e.removed.length,0);await e.vault.handle({action:'vault-provider-ready'},e.provider(),false);const r=e.request();await e.vault.handle({action:'vault-provider-response',version:1,id:r.id,ownerId:'owner',catalog:[]},e.provider(),false);assert.equal((await pending).ok,true);
});
test('catalog refresh reuses only the live provider without stealing focus or returning locked metadata',async()=>{
 const e=fixture();
 const action={action:'vault-catalog',backgroundRefresh:true};
 assert.equal((await e.vault.handle(action,e.sender,false)).ok,false);
 assert.equal(e.windows.length,0);
 await connect(e);const focus=e.focus.slice();
 const refresh=e.vault.handle(action,e.sender,false);await tick();
 const r=e.request();assert.equal(r.type,'catalog');
 await e.vault.handle({action:'vault-provider-response',version:1,id:r.id,ownerId:'owner',catalog:[{id:'added',fillEligible:true,hasPassword:true,origins:['https://login.example.test','https://evil.test/path']}]},e.provider(),false);
 assert.deepEqual((await refresh).catalog[0].origins,['https://login.example.test']);
 assert.equal(e.windows.length,1);
 assert.deepEqual(e.focus,focus);
 e.setAdmitted(false);
 assert.deepEqual((await e.vault.handle({action:'vault-cached'},e.sender,false)).catalog,[]);
});
test('selected cached fill preempts a pending background catalog and binds the cached owner',async()=>{
 const e=fixture();
 await connect(e);
 const refresh=e.vault.handle({action:'vault-catalog',backgroundRefresh:true},e.sender,false);
 await tick();
 const catalog=e.request();
 const fill=e.vault.handle({action:'vault-fill',entryId:'entry',expectedOwnerId:'owner'},e.sender,false);
 await tick();
 assert.deepEqual(await refresh,{ok:false,superseded:true});
 const selection=e.request();
 assert.equal(selection.type,'fill');
 assert.equal(selection.expectedOwnerId,'owner');
 const index=e.sent.findIndex(({message})=>message.action==='vault-provider-cancel'&&message.id===catalog.id);
 assert.ok(index>=0&&e.sent[index+1].message.request.id===selection.id);
 assert.equal((await e.vault.handle({action:'vault-provider-response',version:1,id:catalog.id,ownerId:'owner',catalog:[]},e.provider(),false)).ok,false);
 await e.vault.handle({action:'vault-provider-response',version:1,id:selection.id,ownerId:'owner',values:{username:'fixture',password:crypto.randomUUID()}},e.provider(),false);
 assert.equal((await fill).ok,true);
 assert.equal((await e.vault.handle({action:'vault-fill',entryId:'entry',expectedOwnerId:'different-owner'},e.sender,false)).connectionEnded,true);
});
test('only a same-owner transient refresh failure retains the live cached catalog',async()=>{
 const e=fixture();await connect(e);
 async function fail(ownerId,name){
  const refresh=e.vault.handle({action:'vault-catalog',backgroundRefresh:true},e.sender,false);
  await tick();
  await e.vault.handle({action:'vault-provider-response',version:1,id:e.request().id,ownerId,error:{name}},e.provider(),false);
  return refresh;
 }
 assert.deepEqual(await fail('owner','NetworkError'),{ok:false,retryable:true,ownerId:'owner'});
 const cached=await e.vault.handle({action:'vault-cached'},e.sender,false);
 assert.equal(cached.catalog.length,1);
 assert.equal((await fail('different-owner','NetworkError')).connectionEnded,true);
 assert.deepEqual((await e.vault.handle({action:'vault-cached'},e.sender,false)).catalog,[]);
 const invalidated=e.sent.find(({message})=>message.action==='vault-source-invalidate');
 assert.equal(invalidated.message.sessionId,cached.sessionId);
 assert.deepEqual(invalidated.options,{documentId:'source'});
});
test('workspace fill can open its live owner but cannot open a provider for a stale cached owner',async()=>{
 const e=fixture();
 const action={action:'vault-fill',entryId:'entry',expectedOwnerId:'owner',target:{tabId:1,windowId:10,documentId:'source',origin:e.sender.origin}};
 e.setOwner('different-owner');
 assert.equal((await e.vault.handle(action,{},true)).connectionEnded,true);
 assert.equal(e.windows.length,0);
 e.setOwner('owner');
 const fill=e.vault.handle(action,{},true);
 await tick();
 await e.vault.handle({action:'vault-provider-ready'},e.provider(),false);
 const request=e.request();
 assert.equal(request.expectedOwnerId,'owner');
 await e.vault.handle({action:'vault-provider-response',version:1,id:request.id,ownerId:'owner',values:{username:'fixture',password:crypto.randomUUID()}},e.provider(),false);
 assert.equal((await fill).ok,true);
});
test('locked connection refuses content chip catalog and fill admissions until explicit unlock',async()=>{const e=fixture();e.setAdmitted(false);for(const message of [{action:'vault-catalog'},{action:'vault-fill',entryId:'entry'}]){const result=await e.vault.handle(message,e.sender,false);assert.equal(result.ok,false);assert.match(result.error,/Unlock/);}assert.equal(e.windows.length,0);e.setAdmitted(true);const result=await connect(e);assert.equal(result.ok,true);});

test('a prepared target cannot silently replace the field selected in the chooser',async()=>{
 const e=fixture();
 const result=await e.vault.handle({action:'vault-fill',entryId:'entry',targetId:'stale-target'},e.sender,false);
 assert.equal(result.ok,false);
 assert.equal(e.windows.length,0);
});
