import assert from 'node:assert/strict';
import {mock} from 'node:test';
import Module from 'node:module';
import * as originals from '../mongodb/collections.ts';
import {toBin} from '../auth/binary.ts';
import {ACL_OWNER,COLLECTION_SCHEMA_VERSIONS,USER_STORAGE_LEDGER_ENVELOPE_VERSION} from '../../../schemas/registry.ts';
import {USER_STORAGE_ACCOUNTING_VERSION,USER_STORAGE_STATUS} from '../storage/storageCore.ts';
import {subscriptionShareId} from '../subscriptions/subscriptionIdentity.ts';
import {subscriptionTierById} from '../subscriptions/tierCatalog.ts';
const id='111111111111111111111111',now=new Date('2026-11-12T00:00:00Z'),tier=subscriptionTierById('free'),calls:any[]=[];
const ledger={_id:'ledger',shareId:subscriptionShareId('user',id),schemaVersion:COLLECTION_SCHEMA_VERSIONS.things,thingtime:['subscription'],ownerId:id,acl:[ACL_OWNER],targetId:null,tags:[],storageLedgerEnvelopeVersion:USER_STORAGE_LEDGER_ENVELOPE_VERSION,createdAt:now,updatedAt:now,crystal:{quotaKind:'subscription',subjectType:'user',subjectId:id,tier:tier.id,tierVersionId:tier.versionId,tierVersion:tier.version,tierName:tier.title,tierMetered:tier.metered,tierQuotas:tier.quotas,overrides:null,note:'own-note',updatedBy:'system',isDefaultAssignment:true,storageUsedBytes:31,storageAccountingVersion:USER_STORAGE_ACCOUNTING_VERSION,storageLedgerStatus:USER_STORAGE_STATUS.ready,storageReconciledAt:now,storageUpdatedAt:now}};
const user={shareId:id,secure:toBin(JSON.stringify({accountKind:'user',meta:{}}))};
mock.module(new URL('../mongodb/collections.ts',import.meta.url).href,{defaultExport:{},namedExports:{...originals,getHomeThingsCollection:async()=>({
 findOne:async(filter:any,options:any)=>{calls.push(['findOne',filter,options]);return ledger;},
 find:(filter:any,options:any)=>{calls.push(['find',filter,options]);return{toArray:async()=>filter.thingtime==='subscription'?[ledger]:[user]};}
})}});
const load=(Module as any)._load;(Module as any)._load=function(name:string,...args:unknown[]){if(name==='node:sqlite'||name.includes('nativeSubscriptions'))throw Error('Hosted subscription imported native persistence');return Reflect.apply(load,this,[name,...args]);};
const {getSubscription,getSubscriptions}=await import('../subscriptions/subscriptions.ts');
const single=await getSubscription('user',id);assert.equal(single.storage!.usedBytes,31);assert.equal(single.note,'own-note');assert.equal(single.storage!.status,'ready');
assert.deepEqual(calls,[['findOne',{shareId:ledger.shareId,thingtime:'subscription'},undefined],['find',{thingtime:'user',shareId:{$in:[id]}},{projection:{shareId:1,secure:1}}]]);
calls.length=0;const batch=await getSubscriptions('user',[id,id]);assert.equal(batch.size,1);assert.deepEqual(batch.get(id),single);
assert.deepEqual(calls,[['find',{thingtime:'subscription',shareId:{$in:[ledger.shareId]}},undefined],['find',{thingtime:'user',shareId:{$in:[id]}},{projection:{shareId:1,initialSubscription:1}}],['find',{thingtime:'user',shareId:{$in:[id]}},{projection:{shareId:1,secure:1}}]]);
console.log('hosted-subscription-operations-ok');
