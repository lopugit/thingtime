import { BSON } from 'mongodb';
import { types } from 'node:util';
import { registerHomeRepositoryProvider } from '../auth/homeRepositoryScope';
import { characterEntitlementOwnerIds } from '../auth/characterEntitlements';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { subscriptionShareId } from '../subscriptions/subscriptionIdentity';
import { assertSubscriptionRepositoryScope, SubscriptionRepositoryError, type SubscriptionRepository, type UserEntitlementSnapshot } from '../subscriptions/subscriptionRepository';
import type { CollectionProvider, CollectionTransaction } from './collectionContract';
import { defineNativeThingsCollection } from './nativeThingsCollection';
import { currentAccountTransactionContext } from './nativeAccountTransaction';

/** Read-only coherent home snapshot. Two bounded-in-processing scans (requested
 * records, then one owner hop), with no row/product ceiling or query facade.
 * Current OR matching costs O(rows * requested keys); this does not claim
 * native indexes or
 * support for Character storage synchronization/entitlement mutation. */
export async function createNativeSubscriptionRepository(provider:CollectionProvider,homePlaneId:string):Promise<SubscriptionRepository>{
 if(typeof homePlaneId!=='string'||!homePlaneId)throw new SubscriptionRepositoryError('SUBSCRIPTION_REPOSITORY_SCOPE','A native home profile is required');
 await provider.transaction(defineNativeThingsCollection);
 const namespace=physicalCollectionName('things');let repository:SubscriptionRepository;
 const snapshot=(collections:CollectionTransaction,ids:readonly string[]):UserEntitlementSnapshot=>{
  const users=new Map<string,Record<string,any>>(),subscriptions=new Map<string,Record<string,any>>();
  const read=(selected:readonly string[])=>{
   if(!selected.length)return;
   const keys=[...new Set(selected.flatMap(id=>[id,subscriptionShareId('user',id)]))];
   const rows=collections.collection(namespace).find({filter:{op:'or',filters:keys.map(value=>({op:'eq',path:['shareId'],value}))},limit:keys.length+1}).documents;
   for(const bytes of rows){const row=BSON.deserialize(bytes),id=String(row.shareId);if(selected.includes(id))users.set(id,row);else subscriptions.set(id,row);}
  };
  read(ids);read(characterEntitlementOwnerIds([...users.values()]));return{users,subscriptions};
 };
 repository=Object.freeze({homePlaneId,async readUserEntitlements(input:readonly string[]){
  const identities=assertSubscriptionRepositoryScope(repository);
  // Do not invoke getters/iterators from an internal caller's forged list.
  if(types.isProxy(input)||!Array.isArray(input)||Object.getPrototypeOf(input)!==Array.prototype||Reflect.ownKeys(input).some(key=>key!=='length'&&(typeof key!=='string'||!/^\d+$/.test(key)||!Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(input,key)!,'value'))))throw new SubscriptionRepositoryError('SUBSCRIPTION_UNAVAILABLE','Invalid subscription read identities');
  const ids=[...new Set(input)];if(ids.some(id=>typeof id!=='string'||!id))throw new SubscriptionRepositoryError('SUBSCRIPTION_UNAVAILABLE','Invalid subscription read identities');
  const active=currentAccountTransactionContext(provider,identities);
  if(active){const result=snapshot(active.collections,ids);assertSubscriptionRepositoryScope(repository);return result;}
  return provider.transaction(async collections=>{assertSubscriptionRepositoryScope(repository);const result=snapshot(collections,ids);await Promise.resolve();assertSubscriptionRepositoryScope(repository);return result;});
 }});
 registerHomeRepositoryProvider(repository,provider);return repository;
}
