import { BSON } from 'mongodb';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { assertAccountCreationRepositoryScope, withAccountCreationRepository, nativeAccountUnsupported, AccountCreationRepositoryError, type AccountCreationRepository } from '../auth/accountCreationRepository';
import { userSubscriptionLedgerEnvelopeIsTrusted, subscriptionShareId } from '../subscriptions/subscriptionIdentity';
import type { CollectionFilter, CollectionProvider, CollectionTransaction } from './collectionContract';
import { createNativeHomeAuthRepositories } from './nativeUserIdentities';
import { accountOperation, accountTransactionContext, currentAccountTransactionContext, withNativeAccountTransaction } from './nativeAccountTransaction';
import { encodeCollectionDocument } from './collectionProvider';

/** Explicit internal home profile only: no runtime selection or HTTP activation.
 * Catalog bootstrapping is provider-scoped and atomic. Identity + initial
 * ledger share one real SQLite transaction and the canonical envelope builder.
 * No Mongo expressions, tier-publish recovery, vault/outbox or roster substitute.
 * Semantic lookups scan rows; there are no kind-specific native index policies. */
export async function createNativeAccountCreationRepositories(provider:CollectionProvider,homePlaneId:string){
 const auth=await createNativeHomeAuthRepositories(provider,homePlaneId),namespace=physicalCollectionName('things');
 let repository:AccountCreationRepository;
 const transaction=<T>(work:(collections:CollectionTransaction)=>T):Promise<T>=>{
  assertAccountCreationRepositoryScope(repository);
  const active=currentAccountTransactionContext(provider,auth.identities);
  if(active)return Promise.resolve(accountOperation(active,()=>work(active.collections)));
  return provider.transaction(collections=>{assertAccountCreationRepositoryScope(repository);return work(collections);});
 };
 const eq=(path:string[],value:string):CollectionFilter=>({op:'eq',path,value});
 const read=(collections:CollectionTransaction,filter:CollectionFilter)=>collections.collection(namespace).find({filter,limit:2}).documents.map(bytes=>BSON.deserialize(bytes));
 const one=(rows:Record<string,any>[])=>{if(rows.length>1)nativeAccountUnsupported();return rows[0]??null;};
 repository=Object.freeze({
  homePlaneId,
  async ensureReady(){assertAccountCreationRepositoryScope(repository);},
  async transaction<T>(work:(transaction:unknown)=>Promise<T>):Promise<T>{assertAccountCreationRepositoryScope(repository);return withNativeAccountTransaction(provider,auth.identities,async handle=>{const result=await work(handle);assertAccountCreationRepositoryScope(repository);return result;});},
  async bootstrapTiers(documents,acceptsExisting){
   await transaction(collections=>{
    const things=collections.collection(namespace);
    for(const document of documents){
     const bytes=encodeCollectionDocument(document,'shareId'),expected=BSON.deserialize(bytes);
     const existing=one(read(collections,eq(['shareId'],expected.shareId)));
     if(existing){if(!acceptsExisting(existing,expected))throw new AccountCreationRepositoryError('ACCOUNT_CREATION_UNSUPPORTED','Reserved subscription tier id is occupied by an incompatible Thing');}
     else things.insert(bytes);
    }
   });
  },
  async findTierVersion(id){return transaction(collections=>one(read(collections,{op:'and',filters:[eq(['shareId'],id),{op:'contains',path:['thingtime'],value:'subscription-tier'}]})));},
  async findLiveTier(id,versionId){return transaction(collections=>{
   const base:CollectionFilter={op:'and',filters:[{op:'contains',path:['thingtime'],value:'subscription-tier'},eq(['crystal','tierId'],id)]};
   // A transition must be completed by a real publishing adapter, never treated
   // as a missing live tier or repaired by a synthetic default.
   if(read(collections,{op:'and',filters:[base,{op:'exists',path:['crystal','publishIntent'],value:true}]}).length)nativeAccountUnsupported();
   return one(read(collections,{op:'and',filters:[base,eq(['crystal','status'],'live'),...(versionId?[eq(['shareId'],versionId)]:[])]}));
  });},
  assertInitialSubscription(input){
   assertAccountCreationRepositoryScope(repository);
   const context=accountTransactionContext(input.session,provider,auth.identities);
   accountOperation(context,()=>{
    if(input.subjectType!=='user'||input.initialStorageUsedBytes!==0||input.isDefaultAssignment!==true||input.updatedBy!=='system'||input.subjectId!==context.ownerId||input.ownerId!==context.ownerId||context.ledgerWritten)nativeAccountUnsupported();
   });
  },
  async insertInitialSubscription(document,handle){
   assertAccountCreationRepositoryScope(repository);const context=accountTransactionContext(handle,provider,auth.identities);
   accountOperation(context,()=>{
    const bytes=encodeCollectionDocument(document,'shareId'),row=BSON.deserialize(bytes),owner=context.ownerId;
    if(!owner||context.ledgerWritten||row.shareId!==subscriptionShareId('user',owner)||!userSubscriptionLedgerEnvelopeIsTrusted(row,owner)||row.crystal.storageUsedBytes!==0)nativeAccountUnsupported();
    context.collections.collection(namespace).insert(bytes);context.ledgerWritten=true;
   });
  }
 });
 return Object.freeze({...auth,accountCreation:repository,run:<T>(work:()=>T|Promise<T>)=>auth.run(()=>withAccountCreationRepository(repository,auth.identities,work))});
}
