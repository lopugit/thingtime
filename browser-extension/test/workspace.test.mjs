import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceController, workspacePreferences, fitWorkspaceBounds, WORKSPACE_DEFAULTS} from '../workspace.js';
import {safeOrigin} from '../protocol.js';
function setup() {
  const session = {}, tabs = new Map([[1,{id:1,windowId:10,url:'https://example.test/login'}]]), frames = new Map([[1,{documentId:'website',url:'https://example.test/login'}]]), wins = new Map(), created = [], focused = [], messages = [];
  const chrome = {runtime:{getURL:p=>`chrome-extension://test/${p}`},storage:{session:{get:async()=>session,set:async v=>Object.assign(session,v),remove:async k=>delete session[k]}},
    tabs:{get:async id=>tabs.get(id),query:async({url})=>[...tabs.values()].filter(t=>t.url===url),update:async(id,v)=>focused.push(['tab',id,v]),sendMessage:async(id,m)=>messages.push([id,m])},
    webNavigation:{getFrame:async({tabId})=>frames.get(tabId)},
    windows:{get:async id=>wins.get(id),update:async(id,v)=>{focused.push(['window',id,v]);return wins.get(id);},create:async v=>{created.push(v);const w={id:20,type:'popup',state:'normal',tabs:[{id:2,windowId:20,url:v.url}]};wins.set(20,w);tabs.set(2,{id:2,windowId:20,url:v.url});return w;}}};
  return {chrome,session,tabs,frames,wins,created,focused,messages,controller:createWorkspaceController(chrome,safeOrigin)};
}
test('toolbar captures the originating document and rapid opens reuse one resizable window',async()=>{
 const e=setup(); await Promise.all([e.controller.open(e.tabs.get(1)),e.controller.open(e.tabs.get(1))]);
 assert.equal(e.created.length,1);assert.deepEqual(e.created[0],{url:'chrome-extension://test/popup.html',type:'popup',width:960,height:760,focused:true});
 assert.deepEqual(await e.controller.target(),{tabId:1,windowId:10,documentId:'website',origin:'https://example.test'});
 assert.deepEqual(e.focused.map(v=>v.slice(0,2)),[['tab',2],['window',20]]);
 assert.deepEqual(Object.keys(e.session.workspaceTarget).sort(),['documentId','origin','tabId','windowId']);
});
test('worker restart discovers its exact owned window and never focuses a navigated options tab',async()=>{
 const e=setup();await e.controller.open(e.tabs.get(1));
 const restarted=createWorkspaceController(e.chrome,safeOrigin);await restarted.open(e.tabs.get(1));assert.equal(e.created.length,1);
 e.tabs.get(2).url='https://example.test/other';e.tabs.delete(2);e.wins.delete(20);
 await restarted.open(e.tabs.get(1));assert.equal(e.created.length,2);
});
test('target stays bound to captured website, rejects navigation, pending navigation, moved and closed tabs',async()=>{
 for(const mutate of [e=>e.frames.set(1,{documentId:'new',url:'https://example.test/other'}),e=>e.tabs.get(1).pendingUrl='https://example.test/other',e=>e.tabs.get(1).windowId=11,e=>e.tabs.delete(1)]){
  const e=setup();await e.controller.open(e.tabs.get(1));mutate(e);assert.equal(await e.controller.target(),null);
 }
 const e=setup();await e.controller.open(e.tabs.get(1));await e.controller.open({id:9,windowId:10});assert.equal(await e.controller.target(),null);
});
test('reopening from another website updates the target without opening a duplicate',async()=>{
 const e=setup();await e.controller.open(e.tabs.get(1));e.tabs.set(3,{id:3,windowId:11,url:'https://second.test/'});e.frames.set(3,{documentId:'second',url:'https://second.test/'});
 await e.controller.open(e.tabs.get(3));assert.equal(e.created.length,1);assert.equal((await e.controller.target()).origin,'https://second.test');assert.equal(e.messages.length,0);
});
test('appearance uses durable positive integer preferences and fits physical screens without a product cap',()=>{
 assert.deepEqual(workspacePreferences(),WORKSPACE_DEFAULTS);
 assert.deepEqual(workspacePreferences({width:4000,height:3000,fontSize:32,secret:'discard'}),{width:4000,height:3000,fontSize:32});
 assert.deepEqual(fitWorkspaceBounds({width:4000,height:3000,fontSize:32},{availWidth:1280,availHeight:720}),{width:1280,height:720});
 assert.deepEqual(workspacePreferences({width:-1,height:NaN,fontSize:Infinity}),WORKSPACE_DEFAULTS);
 assert.deepEqual(fitWorkspaceBounds(WORKSPACE_DEFAULTS,{availWidth:5000,availHeight:4000}),{width:960,height:760});
});

test('a delayed A inspection cannot overwrite B or enable its pending control',async()=>{
 const {createLatestInspection}=await import('../workspace.js');
 const loads=[],paint=[],settled=[];
 const inspect=createLatestInspection(()=>new Promise((resolve,reject)=>loads.push({resolve,reject})),(error,value)=>paint.push(error||value),()=>settled.push(true));
 const a=inspect(),b=inspect();loads[0].resolve({target:'A',hook:'old'});await a;assert.deepEqual(paint,[]);assert.deepEqual(settled,[]);
 loads[1].resolve({target:'B',hook:'current'});await b;assert.deepEqual(paint,[{target:'B',hook:'current'}]);assert.equal(settled.length,1);
 const c=inspect(),d=inspect();loads[3].resolve({target:'D'});await d;loads[2].reject(new Error('late C'));await c;assert.equal(paint.at(-1).target,'D');assert.equal(settled.length,2);
});

test('an owned window is reused while its initial page navigation is pending',async()=>{
 const e=setup();await e.controller.open(e.tabs.get(1));
 e.wins.get(20).tabs=[{id:2,windowId:20,url:'about:blank',pendingUrl:'chrome-extension://test/popup.html'}];
 e.tabs.get(2).url='about:blank';
 await e.controller.open(e.tabs.get(1));assert.equal(e.created.length,1);
 e.wins.get(20).tabs=[{id:2,windowId:20,url:'about:blank',pendingUrl:'https://unrelated.test/'}];
 await e.controller.open(e.tabs.get(1));assert.equal(e.created.length,2,'User navigation is not an owned extension window');
});


test('saved dimensions and position fit the current display, including negative monitor coordinates',()=>{
 assert.deepEqual(fitWorkspaceBounds({width:1100,height:820,fontSize:16},{availWidth:1920,availHeight:1080,availLeft:0,availTop:24},{left:1900,top:1000}),{width:1100,height:820,left:820,top:284});
 assert.deepEqual(fitWorkspaceBounds({width:4000,height:3000,fontSize:16},{availWidth:1280,availHeight:720,availLeft:-1280,availTop:0},{left:200,top:100}),{width:1280,height:720,left:-1280,top:0});
});
