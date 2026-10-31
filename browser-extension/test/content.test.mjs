import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../content.js',import.meta.url),'utf8');
class CustomEvent extends Event {constructor(type,options){super(type);this.detail=options.detail;}}
function setup(reply){
 const document=new EventTarget(),window=new EventTarget();window.top=window;
 let receive;
 const chrome={runtime:{sendMessage:async()=>({enabled:true}),onMessage:{addListener:fn=>{receive=fn;}}},storage:{onChanged:{addListener:()=>{}}}};
 document.addEventListener('thingtime:extension-diagnostics-query',()=>{if(reply!==undefined)document.dispatchEvent(new CustomEvent('thingtime:extension-diagnostics',{detail:JSON.stringify(reply)}));});
 vm.runInNewContext(source,{window,document,chrome,CustomEvent,setTimeout,clearTimeout});
 return ()=>new Promise(resolve=>{assert.equal(receive({action:'diagnostics-query'},{},resolve),true);});
}
test('content diagnostics strip page-controlled strings, options and identifiers before runtime transport',async()=>{
 const query=setup({version:1,installed:{get:true,create:'private'},current:{get:true,create:true},enabledSeen:'private',fallbackReason:'private',publicKey:{challenge:'private'},id:'private',cookie:'private'});
 const result=JSON.parse(JSON.stringify(await query()));
 assert.deepEqual(result,{available:true,hook:{installed:{create:false,get:true},current:{create:true,get:true},enabledSeen:null,fallbackReason:0}});
 assert.equal(JSON.stringify(result).includes('private'),false);
});
test('content bridge reports absent main hook after one bounded query',async()=>{
 const query=setup();assert.deepEqual(JSON.parse(JSON.stringify(await query())),{available:true,hook:null});
});
