import { BSON, Double, Int32, Long } from 'mongodb';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { characterIdentity } from '../auth/characterCore';
import { fromBin } from '../auth/binary';
import { subscriptionShareId } from '../subscriptions/subscriptionIdentity';
import { readyUserStorageAdmission, assertUserStorageQuota } from '../storage/userStorageAdmission';
import { StorageMutationError } from '../storage/storageCore';
import { USER_STORAGE_PENDING_FIELDS } from '../storage/storagePending';
import type { CollectionFilter, CollectionProvider, CollectionTransaction } from './collectionContract';

/** An opaque account/home-plane capability, not a driver session. It remains
 * recognizable after expiry so an escaped handle cannot fall through to Mongo.
 * No runtime/user selection is provided by this adapter. */
export type NativeUserStorageSession = Readonly<{ kind: 'native-user-storage' }>;
type Context = { active: boolean; ownerId: string; planeId: string; collections: CollectionTransaction; failed: boolean; failure: unknown };
const contexts = new WeakMap<object, Context>();
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
 const { ownerId, homePlaneId, contentPlaneId } = binding;
 if (typeof ownerId !== 'string' || !ownerId || ownerId.startsWith('sandbox:') || typeof homePlaneId !== 'string' || !homePlaneId || homePlaneId !== contentPlaneId) return Promise.reject(new StorageMutationError(500, 'storage_invariant', 'Native account storage requires the same home/content plane and a real owner'));
 return provider.transaction(async collections => {
  const session: NativeUserStorageSession = Object.freeze({ kind: 'native-user-storage' });
  const context: Context = { active: true, ownerId, planeId: homePlaneId, collections, failed: false, failure: undefined };
  contexts.set(session, context);
  try {
   readNativeReadyLedger(context);
   const result = await work(session, collections);
   if (context.failed) throw context.failure;
   return result;
  } finally { context.active = false; }
 });
}

// Validate unsupported identities/states before exposing a writable callback,
// and again for each debit in case that callback changed a protected row.
const readNativeReadyLedger = (context: Context) => {
 const ownerId = context.ownerId;
 const things = context.collections.collection(physicalCollectionName('things'));
 const users = things.find({ filter: { op: 'and', filters: [exact(['shareId'], ownerId), { op: 'contains', path: ['thingtime'], value: 'user' }] }, limit: 2 }).documents;
 if (users.length !== 1) return unsupported();
 const user = BSON.deserialize(users[0]);
 let privateState: any;
 try { privateState = JSON.parse(fromBin(user.secure)); } catch { return unsupported(); }
 if (user.ownerId !== ownerId || !Array.isArray(user.thingtime) || user.thingtime.length !== 1 ||
     privateState?.accountKind !== 'user' || privateState?.meta?.temporary === true || characterIdentity({ meta: privateState.meta })) return unsupported();
 const records = things.find({ filter: exact(['shareId'], subscriptionShareId('user', ownerId)), limit: 2 }).documents;
 if (records.length !== 1) return unsupported();
 // Validators consume the same ordinary JS numeric view as the Mongo driver;
 // the write below preserves the underlying BSON numeric representation.
 const ledger = BSON.deserialize(records[0]), typed = BSON.deserialize(records[0], { promoteValues: false });
 const { usedBytes, allowanceBytes } = readyUserStorageAdmission(ledger, ownerId);
 if (USER_STORAGE_PENDING_FIELDS.some(field => Object.prototype.hasOwnProperty.call(ledger.crystal, field))) return unsupported();
 return { things, typed, usedBytes, allowanceBytes };
};

/** Ready ordinary-account consumer of the canonical applyUserStorageDelta
 * entry point. Character inheritance, pending/reconciliation and corrupt
 * deletion recovery are explicit unsupported states, never a hidden fallback.
 * Canonical API activation is prohibited until those paths and initialization
 * have their own supported adapters/acceptance. */
export function applyNativeUserStorageDelta(ownerId: string, deltaBytes: number, session: NativeUserStorageSession): void {
 const context = contexts.get(session);
 if (!context) return invariant('Unrecognized native account storage session');
 try {
  if (!context.active || context.failed || context.ownerId !== ownerId) return invariant('Native account storage session owner/lifetime mismatch');
  if (!Number.isSafeInteger(deltaBytes)) return invariant('Storage accounting received an invalid byte delta');
  // collection() checks the actual async transaction ownership even for a
  // zero delta, preventing a live capability being used by a foreign context.
  const { things, typed, usedBytes, allowanceBytes } = readNativeReadyLedger(context);
  const next = usedBytes + deltaBytes;
  if (!Number.isSafeInteger(next)) return invariant('Native storage accounting would exceed exact integer range');
  if (next < 0) return unsupported();
  if (deltaBytes > 0) assertUserStorageQuota(usedBytes, allowanceBytes, deltaBytes);
  if (deltaBytes === 0) return;
  const current = typed.crystal.storageUsedBytes;
  // Preserve typed counters; Int32 growth is explicitly promoted to signed
  // Long rather than overflowing or imposing an artificial 2-GiB ceiling.
  const value = current instanceof Long ? Long.fromNumber(next) : current instanceof Double ? new Double(next) :
   current instanceof Int32 && next <= 2147483647 ? new Int32(next) : Long.fromNumber(next);
  const changed = things.updateOne({ op: 'and', filters: [exact(['_id'], typed._id), exact(['ownerId'], ownerId),
   exact(['crystal', 'storageUsedBytes'], current)] }, [
   { op: 'set', path: ['crystal', 'storageUsedBytes'], value },
   { op: 'set', path: ['crystal', 'storageUpdatedAt'], value: new Date() }
  ]);
  if (!changed.matched) throw new StorageMutationError(409, 'storage_conflict', 'The account storage ledger changed during this transaction');
 } catch (error) { context.failed = true; context.failure = error; throw error; }
}
