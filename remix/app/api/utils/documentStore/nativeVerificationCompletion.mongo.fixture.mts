// Hosted call-order regression, not real Mongo persistence acceptance.
import assert from 'node:assert/strict';
import {mock} from 'node:test';
import * as collections from '../mongodb/collections.ts';
import * as users from '../auth/users.ts';
const token='a'.repeat(64),calls:string[]=[];
let used=false,failMark=false;
const row={token,userId:'synthetic-hosted-owner',email:'hosted@example.invalid',schemaVersion:2,createdAt:new Date(),expiresAt:new Date(Date.now()+60000),consumedAt:null};
mock.module(new URL('../mongodb/collections.ts',import.meta.url).href,{defaultExport:{},namedExports:{...collections,getEmailVerificationsCollection:async()=>({
 findOneAndUpdate:async(filter:any,update:any,options:any)=>{
  calls.push('claim');assert.equal(filter.token,token);assert.equal(filter.consumedAt,null);assert.ok(filter.expiresAt.$gt instanceof Date);assert.ok(update.$set.consumedAt instanceof Date);assert.deepEqual(options,{returnDocument:'after'});
  if(used)return null;used=true;return {...row,consumedAt:new Date()};
 },findOne:async()=>({...row,consumedAt:used?new Date():null})
})}});
mock.module(new URL('../auth/users.ts',import.meta.url).href,{defaultExport:{},namedExports:{...users,
 markEmailVerified:async(id:string,expectedEmail?:string)=>{calls.push('mark');assert.equal(id,row.userId);assert.equal(expectedEmail,undefined);if(failMark)throw Error('synthetic hosted mark failure');return false;}
}});
const {completeEmailVerification}=await import('../auth/emailVerifications.ts');
assert.deepEqual(await completeEmailVerification(token),{ok:true,userId:row.userId,email:row.email});assert.deepEqual(calls,['claim','mark']);
assert.deepEqual(await completeEmailVerification(token),{ok:false,reason:'used'});assert.deepEqual(calls,['claim','mark','claim']);
used=false;failMark=true;await assert.rejects(completeEmailVerification(token),/synthetic hosted mark failure/);assert.deepEqual(await completeEmailVerification(token),{ok:false,reason:'used'});
console.log('hosted-email-completion-order-preserved');
