import assert from 'node:assert/strict';
import {mock} from 'node:test';
import Module from 'node:module';
import * as collections from '../mongodb/collections.ts';
import * as users from '../auth/users.ts';
import * as tiers from '../subscriptions/tierCatalogStore.ts';
import * as subscriptions from '../subscriptions/subscriptions.ts';
import {DEFAULT_SUBSCRIPTION_TIER,SUBSCRIPTION_TIER_CATALOG} from '../subscriptions/tierCatalog.ts';
import {verifyPassword} from '../auth/passwords.ts';
const calls:string[]=[],session={mongoTransaction:'synthetic'},tier=SUBSCRIPTION_TIER_CATALOG.find(t=>t.id===DEFAULT_SUBSCRIPTION_TIER)!;
let captured:any,assignment:any;
mock.module(new URL('../mongodb/collections.ts',import.meta.url).href,{defaultExport:{},namedExports:{...collections,
 ensureIndexes:async()=>{calls.push('ensure');},withHomeMongoTransaction:async(work:any)=>{calls.push('transaction-start');await work(session);calls.push('transaction-end');}
}});
mock.module(new URL('../auth/users.ts',import.meta.url).href,{defaultExport:{},namedExports:{...users,
 findUserByUsername:async()=>null,findUserByEmail:async()=>null,
 insertUser:async(doc:any,options:any)=>{calls.push('identity');captured={doc,options};assert.equal(options.session,session);return{...doc,_id:'synthetic-mongo-owner'};},
 toPublicUser:(user:any,subscription:any)=>({id:String(user._id),username:user.username,subscriptionMarker:subscription.marker})
}});
mock.module(new URL('../subscriptions/tierCatalogStore.ts',import.meta.url).href,{defaultExport:{},namedExports:{...tiers,getLiveSubscriptionTier:async()=>tier}});
mock.module(new URL('../subscriptions/subscriptions.ts',import.meta.url).href,{defaultExport:{},namedExports:{...subscriptions,setSubscription:async(input:any)=>{calls.push('ledger');assignment=input;return{ok:true,subscription:{marker:'canonical-assignment'}};}}});
const load=(Module as any)._load;(Module as any)._load=function(name:string,...args:unknown[]){if(name==='node:sqlite'||name.includes('nativeAccountCreation')||name.includes('nativeAccountTransaction'))throw Error('Hosted auth imported native persistence');return Reflect.apply(load,this,[name,...args]);};
const {createUserAccount}=await import('../auth/registerUser.ts');
const password='Synthetic fixture phrase';let callback=false;
const result=await createUserAccount({username:' MiXeD ',email:' MIXED@EXAMPLE.INVALID ',password,storageAllowanceBytes:42,meta:{admin:true,publicUploads:true,character:{ownerId:'foreign'},safe:'keep'},onCreated:async(user:any,transaction:any)=>{assert.equal(transaction,session);assert.equal(user._id,'synthetic-mongo-owner');callback=true;calls.push('onCreated');}});
assert.equal(result.ok,true);assert.equal(callback,true);assert.deepEqual(calls,['ensure','transaction-start','identity','ledger','onCreated','transaction-end']);assert.equal(captured.doc.username,'mixed');assert.equal(captured.doc.email,'mixed@example.invalid');assert.equal(await verifyPassword(password,captured.doc.passwordHash),true);assert.equal(captured.doc.meta.admin,undefined);assert.equal(captured.doc.meta.character,undefined);assert.equal(captured.doc.meta.publicUploads,false);assert.equal(captured.doc.meta.safe,'keep');assert.equal(captured.options.initialSubscription.versionId,tier.versionId);assert.equal(assignment.session,session);assert.equal(assignment.ownerId,'synthetic-mongo-owner');assert.equal(assignment.subjectId,'synthetic-mongo-owner');assert.equal(assignment.initialStorageUsedBytes,0);assert.deepEqual(assignment.overrides,{userStorageBytes:42});
console.log('canonical-mongo-account-creation-regression-ok');
