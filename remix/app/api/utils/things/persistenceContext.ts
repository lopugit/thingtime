import { AsyncLocalStorage } from 'node:async_hooks';
import { currentUserIdentityRepository, userIdentityScopeToken, type UserIdentityRepository } from '../auth/userIdentityRepository';
import { assertSameHomeRepositoryProvider, registerHomeRepositoryProvider } from '../auth/homeRepositoryScope';
import type { CollectionProvider, CollectionTransaction } from '../documentStore/collectionContract';
import { createNativeContentRepository } from '../documentStore/nativeContentRepository';
import { createNativeTimelinePersistence } from '../documentStore/nativeTimelinePersistence';
import type { TimelinePersistence } from '../timeline/persistence';
import { hasNativeHomeSelection } from '../documentStore/nativeHomeSelection';
import { decodeThingsCursor, encodeThingsCursor, getThingsTransactionBinding, normalizeThingsSelection, thingsPersistenceError, type ThingsPersistence, type ThingsScope, type ThingsTransaction } from './persistence';

type Scope = {
 active: boolean; identities: UserIdentityRepository; token: object; binding: object; homePlaneId: string;
 ownerId: string | undefined; publicDataPlane: string | undefined; failure?: Error; repositories: Map<string | null, ThingsPersistence>;
};
const scopes = new AsyncLocalStorage<Scope>();
type ActiveTransaction = { scope: Scope; transaction: ThingsTransaction; selectionScope: ThingsScope; active: boolean; failed: boolean; failure: unknown };
const transactions = new AsyncLocalStorage<ActiveTransaction>();
const readMemoKeys = new WeakMap<object, object>();
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
function activeTransaction(scope: Scope): ActiveTransaction | undefined {
 const active = transactions.getStore();
 if (!active) return undefined;
 check(scope);
 if (active.scope !== scope || !active.active) return refuse(scope);
 if (active.failed) throw active.failure;
 // This also checks the persistence driver's exact asynchronous ownership and
 // lifetime; a request label or a matching owner alone is insufficient.
 getThingsTransactionBinding(active.transaction, active.selectionScope.ownerId!);
 return active;
}
const poison = (active: ActiveTransaction | undefined, error: unknown) => { if (active?.active && !active.failed) { active.failed = true; active.failure = error; } };

/** Empty opaque cache identity only. Fresh native transactions cannot inherit
 * authorization memo state from request preparation or an earlier transaction.
 * Request/provider/identity and transaction lifetimes are checked on every read. */
export function nativeThingsReadMemoKey(): object | null {
 const scope = scopes.getStore();
 if (!scope) {
  if (currentUserIdentityRepository() || hasNativeHomeSelection()) return refuse();
  return null;
 }
 check(scope);
 const identity = activeTransaction(scope)?.transaction ?? scope;
 const existing = readMemoKeys.get(identity);
 if (existing) return existing;
 const key: object = Object.freeze(Object.create(null));
 readMemoKeys.set(identity, key);
 return key;
}

/** Profile projection may join an existing content snapshot. Identity-only
 * compositions legitimately have no Things scope; their identity repository
 * remains authoritative. An expired/foreign Things scope must still refuse. */
export function readBoundNativeTransactionProfiles(ids: readonly string[]) {
 const scope = scopes.getStore();
 if (!scope) return null;
 check(scope);
 const active = activeTransaction(scope);
 if (!active) return null;
 return active.transaction.readBatch([...ids]);
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

/** Public identity supplied only by the protected host composition. It is a
 * comparison precondition, never storage routing or the private home-plane id.
 * A native selection without its exact live binding cannot fall back to Mongo. */
export function getBoundNativeContentDataPlane(): string | null {
 const scope = scopes.getStore();
 if (!scope) {
  if (currentUserIdentityRepository() || hasNativeHomeSelection()) return refuse();
  return null;
 }
 check(scope); activeTransaction(scope);
 if (typeof scope.publicDataPlane !== 'string' || !/^custom-[0-9a-f]{64}$/.test(scope.publicDataPlane)) {
  const error = new Error('Things persistence: native public database identity is unavailable');
  scope.failure ??= error; throw error;
 }
 return scope.publicDataPlane;
}

/** Trusted composed writers may reuse only the currently bound transaction,
 * including its exact deferred-effect sink. Matching owner labels are not a
 * replacement for session, provider and asynchronous lifetime identity. */
export function getBoundNativeWriteTransaction(ownerId: string, session: unknown, afterCommit: unknown): ThingsTransaction {
 const scope = scopes.getStore();
 if (!scope) return refuse();
 check(scope);
 const active = activeTransaction(scope);
 if (!active) return refuse(scope);
 try {
  const binding = getThingsTransactionBinding(active.transaction, ownerId);
  if (binding.kind !== 'native' || binding.session !== session || active.transaction.afterCommit !== afterCommit) return refuse(scope);
  return active.transaction;
 } catch (error) { poison(active, error); throw error; }
}

/** Trusted semantic adapters only. Read candidates from the exact request's
 * provider, sharing an active content transaction without granting writes.
 * Every returned collection handle expires with this callback. */
export function withBoundNativeCollectionsRead<T>(work: (collections: CollectionTransaction) => Promise<T>): Promise<T> | null {
 const scope = scopes.getStore();
 if (!scope) {
  if (currentUserIdentityRepository() || hasNativeHomeSelection()) return refuse();
  return null;
 }
 check(scope);
 if (typeof work !== 'function') return refuse(scope);
 const active = activeTransaction(scope);
 const read = async (source: CollectionTransaction) => {
  let live = true, failed = false, failure: unknown;
  const assertLive = () => {
   check(scope);
   if (!live || transactions.getStore() !== active) refuse(scope);
   if (active) activeTransaction(scope);
   if (failed) throw failure;
  };
  const guard = <R>(operation: () => R): R => {
   try { assertLive(); const result = operation(); assertLive(); return result; }
   catch (error) { failed = true; failure = error; poison(active, error); throw error; }
  };
  const readonly = (): never => guard(() => thingsPersistenceError('read-only native collection scope'));
  const collections: CollectionTransaction = Object.freeze({
   defineCollection: readonly,
   collection: (name: string) => guard(() => {
    const collection = source.collection(name);
    return Object.freeze({ find: (options: Parameters<typeof collection.find>[0]) => guard(() => collection.find(options)),
     insert: readonly, updateOne: readonly, deleteOne: readonly });
   })
  });
  try { const result = await work(collections); assertLive(); return result; }
  catch (error) { poison(active, error); throw error; }
  finally { live = false; }
 };
 if (active) {
  const binding = getThingsTransactionBinding(active.transaction, active.selectionScope.ownerId!);
  if (binding.kind !== 'native') return refuse(scope);
  return read(binding.collections);
 }
 return providers.get(scope.binding)!.transaction(read);
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
 const active = activeTransaction(scope);
 const read = async (collections: CollectionTransaction) => {
  check(scope); let live = true;
  const port = createNativeTimelinePersistence(collections, { ownerId });
  const assertLive = () => { check(scope); if (!live || transactions.getStore() !== active) refuse(scope); if (active) activeTransaction(scope); };
  const wrap = (operation: (...args: any[]) => Promise<any>) => async (...args: any[]) => {
   try { assertLive(); const result = await operation(...args); assertLive(); return result; }
   catch (error) { poison(active, error); throw error; }
  };
  for (const key of Object.keys(port)) if (typeof port[key] === 'function' && key !== 'assertTransaction') port[key] = wrap(port[key]);
  const assertTransaction = port.assertTransaction;
  port.assertTransaction = session => { assertLive(); assertTransaction(session); };
  if (port.integrity) for (const key of Object.keys(port.integrity)) port.integrity[key] = wrap(port.integrity[key]);
  try { const result = await work(port); assertLive(); return result; }
  catch (error) { poison(active, error); throw error; }
  finally { live = false; }
 };
 if (active) {
  const binding = getThingsTransactionBinding(active.transaction, active.selectionScope.ownerId!);
  if (binding.kind !== 'native') return refuse(scope);
  return read(binding.collections);
 }
 return providers.get(scope.binding)!.transaction(read);
}

// Providers remain outside the request-facing accessor, in this bootstrap-only
// factory closure. The registered object proves provider identity, not a label.
const providers = new WeakMap<object, CollectionProvider>();
function createBoundRepository(scope: Scope, ownerId: string | null): ThingsPersistence {
 const source = createNativeContentRepository(providers.get(scope.binding)!, {
  ownerId, homePlaneId: scope.homePlaneId, contentPlaneId: scope.homePlaneId
 });
 let closed = false;
 const guard = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
   check(scope); if (closed) return thingsPersistenceError('repository is closed');
   const result = await work(); check(scope); if (closed) return thingsPersistenceError('repository is closed'); return result;
  } catch (error) { poison(transactions.getStore(), error); throw error; }
 };
 const repository: ThingsPersistence = Object.freeze({
  scope: source.scope,
  readExact: id => guard(() => (activeTransaction(scope)?.transaction ?? source).readExact(id)),
  readBatch: ids => guard(() => (activeTransaction(scope)?.transaction ?? source).readBatch(ids)),
  readWindow: input => guard(async () => {
   const active = activeTransaction(scope);
   if (!active) return source.readWindow(input);
   const selection = normalizeThingsSelection(input), after = decodeThingsCursor(source.scope, selection, input.cursor);
   const page = await active.transaction.readWindow({ ...selection, cursor: after ? encodeThingsCursor(active.selectionScope, selection, after) : null });
   const next = decodeThingsCursor(active.selectionScope, selection, page.nextCursor);
   return { documents: page.documents, nextCursor: next ? encodeThingsCursor(source.scope, selection, next) : null };
  }),
  transaction: <T>(mode: 'write' | 'delete', work: (transaction: ThingsTransaction) => Promise<T>): Promise<T> => guard(() => source.transaction(mode, async transaction => {
   check(scope);
   // Keep the exact transaction object: Timeline and accounting recognize its
   // protected binding by identity. Guard its semantic methods in place.
   for (const key of ['readExact', 'readBatch', 'readWindow', 'insert', 'compareAndSwap', 'remove', 'folderAncestors', 'folderChildren', 'lockFolder'] as const) {
    const operation = transaction[key] as (...args: any[]) => Promise<any>;
    (transaction as any)[key] = (...args: any[]) => guard(async () => {
     const result = await operation(...args);
     if (['insert', 'compareAndSwap', 'remove', 'lockFolder'].includes(key) && result !== false && result !== null) {
      readMemoKeys.delete(transaction); readMemoKeys.delete(scope);
     }
     return result;
    });
   }
   const afterCommit = transaction.afterCommit;
   transaction.afterCommit = effect => { check(scope); afterCommit(() => transactions.exit(() => { readMemoKeys.delete(scope); return guard(effect); })); };
   const active: ActiveTransaction = { scope, transaction, selectionScope: source.scope, active: true, failed: false, failure: undefined };
   return transactions.run(active, async () => {
    try { const result = await work(transaction); activeTransaction(scope); check(scope); return result; }
    finally { active.active = false; readMemoKeys.delete(scope); }
   });
  })),
  close() { closed = true; source.close(); }
 });
 scope.repositories.set(ownerId, repository); return repository;
}

/** Protected native host bootstrap only. No stores are opened, no Mongo
 * fallback is chosen, and no HTTP/environment value can select a provider.
 * Must run inside this same provider's live native authentication scope. */
export function createNativeThingsPersistenceContext(provider: CollectionProvider, homePlaneId: string, publicDataPlane?: string) {
 if (typeof homePlaneId !== 'string' || !homePlaneId || homePlaneId.includes('\0') || !provider || typeof provider.transaction !== 'function') return thingsPersistenceError('invalid native request binding');
 if (publicDataPlane !== undefined && (typeof publicDataPlane !== 'string' || !/^custom-[0-9a-f]{64}$/.test(publicDataPlane))) return thingsPersistenceError('invalid native public database identity');
 const binding = Object.freeze({}); registerHomeRepositoryProvider(binding, provider); providers.set(binding, provider);
 let closed = false;
 const active = new Set<Scope>();
 return Object.freeze({
  async run<T>(work: () => T | Promise<T>): Promise<T> {
   if (closed || scopes.getStore() || typeof work !== 'function') return refuse(scopes.getStore());
   const identities = currentUserIdentityRepository();
   if (!identities || identities.homePlaneId !== homePlaneId) return refuse();
   assertSameHomeRepositoryProvider(identities, binding);
   const scope: Scope = { active: true, identities, token: userIdentityScopeToken(identities), binding, homePlaneId, publicDataPlane, ownerId: undefined, repositories: new Map() };
   active.add(scope);
   return scopes.run(scope, async () => {
    try { check(scope); const result = await work(); check(scope); return result; }
    finally { scope.active = false; active.delete(scope); for (const repository of scope.repositories.values()) repository.close(); }
   });
  },
  close() { closed = true; for (const scope of active) { scope.active = false; for (const repository of scope.repositories.values()) repository.close(); } }
 });
}
