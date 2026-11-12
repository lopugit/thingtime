import { AsyncLocalStorage } from 'node:async_hooks';
import { BSON } from 'mongodb';
import type { CollectionTransaction } from '../documentStore/collectionContract';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { StorageMutationError } from '../storage/storageCore';
import { scopeCovers, sessionScopes } from './scopes';
import type { AppNamespaceScope } from './namespace';
type Scope = { active: boolean; namespace: AppNamespaceScope };
const contexts = new AsyncLocalStorage<Scope>();
const refuse = (): never => { throw new StorageMutationError(403, 'storage_invariant', 'Sandbox storage requires its exact live app-sandbox session'); };
/** Internal canonical-service binding only. The session is independently
 * reauthorized against the exact protected SQLite transaction before use. */
export async function withNativeSandboxNamespace<T>(namespace: AppNamespaceScope, work: () => Promise<T>): Promise<T> {
 if (contexts.getStore() || !namespace.sandbox || !namespace.ownerId.startsWith('sandbox:') || !namespace.appId || !namespace.tokenId || typeof work !== 'function') return refuse();
 const scope: Scope = { active: true, namespace: Object.freeze({ ...namespace, scopes: Object.freeze([...namespace.scopes]) as unknown as string[], sandbox: Object.freeze({ ...namespace.sandbox }) }) };
 return contexts.run(scope, async () => { try { return await work(); } finally { scope.active = false; } });
}
export function currentNativeSandboxNamespace(ownerId: string): AppNamespaceScope | null {
 const scope = contexts.getStore();
 if (!scope) return null;
 if (!scope.active || scope.namespace.ownerId !== ownerId) return refuse();
 return scope.namespace;
}
export function assertNativeSandboxSession(collections: CollectionTransaction, namespace: AppNamespaceScope, at = new Date()): Date {
 const current = currentNativeSandboxNamespace(namespace.ownerId);
 if (current !== namespace || !namespace.sandbox || !namespace.tokenId || !Number.isFinite(+at)) return refuse();
 const sessions = collections.collection(physicalCollectionName('sessions')).find({ filter: { op: 'eq', path: ['jti'], value: namespace.tokenId }, limit: 2 }).documents;
 if (sessions.length !== 1) return refuse();
 const session = BSON.deserialize(sessions[0]), scopes = sessionScopes(session.meta);
 if (session.userId !== namespace.ownerId || session.purpose !== 'app-sandbox' || session.revokedAt != null ||
  !(session.expiresAt instanceof Date) || +session.expiresAt <= +at || session.meta?.clientId !== namespace.appId ||
  (session.meta?.space ?? null) !== namespace.sandbox.space || (namespace.tokenOrigin !== undefined && session.meta?.origin !== namespace.tokenOrigin) || namespace.scopes.some(scope => !scopeCovers(scopes, scope as any)) ||
  namespace.sharedRead !== scopeCovers(scopes, 'app-data.shared')) return refuse();
 return session.expiresAt;
}
