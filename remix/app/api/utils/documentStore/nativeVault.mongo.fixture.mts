import assert from 'node:assert/strict';
import {mock} from 'node:test';
import Module from 'node:module';
import {Binary} from 'mongodb';
import * as originals from '../mongodb/collections.ts';
let row:any;const updates:any[]=[];
mock.module(new URL('../mongodb/collections.ts',import.meta.url).href,{defaultExport:{},namedExports:{...originals,
 getHomeThingsCollection:async()=>({findOne:async(filter:any,options:any)=>{assert.deepEqual(filter,{shareId:row.shareId,thingtime:'user'});assert.equal(options.projection.secure,1);return{_id:row._id,secure:row.secure,...(options.projection.secureVersion?{secureVersion:row.secureVersion}:{})};},updateOne:async(filter:any,update:any)=>{updates.push({filter,update});assert.equal(filter.secureVersion,row.secureVersion);row={...row,...update.$set};return{modifiedCount:1};}}),
 getUsersCollection:async()=>{throw Error('Unexpected legacy fallback');},
 getSessionsCollection:async()=>({updateOne:async(filter:any,update:any)=>{updates.push({filter,update});return{matchedCount:1};}})
}});
const load=(Module as any)._load;(Module as any)._load=function(name:string,...args:unknown[]){if(name==='node:sqlite'||name.includes('nativeUserIdentities')||name.includes('nativeSessions'))throw Error('Hosted vault imported native persistence');return Reflect.apply(load,this,[name,...args]);};
const {buildUserSecure,readUserVaultKey,mutateUserVaultKey}=await import('../auth/users.ts');
const owner='111111111111111111111111';row={_id:'mongo-id',shareId:owner,secureVersion:0,secure:buildUserSecure({email:'synthetic@example.invalid',passwordHash:'synthetic-hash',emailVerified:false,meta:{keep:true}}).secure};
assert.equal(await readUserVaultKey(owner),null);
const registry={version:1 as const,mode:'server-assisted' as const,keyId:'synthetic-persistence-only',recovery:{cipherText:'not-crypto',iv:'not-crypto',tag:'not-crypto'}};
await mutateUserVaultKey(owner,async(current,hash)=>{assert.equal(current,null);assert.equal(hash,'synthetic-hash');return{registry};});
assert.equal(row.secureVersion,1);assert.equal((await readUserVaultKey(owner))!.keyId,registry.keyId);assert.deepEqual(updates[0].filter,{shareId:owner,thingtime:'user',secureVersion:0});assert.ok(updates[0].update.$set.updatedAt instanceof Date);
const {currentSessionRepository}=await import('../auth/sessionRepository.ts'),expiresAt=new Date(Date.now()+60000),envelope=new Binary(Buffer.from('synthetic-envelope'));
assert.equal(await currentSessionRepository().bindVaultEnvelope({jti:'session',ownerId:owner,expiresAt,at:new Date(),envelope}),true);
assert.deepEqual(updates[1],{filter:{jti:'session',userId:owner,revokedAt:null,expiresAt},update:{$set:{secureVaultKey:envelope}}});
console.log('hosted-vault-mongo-shapes-ok');
