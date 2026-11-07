import assert from 'node:assert/strict';
import test from 'node:test';
import { createVaultMetadataResponse } from './metadata';
import { withInternalRequestActor } from '~/api/utils/auth/internalRequestActor';
const origin='https://thingtime.example',account={user:{id:'owner',temporary:false,accountKind:'full'},claims:{jti:'fixture-session'}};
const request=(headers={})=>new Request(origin+'/api/v1/lopu/vault',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers}});
const body={action:'sync-metadata',expectedOwnerId:'owner'};
function fixture(overrides:any={}){let reads=0;return {readCount:()=>reads,run:createVaultMetadataResponse({getAuthToken:async()=> 'session',resolveTokenUser:async()=>account as any,listUserVaultMetadata:async(owner:string)=>{assert.equal(owner,'owner');reads++;return {complete:true,groups:[],entries:[]};},...overrides})};}
test('metadata requires current matching account and same origin before reading and stays private',async()=>{
 const f=fixture();const response=await f.run(request(),'owner',body);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(await response.json(),{ok:true,ownerId:'owner',complete:true,groups:[],entries:[]});
 for(const [req,owner,payload,overrides] of [[request({Origin:''}),'owner',body,{}],[request({Origin:'https://elsewhere.example'}),'owner',body,{}],[request(),'other',body,{}],[request(),'owner',{...body,expectedOwnerId:'other'},{}],[request(),'owner',{...body,arbitrary:'field'},{}],[request(),'owner',body,{getAuthToken:async()=>null}],[request(),'owner',body,{resolveTokenUser:async()=>({...account,user:{...account.user,temporary:true}})}],[request(),'owner',body,{resolveTokenUser:async()=>({...account,user:{...account.user,accountKind:'service'}})}]] as any[]){
  const blocked=fixture(overrides),result=await blocked.run(req,owner,payload);assert.ok(result.status>=400);assert.equal(blocked.readCount(),0);assert.equal(result.headers.get('Cache-Control'),'private, no-store');
 }
});
test('revocation while loading rejects the response and unexpected errors stay redacted',async()=>{
 let resolutions=0;const f=fixture({resolveTokenUser:async()=>++resolutions===1?account:null});assert.equal((await f.run(request(),'owner',body)).status,401);assert.equal(f.readCount(),1);
 const failed=fixture({listUserVaultMetadata:async()=>{throw Error('secret server details');}}),response=await failed.run(request(),'owner',body);assert.equal(response.status,503);assert.ok(!(await response.text()).includes('secret server details'));
});

test('an internal Action identity cannot authorize metadata synchronization',async()=>{
 const f=fixture(),req=request();
 const response=await withInternalRequestActor(req,async()=>account.user as any,()=>f.run(req,'owner',body));
 assert.equal(response.status,403);assert.equal(f.readCount(),0);
});
