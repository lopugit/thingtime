import { BSON, Double, Int32, Long } from 'mongodb';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DocumentStoreError } from './contract';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { characterIdentity } from '../auth/characterCore';
import { fromBin } from '../auth/binary';
import { subscriptionShareId, userSubscriptionLedgerEnvelopeIsTrusted } from '../subscriptions/subscriptionIdentity';
import { readyUserStorageAdmission, assertUserStorageQuota } from '../storage/userStorageAdmission';
import { StorageMutationError, USER_STORAGE_ACCOUNTING_VERSION, USER_STORAGE_STATUS } from '../storage/storageCore';
import { USER_STORAGE_PENDING_FIELDS } from '../storage/storagePending';
import type { CollectionFilter, CollectionProvider, CollectionTransaction } from './collectionContract';

/** An opaque account/home-plane capability, not a driver session. It remains
 * recognizable after expiry so an escaped handle cannot fall through to Mongo.
 * No runtime/user selection is provided by this adapter. */
export type NativeUserStorageSession = Readonly<{ kind: 'native-user-storage' }>;
type Context = { active: boolean; ownerId: string; planeId: string; collections: CollectionTransaction; failed: boolean; failure: unknown; deletionOnly: boolean; refundBytes: number; uncertainRefund: boolean };
const contexts = new WeakMap<object, Context>();
const transactionOwnership = new AsyncLocalStorage<Context>();
const invariant = (message: string): never => { throw new StorageMutationError(500, 'storage_invariant', message); };
const unsupported = (): never => { throw new StorageMutationError(503, 'accounting_unavailable', 'This native account storage state requires an accounting adapter that is not available yet'); };
export const isNativeUserStorageSession = (session: unknown): session is NativeUserStorageSession => {
 if (!session || typeof session !== 'object') return false;
 if (contexts.has(session)) return true;
 if (Object.getOwnPropertyDescriptor(session, 'kind')?.value === 'native-user-storage') return invariant('Unrecognized native account storage session');
 return false;
};
const exact = (path: string[], value: any): CollectionFilter => ({ op: 'eq', path, value });

/** The trusted provider caller supplies both selected plane identities. A
 * native home ledger cannot be borrowed by another content plane or account.
 * All callback content/history and this ledger mutation share one actual
 * SQLite transaction; any caught adapter error still aborts its commit. */
export function withNativeHomeStorageTransaction<T>(provider: CollectionProvider,
 binding: { ownerId: string; homePlaneId: string; contentPlaneId: string },
 work: (session: NativeUserStorageSession, collections: CollectionTransaction) => T | Promise<T>): Promise<T> {
 return withStorageTransaction(provider, binding, false, work);
}
function withStorageTransaction<T>(provider: CollectionProvider,
 binding: { ownerId: string; homePlaneId: string; contentPlaneId: string }, deletionOnly: boolean,
 work: (session: NativeUserStorageSession, collections: CollectionTransaction) => T | Promise<T>): Promise<T> {
 const { ownerId, homePlaneId, contentPlaneId } = binding;
 if (typeof ownerId !== 'string' || !ownerId || ownerId.startsWith('sandbox:') || typeof homePlaneId !== 'string' || !homePlaneId || homePlaneId !== contentPlaneId) return Promise.reject(new StorageMutationError(500, 'storage_invariant', 'Native account storage requires the same home/content plane and a real owner'));
 return provider.transaction(async collections => {
  const session: NativeUserStorageSession = Object.freeze({ kind: 'native-user-storage' });
  const context: Context = { active: true, ownerId, planeId: homePlaneId, collections, failed: false, failure: undefined, deletionOnly, refundBytes: 0, uncertainRefund: false };
  contexts.set(session, context);
  try {
   if (deletionOnly) readNativeOwner(context); else readNativeReadyLedger(context);
   const result = await transactionOwnership.run(context, () => work(session, collections));
   if (context.failed) throw context.failure;
   return result;
  } finally { context.active = false; }
 });
}

// Validate unsupported identities/states before exposing a writable callback,
// and again for each debit in case that callback changed a protected row.
const readNativeOwner = (context: Context) => {
 const ownerId = context.ownerId;
 const things = context.collections.collection(physicalCollectionName('things'));
 const users = things.find({ filter: { op: 'and', filters: [exact(['shareId'], ownerId), { op: 'contains', path: ['thingtime'], value: 'user' }] }, limit: 2 }).documents;
 if (users.length !== 1) return unsupported();
 const user = BSON.deserialize(users[0]);
 let privateState: any;
 try { privateState = JSON.parse(fromBin(user.secure)); } catch { return unsupported(); }
 if (user.ownerId !== ownerId || !Array.isArray(user.thingtime) || user.thingtime.length !== 1 ||
     privateState?.accountKind !== 'user' || privateState?.meta?.temporary === true || characterIdentity({ meta: privateState.meta })) return unsupported();
 return things;
};
const readNativeReadyLedger = (context: Context) => {
 const things = readNativeOwner(context), ownerId = context.ownerId;
 const records = things.find({ filter: exact(['shareId'], subscriptionShareId('user', ownerId)), limit: 2 }).documents;
 if (records.length !== 1) return unsupported();
 // Validators consume the same ordinary JS numeric view as the Mongo driver;
 // the write below preserves the underlying BSON numeric representation.
 const ledger = BSON.deserialize(records[0]), typed = BSON.deserialize(records[0], { promoteValues: false });
 const { usedBytes, allowanceBytes } = readyUserStorageAdmission(ledger, ownerId);
 if (USER_STORAGE_PENDING_FIELDS.some(field => Object.prototype.hasOwnProperty.call(ledger.crystal, field))) return unsupported();
 return { things, typed, usedBytes, allowanceBytes };
};

/** Canonical delta consumer for ordinary native accounts. Normal writes
 * require ready accounting. The explicit deletion lane preserves unavailable
 * counters and fences reconciliation instead of inventing a refund balance.
 * Character inheritance and native recovery execution remain unsupported;
 * this accounting adapter alone does not activate canonical Things APIs. */
export function applyNativeUserStorageDelta(ownerId: string, deltaBytes: number, session: NativeUserStorageSession): void {
 guarded(ownerId, session, context => {
  if (!Number.isSafeInteger(deltaBytes)) return invariant('Storage accounting received an invalid byte delta');
  if (context.deletionOnly && deltaBytes > 0) return invariant('Deletion-only transactions cannot admit new content');
  let ledger: ReturnType<typeof readNativeReadyLedger>;
  try { ledger = readNativeReadyLedger(context); }
  catch (error) {
   if (!context.deletionOnly || !(error instanceof StorageMutationError) || error.code !== 'accounting_unavailable') throw error;
   if (deltaBytes < 0) {
    const refund = context.refundBytes - deltaBytes;
    if (!Number.isSafeInteger(refund)) return invariant('Native refund bytes exceed exact integer range');
    context.refundBytes = refund; context.uncertainRefund = true;
    fenceNativeLedger(context, new Date());
   }
   return;
  }
  const next = ledger.usedBytes + deltaBytes;
  if (!Number.isSafeInteger(next)) return invariant('Native storage accounting would exceed exact integer range');
  if (next < 0) {
   if (!context.deletionOnly) return unsupported();
   const refund = context.refundBytes - deltaBytes;
   if (!Number.isSafeInteger(refund)) return invariant('Native refund bytes exceed exact integer range');
   context.refundBytes = refund; context.uncertainRefund = true;
   fenceNativeLedger(context, new Date()); return;
  }
  if (deltaBytes > 0) assertUserStorageQuota(ledger.usedBytes, ledger.allowanceBytes, deltaBytes);
  if (!deltaBytes) return;
  if (deltaBytes < 0 && context.deletionOnly) {
   const refund = context.refundBytes - deltaBytes;
   if (!Number.isSafeInteger(refund)) return invariant('Native refund bytes exceed exact integer range');
   context.refundBytes = refund;
  }
  writeNativeUsedBytes(ledger, ownerId, next);
 });
}

/** Separate cleanup lane: unavailable accounting stays unavailable. It permits
 * only refunds and their matching retained history, never new content growth. */
export function withNativeHomeDeletionStorageTransaction<T>(provider: CollectionProvider,
 binding: { ownerId: string; homePlaneId: string; contentPlaneId: string },
 work: (session: NativeUserStorageSession, collections: CollectionTransaction) => T | Promise<T>): Promise<T> {
 return withStorageTransaction(provider, binding, true, work);
}

const checkedContext = (ownerId: string, session: NativeUserStorageSession): Context => {
 const context = contexts.get(session);
 if (!context) return invariant('Unrecognized native account storage session');
 if (context.active && !context.failed && context.ownerId === ownerId && transactionOwnership.getStore() !== context) {
  const error = new DocumentStoreError('TRANSACTION_OWNERSHIP', 'Native account operation belongs to another asynchronous transaction scope');
  context.failed = true; context.failure = error; throw error;
 }
 if (!context.active || context.failed || context.ownerId !== ownerId) {
  const error = new StorageMutationError(500, 'storage_invariant', 'Native account storage session owner/lifetime mismatch');
  context.failed = true; context.failure = error; throw error;
 }
 return context;
};
/** Bind a complete semantic operation, including planning/validation, to the
 * exact live content/account transaction. Catching its error cannot commit a
 * preceding partial write. Async continuations cannot borrow another scope. */
export async function withNativeStorageOperation<T>(ownerId: string, session: NativeUserStorageSession,
 collections: CollectionTransaction, work: () => T | Promise<T>): Promise<T> {
 const context = checkedContext(ownerId, session);
 try {
  if (context.collections !== collections) return invariant('Native operation used another collection transaction');
  const result = await work();
  checkedContext(ownerId, session);
  return result;
 } catch (error) { context.failed = true; context.failure = error; throw error; }
}
const guarded = <T>(ownerId: string, session: NativeUserStorageSession, work: (context: Context) => T): T => {
 const context = checkedContext(ownerId, session);
 try { readNativeOwner(context); return work(context); }
 catch (error) { context.failed = true; context.failure = error; throw error; }
};
const writeNativeUsedBytes = (ledger: ReturnType<typeof readNativeReadyLedger>, ownerId: string, next: number) => {
 const { things, typed } = ledger;
 const current = typed.crystal.storageUsedBytes;
 const value = current instanceof Long ? Long.fromNumber(next) : current instanceof Double ? new Double(next) :
  current instanceof Int32 && next <= 2147483647 ? new Int32(next) : Long.fromNumber(next);
 const changed = things.updateOne({ op: 'and', filters: [exact(['_id'], typed._id), exact(['ownerId'], ownerId),
  exact(['crystal', 'storageUsedBytes'], current)] }, [
  { op: 'set', path: ['crystal', 'storageUsedBytes'], value },
  { op: 'set', path: ['crystal', 'storageUpdatedAt'], value: new Date() }
 ]);
 if (!changed.matched) throw new StorageMutationError(409, 'storage_conflict', 'The account storage ledger changed during this transaction');
};
const fenceNativeLedger = (context: Context, now: Date) => {
 if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return invariant('Invalid native reconciliation timestamp');
 const things = context.collections.collection(physicalCollectionName('things'));
 const bytes = things.find({ filter: exact(['shareId'], subscriptionShareId('user', context.ownerId)), limit: 2 }).documents;
 if (bytes.length !== 1) return;
 const ledger = BSON.deserialize(bytes[0]);
 // Missing/malformed identities are never repaired into trusted entitlements.
 // They already fail admission; preserve their unknown count and envelope.
 if (!userSubscriptionLedgerEnvelopeIsTrusted(ledger, context.ownerId) || ledger.crystal.storageAccountingVersion !== USER_STORAGE_ACCOUNTING_VERSION) return;
 const changed = things.updateOne({ op: 'and', filters: [exact(['_id'], ledger._id), exact(['ownerId'], context.ownerId)] }, [
  { op: 'set', path: ['crystal', 'storageLedgerStatus'], value: USER_STORAGE_STATUS.needsReconcile },
  { op: 'set', path: ['crystal', 'storageUpdatedAt'], value: now }
 ]);
 if (!changed.matched) throw new StorageMutationError(409, 'storage_conflict', 'The account storage ledger changed during reconciliation fencing');
};

/** No native recovery runner is implied. The canonical status fence persists
 * atomically and admission remains unavailable until exact reconciliation. */
export const markNativeUserStorageNeedsReconcile = (ownerId: string, session: NativeUserStorageSession, now = new Date()): void =>
 guarded(ownerId, session, context => { context.uncertainRefund = true; fenceNativeLedger(context, now); });

/** Only bytes refunded by this deletion-only transaction can move into retained history.
 * Matching retention is not fresh growth and must work at/above quota. */
export const retainNativeDeletedThingStorage = (ownerId: string, bytes: number, session: NativeUserStorageSession): void =>
 guarded(ownerId, session, context => {
  if (!context.deletionOnly) return invariant('Retained history requires the deletion-only transaction lane');
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > context.refundBytes) return invariant('Retained deletion bytes require a matching transaction refund');
  if (!bytes) return;
  context.refundBytes -= bytes;
  let ledger: ReturnType<typeof readNativeReadyLedger>;
  try { ledger = readNativeReadyLedger(context); }
  catch (error) {
   if (!context.deletionOnly || !(error instanceof StorageMutationError) || error.code !== 'accounting_unavailable') throw error;
   context.uncertainRefund = true; fenceNativeLedger(context, new Date()); return;
  }
  if (context.uncertainRefund) { fenceNativeLedger(context, new Date()); return; }
  const next = ledger.usedBytes + bytes;
  if (!Number.isSafeInteger(next)) return invariant('Retained deletion storage would exceed exact integer range');
  writeNativeUsedBytes(ledger, ownerId, next);
 });
