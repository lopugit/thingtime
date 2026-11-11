import { AsyncLocalStorage } from 'node:async_hooks';
import { currentUserIdentityRepository, type UserIdentityRepository } from './userIdentityRepository';
import { assertSameHomeRepositoryProvider } from './homeRepositoryScope';

/** Account-creation persistence only. HTTP activation separately requires the
 * protected host and complete account repository composition. This is not a
 * query/driver facade and never opens SQLite on hosted imports. */
export interface AccountCreationRepository {
 readonly homePlaneId: string;
 ensureReady(): Promise<void>;
 transaction<T>(work: (transaction: unknown) => Promise<T>): Promise<T>;
 bootstrapTiers(documents: readonly Record<string, unknown>[], acceptsExisting: (stored: Record<string, unknown>, expected: Record<string, unknown>) => boolean): Promise<void>;
 findTierVersion(versionId: string): Promise<Record<string, unknown> | null>;
 findLiveTier(tierId: string, versionId: string): Promise<Record<string, unknown> | null>;
 assertInitialSubscription(input: {subjectType: string; subjectId: string; ownerId: string; initialStorageUsedBytes?: number; isDefaultAssignment?: boolean; updatedBy?: string; session?: unknown}): void;
 insertInitialSubscription(document: Record<string, unknown>, transaction: unknown): Promise<void>;
}
export class AccountCreationRepositoryError extends Error {
 constructor(public readonly code: 'ACCOUNT_CREATION_SCOPE' | 'ACCOUNT_CREATION_UNSUPPORTED', message: string) { super(message); this.name='AccountCreationRepositoryError'; }
}
export const nativeAccountUnsupported = (): never => { throw new AccountCreationRepositoryError('ACCOUNT_CREATION_UNSUPPORTED', 'This account operation has no native provider implementation'); };
const unavailable = (): never => { throw new AccountCreationRepositoryError('ACCOUNT_CREATION_SCOPE', 'Account repository does not match the active home transaction'); };
const scopes=new AsyncLocalStorage<{repository:AccountCreationRepository;identities:UserIdentityRepository;active:boolean}>();
export const currentAccountCreationRepository = (): AccountCreationRepository | null => {
 const scope=scopes.getStore();if(scope&&!scope.active)return unavailable();
 const identities=currentUserIdentityRepository();
 if(scope){if(identities!==scope.identities)return unavailable();assertSameHomeRepositoryProvider(scope.repository,identities);return scope.repository;}
 if(identities)return nativeAccountUnsupported();
 return null;
};
export const assertAccountCreationRepositoryScope = (repository:AccountCreationRepository) => {if(currentAccountCreationRepository()!==repository)return unavailable();};
export async function withAccountCreationRepository<T>(repository:AccountCreationRepository,identities:UserIdentityRepository,work:()=>T|Promise<T>):Promise<T>{
 if(scopes.getStore()||currentUserIdentityRepository()!==identities||repository.homePlaneId!==identities.homePlaneId)return unavailable();
 assertSameHomeRepositoryProvider(repository,identities);
 const scope={repository,identities,active:true};return scopes.run(scope,async()=>{try{return await work();}finally{scope.active=false;}});
}
