import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.env.TT_PROVIDER_METADATA_API_URL,playwrightPath=process.env.TT_SHARED_PLAYWRIGHT_PATH,artifacts=process.env.TT_PROVIDER_METADATA_API_ARTIFACTS;
// Opt-in loopback fixture only. Accounts and values are synthetic; all setup and
// cleanup use the real API, never Mongo. No existing account is inspected.
test('account metadata and selected reveals have exact versions while anonymous, stale-account and cross-origin requests are refused', {skip:!base||!playwrightPath||!artifacts,timeout:120_000},async()=>{
 const url=new URL(base!);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.ok(!url.username&&!url.password);
 const {request}=await import(playwrightPath!);
 const origin=url.origin,headers={Origin:origin},context=await request.newContext({baseURL:origin}),anonymous=await request.newContext({baseURL:origin});
const evidence: any={fixtureOnly:true,checks:[]},created=[];
const check=async(response,label,status=200)=>{evidence.checks.push({label,status:response.status()});assert.equal(response.status(),status,label);return response.json();};
try{
 await check(await anonymous.post('/api/v1/lopu/vault',{headers,data:{action:'sync-metadata',expectedOwnerId:'nobody'}}),'anonymous metadata refusal',401);
 const username='vaultmeta-'+randomUUID().slice(0,8),password=randomUUID()+randomUUID();
 const signup=await check(await context.post('/api/v1/auth/register',{headers,data:{username,email:username+'@example.test',password}}),'disposable account');const ownerId=signup.user.id;
 const group=await check(await context.post('/api/v1/lopu/vault',{headers,data:{action:'create-group',name:'Synthetic metadata environment'}}),'create environment');created.push(group.group.id);
 const value='  synthetic retained provider metadata fixture\n';
 const saved=await check(await context.post('/api/v1/lopu/vault',{headers,data:{action:'save-secret',name:'Metadata fixture',key:'FIXTURE_KEY',value,groupId:group.group.id}}),'create private synthetic secret');const id=saved.entry.id;created.push(id);
 const metadata=async()=>{const r=await context.post('/api/v1/lopu/vault',{headers,data:{action:'sync-metadata',expectedOwnerId:ownerId}});assert.equal(r.headers()['cache-control'],'private, no-store');return check(r,'complete metadata snapshot');};
 const first=await metadata();assert.equal(first.ownerId,ownerId);assert.equal(first.complete,true);assert.equal(first.groups.length,1);assert.equal(first.entries.length,1);assert.match(first.entries[0].version,/^vault-state-v1:[a-f0-9]{64}$/);assert.ok(!JSON.stringify(first).includes(value));assert.ok(!JSON.stringify(first).includes('cipherText'));
 const reveal=async()=>{const r=await context.post('/api/v1/vault/reveal',{headers,data:{vault:'personal',id,action:'reveal',password,includeVersion:true}});assert.match(r.headers()['cache-control'],/private, no-store/);const result=await check(r,'fresh selected versioned reveal');assert.equal(result.value,value);return result;};
 assert.equal((await reveal()).version,first.entries[0].version);
 const before=await check(await context.get('/api/v1/things',{params:{id}}),'read fixture own Thing');
 await check(await context.patch('/api/v1/things',{headers,data:{id,expectedUpdatedAt:before.thing.updatedAt,crystal:{name:'Changed through generic editor'}}}),'generic edit');
 const second=await metadata();assert.equal(second.entries[0].name,'Changed through generic editor');assert.notEqual(second.entries[0].version,first.entries[0].version);assert.equal((await reveal()).version,second.entries[0].version);
 await check(await context.post('/api/v1/vault/reveal',{headers,data:{vault:'personal',id,action:'reveal',password:'wrong synthetic password',includeVersion:true}}),'wrong password cannot reveal',401);
 const wrongOwner=await check(await context.post('/api/v1/lopu/vault',{headers,data:{action:'sync-metadata',expectedOwnerId:'different-owner'}}),'wrong account fence',409);assert.equal(wrongOwner.code,'ACTOR_CHANGED');
 const actor=await check(await context.post('/api/v1/lopu/vault',{headers:{...headers,'X-Thingtime-Expected-Actor':'different-owner'},data:{action:'sync-metadata',expectedOwnerId:ownerId}}),'expected actor header refusal',409);assert.equal(actor.code,'ACTOR_CHANGED');
 const plane=await check(await context.post('/api/v1/lopu/vault',{headers:{...headers,'X-Thingtime-Expected-Data-Plane':'custom-'+'a'.repeat(64)},data:{action:'sync-metadata',expectedOwnerId:ownerId}}),'expected data plane refusal',409);assert.equal(plane.code,'DATA_PLANE_CHANGED');
 await check(await context.post('/api/v1/lopu/vault',{headers:{Origin:'https://different.example'},data:{action:'sync-metadata',expectedOwnerId:ownerId}}),'cross-origin refusal',403);
 for(const item of [...created].reverse())await check(await context.post('/api/v1/lopu/vault',{headers,data:{action:'delete',id:item}}),'delete fixture entry');created.length=0;
 const empty=await metadata();assert.deepEqual(empty.entries,[]);assert.deepEqual(empty.groups,[]);
 evidence.complete=true;evidence.metadataContainsSecrets=false;evidence.genericEditsChangeVersion=true;evidence.selectedValueMatchesExactMetadataVersion=true;
 await mkdir(artifacts!, {recursive:true});await writeFile(resolve(artifacts!, 'verification.json'),JSON.stringify(evidence,null,2));
}finally{
 for(const id of [...created].reverse())await context.post('/api/v1/lopu/vault',{headers,data:{action:'delete',id}}).catch(()=>{});
 await context.dispose();await anonymous.dispose();
}

});
