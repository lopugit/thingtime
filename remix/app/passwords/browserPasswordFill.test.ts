import assert from 'node:assert/strict';
import {before,mock,test} from 'node:test';
let requirements:string[][]=[],pages:any[]=[],nativeCalls:unknown[][]=[];
mock.module(new URL('../api/utils/capabilities/requireCapability.client.ts',import.meta.url).href,{namedExports:{requireThingtimeCapability:async(...args:string[])=>{requirements.push(args);}}});
mock.module(new URL('./client.ts',import.meta.url).href,{namedExports:{passwordRequest:async()=>pages.shift(),nativePasswordVerificationRequest:async(ownerId:string,origin:string,body:unknown)=>{nativeCalls.push([ownerId,origin,body]);return pages.shift();}}});
let fill:any;
before(async()=>{fill=await import('./browserPasswordFill');});
test('browser fill requires corrected website contract and reads every catalog page without secret fields',async()=>{
 const userinfoUrl=new URL('https://thingtime.com');
 userinfoUrl.username='synthetic';
 userinfoUrl.password=crypto.randomUUID();
 const unprojectedPassword=crypto.randomUUID();
 requirements=[];pages=[{catalog:[{id:'one',title:'Other',username:'other',fillEligible:true,domains:['other.test'],password:unprojectedPassword}],nextCursor:'two'}, {catalog:[{id:'two',title:'Selected',username:'selected',fillEligible:true,domains:['thingtime.com'],origins:['https://thingtime.com:8443','https://thingtime.com/path',userinfoUrl.href],password:unprojectedPassword}]}];
 const r=fill.validateVaultRequest({version:1,id:crypto.randomUUID(),type:'catalog',origin:'https://thingtime.com',target:{tabId:1,frameId:0,documentId:'fixture'}});
 const catalog=await fill.loadPasswordCatalog('owner',r,new AbortController().signal);
 assert.deepEqual(requirements,[['api.passwords','1.6.1']]);assert.deepEqual(catalog.map((row:any)=>row.id),['one','two']);assert.equal(JSON.stringify(catalog).includes(unprojectedPassword),false);
 assert.equal('origins' in catalog[0],false,'An older catalog can still use hostname hints');
 assert.deepEqual(catalog[1].origins,['https://thingtime.com:8443'],'Only canonical exact origins cross the extension boundary');
 const controller=new AbortController();controller.abort();await assert.rejects(fill.loadPasswordCatalog('owner',r,controller.signal));
});

test('selecting a login stops discovery as soon as that exact eligible entry is found',async()=>{
 pages=[{catalog:[{id:'other',fillEligible:true}],nextCursor:'second'},
  {catalog:[{id:'selected',title:'Selected',fillEligible:true}],nextCursor:'remaining'},
  {catalog:[{id:'later',fillEligible:true}]}];
 const selected=await fill.loadPasswordCatalog('owner',{type:'fill',entryId:'selected'},new AbortController().signal);
 assert.deepEqual(selected.map((row:any)=>row.id),['selected']);
 assert.equal(pages.length,1,'An exact selection never scans unrelated later pages');
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
