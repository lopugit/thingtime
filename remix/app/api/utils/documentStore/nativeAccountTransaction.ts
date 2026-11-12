import { AsyncLocalStorage } from 'node:async_hooks';
import { AccountCreationRepositoryError } from '../auth/accountCreationRepository';
import { assertUserIdentityRepositoryScope, type UserIdentityRepository } from '../auth/userIdentityRepository';
import type { CollectionProvider, CollectionTransaction } from './collectionContract';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { BSON } from 'mongodb';

type Context={active:boolean;provider:CollectionProvider;identities:UserIdentityRepository;collections:CollectionTransaction;ownerId:string|null;ledgerWritten:boolean;failed:boolean;failure:unknown};
const contexts=new WeakMap<object,Context>(),current=new AsyncLocalStorage<Context>();
const refused=():never=>{const error=new AccountCreationRepositoryError('ACCOUNT_CREATION_SCOPE','Native account transaction home, owner or lifetime mismatch');const context=current.getStore();if(context?.active){context.failed=true;context.failure=error;}throw error;};
const validate=(context:Context|undefined,provider:CollectionProvider,identities:UserIdentityRepository)=>{
 if(!context||!context.active||context!==current.getStore()||context.provider!==provider||context.identities!==identities)return refused();
 assertUserIdentityRepositoryScope(identities);if(context.failed)throw context.failure;return context;
};
export const accountTransactionContext=(handle:unknown,provider:CollectionProvider,identities:UserIdentityRepository)=>validate(handle&&typeof handle==='object'?contexts.get(handle):undefined,provider,identities);
export const currentAccountTransactionContext=(provider:CollectionProvider,identities:UserIdentityRepository):Context|null=>{
 const context=current.getStore();return context?validate(context,provider,identities):null;
};
/** Errors poison commit even when an internal caller catches them. Handles
 * remain recognized after expiry and cannot be reused in another transaction. */
export async function withNativeAccountTransaction<T>(provider:CollectionProvider,identities:UserIdentityRepository,work:(handle:unknown)=>Promise<T>):Promise<T>{
 assertUserIdentityRepositoryScope(identities);if(current.getStore())return refused();
 return provider.transaction(async collections=>{
  assertUserIdentityRepositoryScope(identities);
  const context:Context={active:true,provider,identities,collections,ownerId:null,ledgerWritten:false,failed:false,failure:undefined},handle=Object.freeze({kind:'native-account-creation'});contexts.set(handle,context);
  return current.run(context,async()=>{try{const result=await work(handle);assertUserIdentityRepositoryScope(identities);if(context.failed)throw context.failure;if(!context.ownerId||!context.ledgerWritten)return refused();return result;}finally{context.active=false;}});
 });
}
export const accountOperation=<T>(context:Context,work:()=>T):T=>{try{return work();}catch(error){context.failed=true;context.failure=error;throw error;}};
export const insertNativeAccountIdentity=(provider:CollectionProvider,identities:UserIdentityRepository,handle:unknown,encode:()=>Uint8Array):void=>{
 const context=accountTransactionContext(handle,provider,identities);
 accountOperation(context,()=>{
  if(context.ownerId)return refused();
  const bytes=encode();
  const row=BSON.deserialize(bytes);if(typeof row.shareId!=='string'||row.ownerId!==row.shareId)return refused();
  context.collections.collection(physicalCollectionName('things')).insert(bytes);context.ownerId=row.shareId;
 });
};
