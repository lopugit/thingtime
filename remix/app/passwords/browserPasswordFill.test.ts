import assert from 'node:assert/strict';
import {before,mock,test} from 'node:test';
let requirements:string[][]=[],pages:any[]=[],nativeCalls:unknown[][]=[];
mock.module(new URL('../api/utils/capabilities/requireCapability.client.ts',import.meta.url).href,{namedExports:{requireThingtimeCapability:async(...args:string[])=>{requirements.push(args);}}});
mock.module(new URL('./client.ts',import.meta.url).href,{namedExports:{passwordRequest:async()=>pages.shift(),nativePasswordVerificationRequest:async(ownerId:string,origin:string,body:unknown)=>{nativeCalls.push([ownerId,origin,body]);return pages.shift();}}});
let fill:any;
before(async()=>{fill=await import('./browserPasswordFill');});
test('browser fill requires corrected website contract and reads every catalog page without secret fields',async()=>{
 requirements=[];pages=[{catalog:[{id:'one',title:'Other',username:'other',fillEligible:true,domains:['other.test'],password:'never-forward'}],nextCursor:'two'}, {catalog:[{id:'two',title:'Selected',username:'selected',fillEligible:true,domains:['thingtime.com'],password:'never-forward'}]}];
 const r=fill.validateVaultRequest({version:1,id:crypto.randomUUID(),type:'catalog',origin:'https://thingtime.com',target:{tabId:1,frameId:0,documentId:'fixture'}});
 const catalog=await fill.loadPasswordCatalog('owner',r,new AbortController().signal);
 assert.deepEqual(requirements,[['api.passwords','1.6.1']]);assert.deepEqual(catalog.map((row:any)=>row.id),['one','two']);assert.equal(JSON.stringify(catalog).includes('never-forward'),false);
 const controller=new AbortController();controller.abort();await assert.rejects(fill.loadPasswordCatalog('owner',r,controller.signal));
});

const nativeRequest=()=>({version:1,id:crypto.randomUUID(),expectedOwnerId:'owner',apiOrigin:'https://vault.example',entryId:crypto.randomUUID(),requestHash:'H'.repeat(43)});
test('native website approval uses the exact catalog entry and the protected policy, returning only proof',async()=>{
 nativeCalls=[];
 const request={...nativeRequest(),type:'fill',origin:'https://login.example:8443'};
 const context={purpose:'fill',rp:'login.example',entryId:request.entryId,origin:request.origin,requestHash:request.requestHash};
 const signal=new AbortController().signal;
 assert.throws(()=>fill.validateNativeApprovalRequest(request,'wrong-owner'));
 assert.throws(()=>fill.validateNativeApprovalRequest({...request,origin:'http://127.0.0.1:1234'},'owner'));
 const safe=fill.validateNativeApprovalRequest(request,'owner');
 pages=[{catalog:[{id:request.entryId,fillEligible:true,origins:['https://login.example']}] }];
 await assert.rejects(fill.nativeApprovalDetails('owner',safe,signal),/selected account is unavailable/);
 nativeCalls=[];
 pages=[{catalog:[{id:request.entryId,title:'Fixture',username:'example',fillEligible:true,origins:[request.origin]}]},{required:false},{verified:true,requestId:request.id,sessionBinding:'B'.repeat(43),unused:'unprojected'}];
 assert.deepEqual(await fill.nativeApprovalDetails('owner',safe,signal),{account:'Fixture · example',required:false});
 assert.deepEqual(await fill.verifyNativeApproval('owner',safe,'',signal),{requestId:request.id,binding:'B'.repeat(43),context});
 assert.deepEqual(nativeCalls,[['owner',request.apiOrigin,{operation:'catalog'}],['owner',request.apiOrigin,{operation:'verification-status',context}],['owner',request.apiOrigin,{operation:'verify-passkey',requestId:request.id,context}]]);
});

test('the GNOME approval requires a fresh confirmation and is unavailable to the extension request validator',async()=>{
 nativeCalls=[];
 const request={...nativeRequest(),type:'native-consumer',consumerId:'org.gnome.keyring'};
 const signal=new AbortController().signal;
 assert.throws(()=>fill.validateVaultRequest({...request,origin:'https://login.example',target:{tabId:1,frameId:0,documentId:'fixture'}}));
 assert.throws(()=>fill.validateNativeApprovalRequest({...request,consumerId:'other'},'owner'));
 const safe=fill.validateNativeApprovalRequest(request,'owner');
 assert.throws(()=>fill.verifyNativeApproval('owner',safe,'',signal));
 pages=[{verified:true,requestId:request.id,sessionBinding:'B'.repeat(43)}];
 assert.deepEqual(await fill.verifyNativeApproval('owner',safe,'synthetic-confirmation-input',signal),{requestId:request.id,binding:'B'.repeat(43)});
 assert.deepEqual(nativeCalls,[['owner',request.apiOrigin,{operation:'verify-passkey',requestId:request.id,password:'synthetic-confirmation-input'}]]);
});
