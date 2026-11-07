import assert from 'node:assert/strict';
import test from 'node:test';
import { projectUserVaultMetadata } from './userVaultMetadata';
const time='2026-10-17T00:00:00.000Z';
const group=()=>({_id:'database-group',shareId:'fixture-group',ownerId:'owner',thingtime:['data'],updatedAt:new Date(time),crystal:{systemType:'tt.lopuUserVault',recordKind:'group',name:'Environment',createdAt:time,updatedAt:time}});
const secret=()=>({...group(),_id:'database-secret',shareId:'fixture-secret',crystal:{...group().crystal,recordKind:'secret',name:'Secret',key:'KEY',groupId:'fixture-group',encryptedValue:{cipherText:'sealed-value-never-returned',iv:'sealed-iv',tag:'sealed-tag'},arbitrary:'private generic field',value:'hostile plaintext must not leave projection'}});
test('complete snapshots whitelist metadata, never ciphertext or generic fields, and detect generic edits',async()=>{
 const before=await projectUserVaultMetadata('owner',[group(),secret()]);assert.equal(before.complete,true);assert.equal(before.entries.length,1);
 const text=JSON.stringify(before);for(const privateText of ['sealed-value','sealed-iv','sealed-tag','private generic field','hostile plaintext','ownerId','_id'])assert.ok(!text.includes(privateText));
 const updated=secret();updated.crystal.name='Changed generically';const after=await projectUserVaultMetadata('owner',[group(),updated]);
 assert.notEqual(before.entries[0].version,after.entries[0].version);assert.equal(before.entries[0].updatedAt,after.entries[0].updatedAt);
});
test('malformed, foreign, duplicate and orphaned saved metadata fails without a partial response',async()=>{
 for(const docs of [[{...secret(),ownerId:'foreign'}],[group(),group()],[secret()],[group(),{...secret(),crystal:{...secret().crystal,recordKind:'unknown'}}],[{...group(),crystal:{...group().crystal,createdAt:'invalid'}}],[group(),{...secret(),crystal:{...secret().crystal,encryptedValue:null}}]])
  await assert.rejects(projectUserVaultMetadata('owner',docs as any),/metadata is invalid/);
});
test('bounded iteration rejects the 501st row without consuming the remaining cursor',async()=>{
 let reads=0;async function* rows(){for(let index=0;index<1000;index++){reads++;yield {...group(),_id:'db-'+index,shareId:'group-'+index+'-fixture'};}}
 await assert.rejects(projectUserVaultMetadata('owner',rows()),/snapshot limit/);assert.equal(reads,501);
});
