import { AsyncLocalStorage } from 'node:async_hooks';
import { assertSameHomeRepositoryProvider } from '../auth/homeRepositoryScope';
import { currentUserIdentityRepository, userIdentityScopeToken } from '../auth/userIdentityRepository';
import { hasNativeHomeSelection } from '../documentStore/nativeHomeSelection';
import { nativeThingsReadMemoKey } from './persistenceContext';
import type { ThingDoc, Viewer } from './things';

/** Protected zero-byte discovery relationships, never generic content writes. */
export interface NativeFoundPostRepository {
 readonly homePlaneId: string;
 remember(viewer: Viewer, post: ThingDoc, ipAddress?: string): Promise<void>;
 loadForAuthor(viewerId: string, authorId: string): Promise<ReadonlyMap<string, string>>;
}
const scopes = new AsyncLocalStorage<{ repository: NativeFoundPostRepository; active: boolean; token: object }>();
const unavailable = (): never => { throw new Error('Native discovery repository does not match the active home request'); };
export function currentNativeFoundPostRepository(): NativeFoundPostRepository | null {
 const scope = scopes.getStore(), identities = currentUserIdentityRepository();
 if (!scope) return identities || hasNativeHomeSelection() ? unavailable() : null;
 if (!scope.active || !identities || identities.homePlaneId !== scope.repository.homePlaneId || userIdentityScopeToken(identities) !== scope.token) return unavailable();
 assertSameHomeRepositoryProvider(identities, scope.repository);
 if (!nativeThingsReadMemoKey()) return unavailable();
 return scope.repository;
}
export function assertNativeFoundPostScope(repository: NativeFoundPostRepository): void {
 if (currentNativeFoundPostRepository() !== repository) unavailable();
}
export async function withHomeFoundPostRepository<T>(repository: NativeFoundPostRepository, work: () => T | Promise<T>): Promise<T> {
 if (scopes.getStore()) return unavailable();
 const identities = currentUserIdentityRepository();
 if (!identities) return unavailable();
 const scope = { repository, active: true, token: userIdentityScopeToken(identities) };
 return scopes.run(scope, async () => {
  try { assertNativeFoundPostScope(repository); return await work(); }
  finally { scope.active = false; }
 });
}
