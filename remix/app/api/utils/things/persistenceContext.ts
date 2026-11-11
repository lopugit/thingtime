import { AsyncLocalStorage } from 'node:async_hooks';
import { currentUserIdentityRepository, userIdentityScopeToken, type UserIdentityRepository } from '../auth/userIdentityRepository';
import { assertSameHomeRepositoryProvider, registerHomeRepositoryProvider } from '../auth/homeRepositoryScope';
import type { CollectionProvider } from '../documentStore/collectionContract';
import { createNativeContentRepository } from '../documentStore/nativeContentRepository';
import { createNativeTimelinePersistence } from '../documentStore/nativeTimelinePersistence';
import type { TimelinePersistence } from '../timeline/persistence';
import { hasNativeHomeSelection } from '../documentStore/nativeHomeSelection';
import { thingsPersistenceError, type ThingsPersistence, type ThingsTransaction } from './persistence';

type Scope = {
 active: boolean; identities: UserIdentityRepository; token: object; binding: object; homePlaneId: string;
 ownerId: string | undefined; failure?: Error; repositories: Map<string | null, ThingsPersistence>;
};
const scopes = new AsyncLocalStorage<Scope>();
const refuse = (scope?: Scope): never => {
 const error = new Error('Things persistence: expired or foreign request scope');
 if (scope) scope.failure ??= error;
 throw error;
};
function check(scope: Scope): void {
 if (scope.failure) throw scope.failure;
 if (!scope.active || scopes.getStore() !== scope) refuse(scope);
 const identities = currentUserIdentityRepository();
 if (identities !== scope.identities || identities.homePlaneId !== scope.homePlaneId || userIdentityScopeToken(identities) !== scope.token) refuse(scope);
 try { assertSameHomeRepositoryProvider(identities, scope.binding); } catch { refuse(scope); }
}

/** An internal selection, never authentication. Canonical services establish
 * actor authority and authorize all read candidates before exposing content.
 * Normal hosted callers retain their existing Mongo implementation. */
export function getBoundThingsPersistence(ownerId: string | null): ThingsPersistence | null {
 const scope = scopes.getStore();
 if (!scope) {
  if (currentUserIdentityRepository() || hasNativeHomeSelection()) return refuse();
  return null;
 }
 check(scope);
 if (ownerId !== null && (typeof ownerId !== 'string' || !ownerId || ownerId.includes('\0'))) return refuse(scope);
 if (ownerId !== null && scope.ownerId !== undefined && scope.ownerId !== ownerId) return refuse(scope);
 if (ownerId !== null) scope.ownerId = ownerId;
 return scope.repositories.get(ownerId) ?? createBoundRepository(scope, ownerId);
}

/** Read-only receipt candidates may have different authors. This does not
 * select an authenticated mutation owner or grant access to those receipts. */
export function withBoundTimelineRead<T>(ownerId: string, work: (port: TimelinePersistence) => Promise<T>): Promise<T> | null {
 const scope = scopes.getStore();
 if (!scope) {
  if (currentUserIdentityRepository() || hasNativeHomeSelection()) return refuse();
  return null;
 }
 check(scope);
 if (typeof ownerId !== 'string' || !ownerId || ownerId.includes('\0') || typeof work !== 'function') return refuse(scope);
 return providers.get(scope.binding)!.transaction(async collections => {
  check(scope); let live = true;
  const port = createNativeTimelinePersistence(collections, { ownerId });
  const assertLive = () => { check(scope); if (!live) refuse(scope); };
  const wrap = (operation: (...args: any[]) => Promise<any>) => async (...args: any[]) => {
   assertLive(); const result = await operation(...args); assertLive(); return result;
  };
  for (const key of Object.keys(port)) if (typeof port[key] === 'function' && key !== 'assertTransaction') port[key] = wrap(port[key]);
  const assertTransaction = port.assertTransaction;
  port.assertTransaction = session => { assertLive(); assertTransaction(session); };
  if (port.integrity) for (const key of Object.keys(port.integrity)) port.integrity[key] = wrap(port.integrity[key]);
  try { const result = await work(port); assertLive(); return result; }
  finally { live = false; }
 });
}

// Providers remain outside the request-facing accessor, in this bootstrap-only
// factory closure. The registered object proves provider identity, not a label.
const providers = new WeakMap<object, CollectionProvider>();
function createBoundRepository(scope: Scope, ownerId: string | null): ThingsPersistence {
 const source = createNativeContentRepository(providers.get(scope.binding)!, {
  ownerId, homePlaneId: scope.homePlaneId, contentPlaneId: scope.homePlaneId
 });
 const guard = async <T>(work: () => Promise<T>): Promise<T> => {
  check(scope); const result = await work(); check(scope); return result;
 };
 const repository: ThingsPersistence = Object.freeze({
  scope: source.scope,
  readExact: id => guard(() => source.readExact(id)),
  readBatch: ids => guard(() => source.readBatch(ids)),
  readWindow: selection => guard(() => source.readWindow(selection)),
  transaction: <T>(mode: 'write' | 'delete', work: (transaction: ThingsTransaction) => Promise<T>): Promise<T> => guard(() => source.transaction(mode, async transaction => {
   check(scope);
   // Keep the exact transaction object: Timeline and accounting recognize its
   // protected binding by identity. Guard its semantic methods in place.
   for (const key of ['readExact', 'readBatch', 'readWindow', 'insert', 'compareAndSwap', 'remove', 'folderAncestors', 'folderChildren', 'lockFolder'] as const) {
    const operation = transaction[key] as (...args: any[]) => Promise<any>;
    (transaction as any)[key] = (...args: any[]) => guard(() => operation(...args));
   }
   const afterCommit = transaction.afterCommit;
   transaction.afterCommit = effect => { check(scope); afterCommit(() => guard(effect)); };
   const result = await work(transaction); check(scope); return result;
  })),
  close() { source.close(); }
 });
 scope.repositories.set(ownerId, repository); return repository;
}

/** Protected native host bootstrap only. No stores are opened, no Mongo
 * fallback is chosen, and no HTTP/environment value can select a provider.
 * Must run inside this same provider's live native authentication scope. */
export function createNativeThingsPersistenceContext(provider: CollectionProvider, homePlaneId: string) {
 if (typeof homePlaneId !== 'string' || !homePlaneId || homePlaneId.includes('\0') || !provider || typeof provider.transaction !== 'function') return thingsPersistenceError('invalid native request binding');
 const binding = Object.freeze({}); registerHomeRepositoryProvider(binding, provider); providers.set(binding, provider);
 let closed = false;
 const active = new Set<Scope>();
 return Object.freeze({
  async run<T>(work: () => T | Promise<T>): Promise<T> {
   if (closed || scopes.getStore() || typeof work !== 'function') return refuse(scopes.getStore());
   const identities = currentUserIdentityRepository();
   if (!identities || identities.homePlaneId !== homePlaneId) return refuse();
   assertSameHomeRepositoryProvider(identities, binding);
   const scope: Scope = { active: true, identities, token: userIdentityScopeToken(identities), binding, homePlaneId, ownerId: undefined, repositories: new Map() };
   active.add(scope);
   return scopes.run(scope, async () => {
    try { check(scope); const result = await work(); check(scope); return result; }
    finally { scope.active = false; active.delete(scope); for (const repository of scope.repositories.values()) repository.close(); }
   });
  },
  close() { closed = true; for (const scope of active) { scope.active = false; for (const repository of scope.repositories.values()) repository.close(); } }
 });
}
