import { BSON, ObjectId } from 'mongodb';
import type { NativeUserStorageSession } from '../documentStore/nativeUserStorage';
import type { CollectionFilter, CollectionIdentity, CollectionTransaction } from '../documentStore/collectionContract';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { currentContentStorageSizeBytes, storageSandboxState, StorageMutationError, USER_STORAGE_STATUS } from '../storage/storageCore';
import { APP_STORAGE_ACCOUNTING_VERSION } from '~/schemas/registry';
import { appStoragePolicyOf, appIsRevoked, appAllowsTokenAudience } from './apps';
import { effectiveAppUserAllowance } from './appStorageCore';
import { scopeCovers, sessionScopes } from './scopes';
import {
 appStorageCounterEnvelopeIsTrusted, appStorageCounterFenceEnvelopeIsTrusted, appStorageCounterShareId, appStorageCounterUpsertPlan,
 appStorageAdmissionLedgerDecision, appStorageReconciliationPlan,
 sharingAuthorsFromSessions, sandboxAuthorsFromSessions, type AppNamespaceScope
} from './namespace';

const eq = (path: string[], value: any): CollectionFilter => ({ op: 'eq', path, value });
const and = (...filters: CollectionFilter[]): CollectionFilter => ({ op: 'and', filters });
const unavailable = (message = 'Native app storage requires current, trusted accounting'): never => { throw new StorageMutationError(503, 'accounting_unavailable', message); };
const invariant = (): never => { throw new StorageMutationError(503, 'storage_invariant', 'Native app storage contains an invalid source or ledger'); };
/** Internal semantic adapter. Only a protected host-bound request/transaction
 * supplies collections; no routing, store opening or Mongo fallback occurs. */
function rows(collections: CollectionTransaction, name: 'things' | 'sessions', filter: CollectionFilter): any[] {
 const result: any[] = []; let after: CollectionIdentity | undefined;
 do {
  const page = collections.collection(physicalCollectionName(name)).find({ filter, after, limit: 128 });
  result.push(...page.documents.map(bytes => BSON.deserialize(bytes)));
  after = page.nextAfter ?? undefined;
 } while (after !== undefined);
 return result;
}
export function nativeAppsByClientIds(collections: CollectionTransaction, clientIds: readonly string[]): any[] {
 if (!clientIds.length) return [];
 const docs = rows(collections, 'things', and({ op: 'contains', path: ['thingtime'], value: 'app' },
  { op: 'or', filters: [...new Set(clientIds)].map(id => eq(['crystal', 'clientId'], id)) }));
 const seen = new Set<string>();
 for (const doc of docs) { if (seen.has(doc.crystal.clientId)) return invariant(); seen.add(doc.crystal.clientId); }
 return docs;
}
function liveSessions(collections: CollectionTransaction, clientId: string, userIds: readonly string[], purpose: 'app' | 'app-sandbox', at: Date, space?: string) {
 if (!userIds.length) return [];
 return rows(collections, 'sessions', and(eq(['purpose'], purpose), eq(['meta', 'clientId'], clientId),
  { op: 'or', filters: [...new Set(userIds)].map(id => eq(['userId'], id)) },
  { op: 'or', filters: [eq(['revokedAt'], null), { op: 'exists', path: ['revokedAt'], value: false }] },
  { op: 'or', filters: [eq(['expiresAt'], null), { op: 'gt', path: ['expiresAt'], value: at }] },
  ...(space === undefined ? [] : [eq(['meta', 'space'], space)])));
}
export const nativeAppSharingAuthors = (collections: CollectionTransaction, appId: string, owners: readonly string[], at = new Date()) =>
 sharingAuthorsFromSessions(liveSessions(collections, appId, owners, 'app', at));
export const nativeSandboxSharingAuthors = (collections: CollectionTransaction, appId: string, space: string, owners: readonly string[], at = new Date()) =>
 sandboxAuthorsFromSessions(liveSessions(collections, appId, owners, 'app-sandbox', at, space));

/** Recheck a resolved app actor in the actual content transaction. A
 * first-party owner mutation has no tokenId and does not borrow an app grant. */
export function assertNativeAppNamespaceSession(collections: CollectionTransaction, scope: AppNamespaceScope, at = new Date()): void {
 if (!scope.tokenId) return;
 const app = nativeAppsByClientIds(collections, [scope.appId])[0];
 const docs = rows(collections, 'sessions', eq(['jti'], scope.tokenId));
 const session = docs.length === 1 ? docs[0] : null, scopes = sessionScopes(session?.meta);
 if (!app || appIsRevoked(app) || !session || session.purpose !== 'app' || session.userId !== scope.ownerId || session.revokedAt != null ||
  (session.expiresAt !== null && (!(session.expiresAt instanceof Date) || +session.expiresAt <= +at)) || session.meta?.clientId !== scope.appId ||
  (scope.tokenOrigin !== undefined && (session.meta?.origin !== scope.tokenOrigin || !appAllowsTokenAudience(app, scope.tokenOrigin))) ||
  scope.scopes.some(required => !scopeCovers(scopes, required as any)) || scope.sharedRead !== scopeCovers(scopes, 'app-data.shared'))
  throw new StorageMutationError(403, 'storage_invariant', 'App storage requires its exact current app session and grant');
}

const scopeFor = (appId: string, ownerId: string): AppNamespaceScope => ({ appId, ownerId, sharedRead: false, scopes: [], username: '', sandbox: null });
const counter = (collections: CollectionTransaction, scope: AppNamespaceScope, create: boolean) => {
 const docs = rows(collections, 'things', eq(['shareId'], appStorageCounterShareId(scope.ownerId, scope.appId)));
 if (docs.length > 1) return invariant();
 if (!docs.length && create) {
  const doc = { _id: new ObjectId(), ...appStorageCounterUpsertPlan(scope).setOnInsert };
  collections.collection(physicalCollectionName('things')).insert(BSON.serialize(doc)); return doc;
 }
 if (!docs.length) return null;
 if (!appStorageCounterEnvelopeIsTrusted(docs[0], scope)) {
  if (create) return unavailable();
  return appStorageCounterFenceEnvelopeIsTrusted(docs[0], scope) ? docs[0] : null;
 }
 return docs[0];
};
function setLedger(collections: CollectionTransaction, doc: any, field: 'usedBytes' | 'storageUsedBytes', usedBytes: number, at: Date, reconciled = false) {
 const result = collections.collection(physicalCollectionName('things')).updateOne(eq(['_id'], doc._id), [
  { op: 'set', path: ['crystal', field], value: usedBytes },
  { op: 'set', path: ['crystal', 'storageLedgerStatus'], value: USER_STORAGE_STATUS.ready },
  { op: 'set', path: ['crystal', 'storageUpdatedAt'], value: at },
  ...(reconciled ? [{ op: 'set' as const, path: ['crystal', 'storageReconciledAt'], value: at }] : []),
  ...(field === 'usedBytes' ? [{ op: 'set' as const, path: ['updatedAt'], value: at }] : [])
 ]);
 if (!result.matched) return invariant();
}
/** Same canonical source-size and reconciliation plan as hosted namespaces.
 * Runs before pending content is inserted. Every exact counter envelope is
 * checked; a forged reserved-id occupant can never become authority. */
function reconcile(collections: CollectionTransaction, app: any, at: Date) {
 const appId = app.crystal.clientId;
 const source = rows(collections, 'things', eq(['appId'], appId));
 const totals = new Map<string, number>();
 for (const row of source) {
  const sandbox = storageSandboxState(row);
  if (sandbox === 'sandbox') continue;
  if (sandbox === 'invalid' || (typeof row.ownerId === 'string' && row.ownerId.startsWith('sandbox:'))) return invariant();
  const bytes = currentContentStorageSizeBytes(row);
  if (bytes === null || typeof row.ownerId !== 'string' || !row.ownerId) return invariant();
  const next = (totals.get(row.ownerId) ?? 0) + bytes;
  if (!Number.isSafeInteger(next)) return invariant(); totals.set(row.ownerId, next);
 }
 const existing = rows(collections, 'things', and({ op: 'contains', path: ['thingtime'], value: 'app-storage' }, eq(['crystal', 'appId'], appId)));
 const real = existing.filter(doc => doc.sandboxExpiresAt === undefined && typeof doc.ownerId === 'string' && !doc.ownerId.startsWith('sandbox:'));
 for (const doc of real) if (!appStorageCounterEnvelopeIsTrusted(doc, scopeFor(appId, doc.ownerId))) return unavailable();
 const plan = appStorageReconciliationPlan([...totals].map(([_id, bytes]) => ({ _id, bytes, invalid: 0 })), real.map(doc => doc.ownerId));
 setLedger(collections, app, 'storageUsedBytes', plan.usedBytes, at, true);
 for (const ownerId of new Set([...totals.keys(), ...real.map(doc => doc.ownerId)])) {
  const doc = counter(collections, scopeFor(appId, ownerId), true)!;
  setLedger(collections, doc, 'usedBytes', totals.get(ownerId) ?? 0, at, true);
 }
}
/** Registered namespace accounting only, on the exact content transaction.
 * The caller also charges the owner's account via applyUserStorageDelta.
 * Invoke through ThingsTransaction's guarded operation; do not catch failures
 * and commit partial writes. Sandbox write-burn uses its own admission lane. */
export function applyNativeAppStorageDelta(collections: CollectionTransaction, scope: AppNamespaceScope, delta: number, at = new Date()): void {
 if (scope.sandbox || scope.ownerId.startsWith('sandbox:')) return unavailable('Sandbox writes require their dedicated storage and write-burn transaction');
 if (!Number.isSafeInteger(delta) || !(at instanceof Date) || !Number.isFinite(+at)) return invariant();
 assertNativeAppNamespaceSession(collections, scope, at);
 if (!delta) return;
 let app = nativeAppsByClientIds(collections, [scope.appId])[0];
 if (delta > 0 && !app) return unavailable('App is missing');
 let user = counter(collections, scope, delta > 0);
 if (delta > 0) {
  const policy = appStoragePolicyOf({ ...app, crystal: { ...app.crystal, storageLedgerStatus: 'ready' } });
  if (!policy.ready) return unavailable();
  const decision = appStorageAdmissionLedgerDecision(app.crystal, user?.crystal);
  if (decision === 'blocked') return unavailable();
  if (decision === 'reconcile') {
   reconcile(collections, app, at);
   app = nativeAppsByClientIds(collections, [scope.appId])[0]; user = counter(collections, scope, false);
  }
  const ready = appStoragePolicyOf(app);
  if (!ready.ready || !user || user.crystal.storageLedgerStatus !== 'ready') return unavailable();
  const appNext = ready.storageUsedBytes + delta, userNext = user.crystal.usedBytes + delta;
  if (!Number.isSafeInteger(appNext) || !Number.isSafeInteger(userNext)) return invariant();
  if ((ready.storageAllowanceBytes !== null && appNext > ready.storageAllowanceBytes) || userNext > effectiveAppUserAllowance(ready.userStorageAllowanceBytes, user.crystal.storageAllowanceBytes, ready.storageAllowanceBytes))
   throw new StorageMutationError(507, 'quota_exceeded', 'This would exceed the app or app-user storage allowance');
  setLedger(collections, app, 'storageUsedBytes', appNext, at); setLedger(collections, user, 'usedBytes', userNext, at); return;
 }
 // Refunds preserve unknown baselines and fence positive admission. They do
 // not fabricate a ready zero or promote malformed reserved-id documents.
 for (const [doc, field] of [[app, 'storageUsedBytes'], [user, 'usedBytes']] as const) {
  if (!doc) continue;
  const value = doc.crystal?.[field];
  if ((field !== 'usedBytes' || appStorageCounterEnvelopeIsTrusted(doc, scope)) &&
   doc.crystal?.storageAccountingVersion === APP_STORAGE_ACCOUNTING_VERSION && doc.crystal.storageLedgerStatus === 'ready' && Number.isSafeInteger(value) && value >= -delta)
   setLedger(collections, doc, field, value + delta, at);
  else collections.collection(physicalCollectionName('things')).updateOne(eq(['_id'], doc._id), [
   { op: 'set', path: ['crystal', 'storageLedgerStatus'], value: USER_STORAGE_STATUS.needsReconcile },
   { op: 'set', path: ['crystal', 'storageUpdatedAt'], value: at }
  ]);
 }
}

/** Synthetic namespaces never have an account ledger or app aggregate. Their
 * finite standing counter and global write-burn reservation share the content
 * transaction; deletion refunds only standing storage, never the burn window. */
async function applyNativeSandboxStorageDeltaInSession(collections: CollectionTransaction,
 session: NativeUserStorageSession, delta: number, at = new Date()): Promise<Date> {
 const { nativeSandboxStorageScope } = await import('../documentStore/nativeUserStorage');
 const { assertNativeSandboxSession } = await import('./nativeSandboxNamespace');
 const { SANDBOX_STORAGE_BYTES } = await import('../../../schemas/registry');
 const scope = nativeSandboxStorageScope(session, collections, delta);
 const expiresAt = assertNativeSandboxSession(collections, scope, at);
 if (!Number.isSafeInteger(delta)) return invariant();
 let user = counter(collections, scope, delta > 0);
 if (!user || !appStorageCounterEnvelopeIsTrusted(user, scope) || user.crystal.storageLedgerStatus !== 'ready') return unavailable();
 // A previous session's expired accounting may never be refreshed into a
 // fresh allowance. Minting a new sandbox generates a new synthetic owner.
 if (!(user.sandboxExpiresAt instanceof Date) || +user.sandboxExpiresAt <= +at) return unavailable('Sandbox storage has expired');
 const next = user.crystal.usedBytes + delta;
 if (!Number.isSafeInteger(next) || next < 0) return invariant();
 if (delta > 0) {
  if (next > SANDBOX_STORAGE_BYTES) throw new StorageMutationError(507, 'quota_exceeded', 'This would exceed the sandbox storage allowance');
  const { consumeByteBudgetUsing } = await import('../rateLimit/byteBudget');
  const { nativeByteBudgetPersistenceInTransaction } = await import('../documentStore/nativeRateLimits');
  const burn = await consumeByteBudgetUsing(nativeByteBudgetPersistenceInTransaction(collections), 'sandbox.storage.global', delta);
  if (!burn.allowed) throw new StorageMutationError(burn.unavailable ? 503 : 507, burn.unavailable ? 'accounting_unavailable' : 'quota_exceeded', 'Sandbox write budget is unavailable or exhausted');
 }
 setLedger(collections, user, 'usedBytes', next, at);
 // Counter lifetime cannot outlive the exact mint. Existing content expires
 // independently; callers use this returned expiry to stamp the content too.
 collections.collection(physicalCollectionName('things')).updateOne(eq(['_id'], user._id), [{ op: 'set', path: ['sandboxExpiresAt'], value: expiresAt }]);
 return expiresAt;
}

/** Any caught failed admission still poisons the exact account/content
 * transaction, including a byte-window write followed by later validation. */
export async function applyNativeSandboxStorageDelta(collections: CollectionTransaction,
 session: NativeUserStorageSession, delta: number, at = new Date()): Promise<Date> {
 const { nativeSandboxStorageScope, withNativeStorageOperation } = await import('../documentStore/nativeUserStorage');
 const scope = nativeSandboxStorageScope(session, collections);
 return withNativeStorageOperation(scope.ownerId, session, collections, () => applyNativeSandboxStorageDeltaInSession(collections, session, delta, at));
}

/** Protected native retention sweep, mirroring the hosted sandbox TTL without
 * creating refunds or account History for synthetic content. It may run on
 * startup/maintenance independently from any expired token. */
export function purgeNativeExpiredSandboxThings(collections: CollectionTransaction, at = new Date()): number {
 if (!(at instanceof Date) || !Number.isFinite(+at)) return invariant();
 let removed = 0;
 for (const doc of rows(collections, 'things', { op: 'lte', path: ['sandboxExpiresAt'], value: at })) {
  if (typeof doc.ownerId !== 'string' || !doc.ownerId.startsWith('sandbox:') || !(doc.sandboxExpiresAt instanceof Date)) continue;
  if (collections.collection(physicalCollectionName('things')).deleteOne(and(eq(['_id'], doc._id), eq(['sandboxExpiresAt'], doc.sandboxExpiresAt)))) removed++;
 }
 return removed;
}
