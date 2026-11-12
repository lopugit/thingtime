import { AsyncLocalStorage } from 'node:async_hooks';
import { assertSameHomeRepositoryProvider } from '../auth/homeRepositoryScope';
import { currentUserIdentityRepository, userIdentityScopeToken, type UserIdentityRepository } from '../auth/userIdentityRepository';
import type { RateLimitConfig } from './config';
import type { RateLimitOutcome } from './enforce';

export type WindowConsumption = { key: string; limit: number; windowMs: number; cost: number; now: Date };
/** Semantic native operations, not a Mongo query facade. No provider is selected
 * implicitly; config cache and failure policy must never cross profiles. */
export interface RateLimitRepository {
 readonly homePlaneId: string;
 readConfig(): Promise<RateLimitConfig>;
 patchConfig(patch: RateLimitConfig, updatedBy: string): Promise<RateLimitConfig>;
 consumeWindow(input: WindowConsumption): Promise<RateLimitOutcome>;
}
export class RateLimitRepositoryError extends Error {
 readonly status = 503;
 constructor(public readonly code: 'RATE_LIMIT_REPOSITORY_SCOPE' | 'RATE_LIMIT_UNAVAILABLE' | 'RATE_LIMIT_UNSUPPORTED', message: string) { super(message); this.name = 'RateLimitRepositoryError'; }
}
const refuse = (): never => { throw new RateLimitRepositoryError('RATE_LIMIT_REPOSITORY_SCOPE', 'Rate limiter does not match the active home profile or request'); };
const scopes = new AsyncLocalStorage<{ repository: RateLimitRepository; identities: UserIdentityRepository; token: object; active: boolean }>();
export const currentRateLimitRepository = (): RateLimitRepository | null => {
 const scope = scopes.getStore(); if (scope && !scope.active) return refuse();
 const identities = currentUserIdentityRepository();
 if (scope) {
  if (!identities || identities !== scope.identities || scope.token !== userIdentityScopeToken(identities) || scope.repository.homePlaneId !== identities.homePlaneId) return refuse();
  assertSameHomeRepositoryProvider(scope.repository, identities); return scope.repository;
 }
 if (identities) return refuse();
 return null;
};
export const assertRateLimitRepositoryScope = (repository: RateLimitRepository): void => { if (currentRateLimitRepository() !== repository) refuse(); };
export async function withHomeRateLimitRepository<T>(repository: RateLimitRepository, work: () => T | Promise<T>): Promise<T> {
 const identities = currentUserIdentityRepository();
 if (scopes.getStore() || !identities || repository.homePlaneId !== identities.homePlaneId || typeof work !== 'function') return refuse();
 assertSameHomeRepositoryProvider(repository, identities);
 const scope = { repository, identities, token: userIdentityScopeToken(identities), active: true };
 return scopes.run(scope, async () => { try { return await work(); } finally { scope.active = false; } });
}
/** Also catches expired/missing native composition; callers must deny rather
 * than interpreting a scope error as permission to use hosted fail-open. */
export const nativeRateLimitContext = (): boolean => {
 try { return currentRateLimitRepository() !== null; } catch { return true; }
};
