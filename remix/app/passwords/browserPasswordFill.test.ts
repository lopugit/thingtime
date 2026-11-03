import assert from 'node:assert/strict';
import {before,mock,test} from 'node:test';
let requirements:string[][]=[],pages:any[]=[];
mock.module(new URL('../api/utils/capabilities/requireCapability.client.ts',import.meta.url).href,{namedExports:{requireThingtimeCapability:async(...args:string[])=>{requirements.push(args);}}});
mock.module(new URL('./client.ts',import.meta.url).href,{namedExports:{passwordRequest:async()=>pages.shift()}});
let fill:any;
before(async()=>{fill=await import('./browserPasswordFill');});
test('browser fill requires corrected website contract and reads every catalog page without secret fields',async()=>{
 requirements=[];pages=[{catalog:[{id:'one',title:'Other',username:'other',fillEligible:true,domains:['other.test'],password:'never-forward'}],nextCursor:'two'}, {catalog:[{id:'two',title:'Selected',username:'selected',fillEligible:true,domains:['thingtime.com'],password:'never-forward'}]}];
 const r=fill.validateVaultRequest({version:1,id:crypto.randomUUID(),type:'catalog',origin:'https://thingtime.com',target:{tabId:1,frameId:0,documentId:'fixture'}});
 const catalog=await fill.loadPasswordCatalog('owner',r,new AbortController().signal);
 assert.deepEqual(requirements,[['api.passwords','1.6.1']]);assert.deepEqual(catalog.map((row:any)=>row.id),['one','two']);assert.equal(JSON.stringify(catalog).includes('never-forward'),false);
 const controller=new AbortController();controller.abort();await assert.rejects(fill.loadPasswordCatalog('owner',r,controller.signal));
});
