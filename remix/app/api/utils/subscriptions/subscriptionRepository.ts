import { AsyncLocalStorage } from 'node:async_hooks';
import { currentUserIdentityRepository, userIdentityScopeToken, type UserIdentityRepository } from '../auth/userIdentityRepository';
import { assertSameHomeRepositoryProvider } from '../auth/homeRepositoryScope';

export type UserEntitlementSnapshot = {
 users: ReadonlyMap<string, Record<string, any>>;
 subscriptions: ReadonlyMap<string, Record<string, any>>;
};
/** Semantic read snapshot, never a Mongo driver/query facade. Mutation and
 * native API selection remain separate capabilities. */
export interface SubscriptionRepository {
 readonly homePlaneId: string;
 readUserEntitlements(userIds: readonly string[]): Promise<UserEntitlementSnapshot>;
}
export class SubscriptionRepositoryError extends Error {
 readonly status = 503;
 constructor(public readonly code: 'SUBSCRIPTION_REPOSITORY_SCOPE' | 'SUBSCRIPTION_UNAVAILABLE', message: string) { super(message); this.name='SubscriptionRepositoryError'; }
}
export const nativeSubscriptionUnavailable = (): never => { throw new SubscriptionRepositoryError('SUBSCRIPTION_UNAVAILABLE','The account subscription is unavailable.'); };
const refused=():never=>{throw new SubscriptionRepositoryError('SUBSCRIPTION_REPOSITORY_SCOPE','Subscription repository does not match the active home profile or request');};
const scopes=new AsyncLocalStorage<{repository:SubscriptionRepository;identities:UserIdentityRepository;token:object;active:boolean}>();
export const currentSubscriptionRepository=():SubscriptionRepository|null=>{
 const scope=scopes.getStore();if(scope&&!scope.active)return refused();
 const identities=currentUserIdentityRepository();
 if(scope){
  if(!identities||identities!==scope.identities||scope.token!==userIdentityScopeToken(identities)||scope.repository.homePlaneId!==identities.homePlaneId)return refused();
  assertSameHomeRepositoryProvider(scope.repository,identities);return scope.repository;
 }
 if(identities)return refused();
 return null;
};
export const assertSubscriptionRepositoryScope=(repository:SubscriptionRepository):UserIdentityRepository=>{
 if(currentSubscriptionRepository()!==repository)return refused();return scopes.getStore()!.identities;
};
export async function withHomeSubscriptionRepository<T>(repository:SubscriptionRepository,work:()=>T|Promise<T>):Promise<T>{
 const identities=currentUserIdentityRepository();
 if(scopes.getStore()||!identities||repository.homePlaneId!==identities.homePlaneId||typeof work!=='function')return refused();
 assertSameHomeRepositoryProvider(repository,identities);
 const scope={repository,identities,token:userIdentityScopeToken(identities),active:true};
 return scopes.run(scope,async()=>{try{return await work();}finally{scope.active=false;}});
}
