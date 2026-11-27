import { randomUUID } from 'node:crypto';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, STORAGE_PENDING_THINGTIME } from '../../../schemas/registry';
import { USER_STORAGE_PENDING_LIMIT_BYTES, userStoragePendingStateIsTrusted } from './storagePending';
import { ensureUserStorageRecoveryJob } from './userStorageRecovery';
import { exactDocumentSnapshotMatch } from '../migrations/migrationCore';
import { synchronizeCharacterStorageTier, characterEntitlementSource, characterEntitlementSources, withCharacterEntitlement } from '../auth/characterEntitlements';
// The user subscription ledger is an identity/billing object: HOME-pinned like
// users/sessions, whatever data-plane override the request carries. Reads (a
// user's quota) and reconciliation must always answer from the home ledger,
// and ledger writes only ever ride sessions from home-client transactions
// (sessions are client-bound) — active-plane writers skip account accounting
// entirely when an override is live (foreign bytes are not Thingtime storage).
import { getHomeThingsCollection as getThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import {
  subscriptionThingMatch,
  userSubscriptionLedgerEnvelopeIsTrusted,
  userSubscriptionLedgerMatch
} from '../subscriptions/subscriptionIdentity';
import {
  StorageMutationError,
  USER_STORAGE_ACCOUNTING_VERSION,
  USER_STORAGE_STATUS,
  billableStorageCandidateExpression,
  normalizedStorageUsage,
  currentStorageSourceMatch,
  thingStorageSizeBytes,
  storageSandboxState,
  currentContentStorageSizeBytes,
  type UserStorageUsage
} from './storageCore';

const hasOwn = (value: unknown, key: string): boolean =>
  !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key);

export const userStorageAllowanceFromCrystal = (crystal: any): number | null => {
  const override = crystal?.overrides;
  if (hasOwn(override, 'userStorageBytes')) {
    const value = override.userStorageBytes;
    return value === null ? null : Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
  }
  const value = crystal?.tierQuotas?.userStorageBytes;
  return value === null ? null : Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
};

export const userStorageAllowanceIsValid = (crystal: any): boolean => {
  const raw = hasOwn(crystal?.overrides, 'userStorageBytes')
    ? crystal.overrides.userStorageBytes
    : crystal?.tierQuotas?.userStorageBytes;
  return raw === null || (Number.isSafeInteger(raw) && Number(raw) >= 0);
};

// Mongo expression matching userStorageAllowanceFromCrystal while preserving
// the important distinction between an absent override and an explicit null
// (unlimited/metered) override.
export const userStorageAllowanceExpression = {
  $let: {
    vars: { overrideType: { $type: '$crystal.overrides.userStorageBytes' } },
    in: {
      $let: {
        vars: {
          raw: {
            $cond: [
              { $ne: ['$$overrideType', 'missing'] },
              '$crystal.overrides.userStorageBytes',
              '$crystal.tierQuotas.userStorageBytes'
            ]
          }
        },
        in: {
          $cond: [
            { $eq: ['$$raw', null] },
            null,
            {
              $let: {
                vars: {
                  whole: { $convert: { input: '$$raw', to: 'long', onError: null, onNull: null } }
                },
                in: {
                  $cond: [
                    {
                      $and: [
                        { $isNumber: '$$raw' },
                        { $ne: ['$$whole', null] },
                        { $eq: ['$$raw', '$$whole'] },
                        { $gte: ['$$whole', 0] },
                        { $lte: ['$$whole', Number.MAX_SAFE_INTEGER] }
                      ]
                    },
                    '$$whole',
                    -1
                  ]
                }
              }
            }
          ]
        }
      }
    }
  }
};

export const readyUserStorageMatch = (ownerId: string) => ({
  ...userSubscriptionLedgerMatch(ownerId),
  'crystal.storageAccountingVersion': USER_STORAGE_ACCOUNTING_VERSION,
  'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready,
  'crystal.storageUsedBytes': { $gte: 0 },
  'crystal.storagePendingCount': { $exists: false }
});

const safeWholeNumberExpression = (field: string) => ({
  $let: {
    vars: { whole: { $convert: { input: field, to: 'long', onError: null, onNull: null } } },
    in: {
      $and: [
        { $isNumber: field },
        { $ne: ['$$whole', null] },
        { $eq: [field, '$$whole'] },
        { $gte: ['$$whole', 0] },
        { $lte: ['$$whole', Number.MAX_SAFE_INTEGER] }
      ]
    }
  }
});

const usageFromSubscriptionDoc = (doc: any): UserStorageUsage =>
  normalizedStorageUsage({
    usedBytes: doc?.crystal?.storageUsedBytes,
    allowanceBytes: userStorageAllowanceFromCrystal(doc?.crystal),
    allowanceValid: userStorageAllowanceIsValid(doc?.crystal),
    accountingVersion: doc?.crystal?.storageAccountingVersion,
    ledgerStatus: doc?.crystal?.storageLedgerStatus,
    reconciledAt: doc?.crystal?.storageReconciledAt
  });

const unavailableUserStorageUsage = (): UserStorageUsage =>
  normalizedStorageUsage({
    usedBytes: null,
    allowanceBytes: 0,
    allowanceValid: false,
    accountingVersion: null,
    ledgerStatus: null
  });

export const getUserStorageUsage = async (ownerId: string): Promise<UserStorageUsage> => {
  const doc = await (await getThingsCollection()).findOne(subscriptionThingMatch('user', ownerId));
  if (!doc || !userSubscriptionLedgerEnvelopeIsTrusted(doc, ownerId)) return unavailableUserStorageUsage();
  return usageFromSubscriptionDoc(withCharacterEntitlement(doc, await characterEntitlementSource(ownerId)));
};

export const getUserStorageUsages = async (ownerIds: readonly string[]): Promise<Map<string, UserStorageUsage>> => {
  const ids = [...new Set(ownerIds.map(String).filter(Boolean))];
  if (!ids.length) return new Map();
  const docs = await (
    await getThingsCollection()
  )
    .find({
      thingtime: 'subscription',
      shareId: { $in: ids.map((id) => subscriptionThingMatch('user', id).shareId) }
    })
    .toArray();
  const inheritances = await characterEntitlementSources(ids);
  const ownerByShareId = new Map(ids.map((id) => [subscriptionThingMatch('user', id).shareId, id]));
  const usages = new Map<string, UserStorageUsage>();
  for (const ownerId of ids) usages.set(ownerId, unavailableUserStorageUsage());
  for (const doc of docs) {
    const ownerId = ownerByShareId.get(String(doc.shareId));
    if (ownerId && userSubscriptionLedgerEnvelopeIsTrusted(doc, ownerId)) {
      usages.set(ownerId, usageFromSubscriptionDoc(withCharacterEntitlement(doc, inheritances.get(ownerId))));
    }
  }
  return usages;
};

const explainPositiveAdmissionFailure = async (ownerId: string, deltaBytes: number, session: any): Promise<never> => {
  const existing = await (await getThingsCollection()).findOne(subscriptionThingMatch('user', ownerId), { session });
  if (
    !existing ||
    !userSubscriptionLedgerEnvelopeIsTrusted(existing, ownerId) ||
    existing.crystal?.storageAccountingVersion !== USER_STORAGE_ACCOUNTING_VERSION ||
    existing.crystal?.storageLedgerStatus !== USER_STORAGE_STATUS.ready ||
    !Number.isSafeInteger(existing.crystal?.storageUsedBytes) ||
    Number(existing.crystal.storageUsedBytes) < 0 ||
    !userStorageAllowanceIsValid(existing.crystal)
  ) {
    throw new StorageMutationError(503, 'accounting_unavailable', 'Account storage accounting is being initialized — try again shortly');
  }
  const usedBytes = Number(existing.crystal?.storageUsedBytes || 0);
  const allowanceBytes = userStorageAllowanceFromCrystal(existing.crystal);
  if (allowanceBytes !== null && usedBytes + deltaBytes > allowanceBytes) {
    throw new StorageMutationError(
      507,
      'quota_exceeded',
      `This change needs more account storage (${usedBytes} of ${allowanceBytes} bytes used). Saved history also uses storage; deleting a Thing keeps its recorded history.`
    );
  }
  throw new StorageMutationError(503, 'accounting_unavailable', 'Account storage accounting is unavailable — try again');
};

const reconcileUserStorageInTransaction = async (ownerId: string, session: any): Promise<any | null> => {
  const things = await getThingsCollection();
  // Validate the complete billable source universe and sum it server-side in
  // one indexed aggregation. Invalid/legacy rows are counted, never silently
  // filtered out. Root stamps are server-owned and are written from the
  // canonical payload with CAS; reconciliation repairs the hot ledger from
  // those immutable-per-version source facts without pulling an unbounded
  // account into application memory or issuing one operation per Thing.
  const rows = await things
    .aggregate(
      [
        {
          $match: {
            ownerId
          }
        },
        { $match: { $expr: billableStorageCandidateExpression } },
        {
          $facet: {
            all: [{ $count: 'count' }],
            valid: [
              { $match: currentStorageSourceMatch },
              { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$sizeBytes' } } }
            ]
          }
        }
      ],
      { session, maxTimeMS: 5_000 }
    )
    .toArray();
  const allCount = Number(rows[0]?.all?.[0]?.count || 0);
  const validCount = Number(rows[0]?.valid?.[0]?.count || 0);
  if (allCount !== validCount) {
    throw new StorageMutationError(
      503,
      'accounting_unavailable',
      'Account content requires storage migration before its ledger can be reconciled'
    );
  }
  const usedBytes = Number(rows[0]?.valid?.[0]?.bytes || 0);
  if (!Number.isSafeInteger(usedBytes) || usedBytes < 0) {
    throw new StorageMutationError(500, 'storage_invariant', 'Account storage total exceeds the exact counter range');
  }
  const now = new Date();
  const reconciled = await things.findOneAndUpdate(
    userSubscriptionLedgerMatch(ownerId),
    {
      $set: {
        'crystal.storageUsedBytes': usedBytes,
        'crystal.storageAccountingVersion': USER_STORAGE_ACCOUNTING_VERSION,
        'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready,
        'crystal.storageReconciledAt': now,
        'crystal.storageUpdatedAt': now
      },
      $unset: { 'crystal.storagePendingBytes': '', 'crystal.storagePendingCount': '', 'crystal.storagePendingSince': '' }
    },
    { session, returnDocument: 'after' }
  );
  if (reconciled) await things.deleteMany({ ownerId, thingtime: [STORAGE_PENDING_THINGTIME], storageClass: 'control' }, { session });
  return reconciled;
};

// A deferred delta and its content share one Mongo transaction. Only unlimited
// current, trusted recoverable ledgers may admit growth without an exact source
// baseline; finite quotas remain hard gates until independent recovery completes.
const queueUserStorageDelta = async (ownerId: string, deltaBytes: number, session: any, retainedDeletion = false): Promise<boolean> => {
  const things = await getThingsCollection();
  const existing = await things.findOne(subscriptionThingMatch('user', ownerId), { session });
  if (!existing || !userSubscriptionLedgerEnvelopeIsTrusted(existing, ownerId) ||
      existing.crystal?.storageAccountingVersion !== USER_STORAGE_ACCOUNTING_VERSION ||
      existing.crystal?.storageLedgerStatus !== USER_STORAGE_STATUS.needsReconcile ||
      !Number.isSafeInteger(existing.crystal?.storageUsedBytes) || existing.crystal.storageUsedBytes < 0 ||
      !userStorageAllowanceIsValid(existing.crystal) || !userStoragePendingStateIsTrusted(existing.crystal) ||
      (deltaBytes > 0 && !retainedDeletion && userStorageAllowanceFromCrystal(existing.crystal) !== null)) return false;
  const grossBytes = retainedDeletion ? 0 : Math.max(0, deltaBytes);
  const at = new Date();
  const operationId = randomUUID();
  const reserved = await things.findOneAndUpdate({
    ...userSubscriptionLedgerMatch(ownerId),
    'crystal.storageAccountingVersion': USER_STORAGE_ACCOUNTING_VERSION,
    'crystal.storageLedgerStatus': USER_STORAGE_STATUS.needsReconcile,
    $expr: { $and: [
      ...(deltaBytes > 0 && !retainedDeletion ? [{ $eq: [userStorageAllowanceExpression, null] }] : []),
      { $lte: [{ $add: [{ $ifNull: ['$crystal.storagePendingBytes', 0] }, grossBytes] }, USER_STORAGE_PENDING_LIMIT_BYTES] },
      { $lt: [{ $ifNull: ['$crystal.storagePendingCount', 0] }, Number.MAX_SAFE_INTEGER] }
    ] }
  } as any, [{ $set: {
    'crystal.storagePendingBytes': { $add: [{ $ifNull: ['$crystal.storagePendingBytes', 0] }, grossBytes] },
    'crystal.storagePendingCount': { $add: [{ $ifNull: ['$crystal.storagePendingCount', 0] }, 1] },
    'crystal.storagePendingSince': { $ifNull: ['$crystal.storagePendingSince', at] },
    'crystal.storageUpdatedAt': at
  } }], { session, returnDocument: 'after' });
  if (!reserved) {
    throw new StorageMutationError(503, 'accounting_unavailable', 'Account storage recovery is busy; pending changes will be reconciled before more growth can be saved');
  }
  await things.insertOne({
    shareId: `storage-pending-${operationId}`, schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
    thingtime: [STORAGE_PENDING_THINGTIME], ownerId, acl: [ACL_OWNER], targetId: null, tags: [],
    storageClass: 'control', crystal: { quotaKind: STORAGE_PENDING_THINGTIME, operationId, deltaBytes, positiveBytes: grossBytes, reason: retainedDeletion ? 'deletion-retention' : 'mutation' },
    createdAt: at, updatedAt: at
  }, { session });
  await ensureUserStorageRecoveryJob(ownerId, session);
  return true;
};

// Apply an exact account-wide content delta inside the SAME Mongo transaction
// as the content write. Positive growth is guarded by the entitlement stored
// on this subscription Thing. Shrinks/deletes normally decrement exactly; a
// pre-existing corrupt underflow is kept conservative, marks the ledger for
// reconciliation, and does not prevent the user from deleting content.
export const applyUserStorageDelta = async (ownerId: string, deltaBytes: number, session: any): Promise<void> => {
  if (deltaBytes === 0 || ownerId.startsWith('sandbox:')) return;
  if (!session || (typeof session.inTransaction === 'function' && !session.inTransaction())) throw new StorageMutationError(500, 'storage_invariant', 'Account storage mutations require the content transaction');
  if (!Number.isSafeInteger(deltaBytes)) {
    throw new StorageMutationError(500, 'storage_invariant', 'Storage accounting received an invalid byte delta');
  }
  const things = await getThingsCollection();
  const now = new Date();
  if (deltaBytes > 0) {
    await synchronizeCharacterStorageTier(ownerId, session);
    const reserve = () =>
      things.findOneAndUpdate(
        {
          ...readyUserStorageMatch(ownerId),
          $expr: {
            $and: [
              safeWholeNumberExpression('$crystal.storageUsedBytes'),
              {
                $let: {
                  vars: { allowance: userStorageAllowanceExpression },
                  in: {
                    $or: [
                      { $eq: ['$$allowance', null] },
                      { $lte: [{ $add: ['$crystal.storageUsedBytes', deltaBytes] }, '$$allowance'] }
                    ]
                  }
                }
              }
            ]
          }
        } as any,
        {
          $inc: { 'crystal.storageUsedBytes': deltaBytes },
          $set: { 'crystal.storageUpdatedAt': now }
        },
        { session, returnDocument: 'after' }
      );
    let updated = await reserve();
    if (!updated && await queueUserStorageDelta(ownerId, deltaBytes, session)) return;
    if (!updated) await explainPositiveAdmissionFailure(ownerId, deltaBytes, session);
    return;
  }

  const bytes = -deltaBytes;
  const decremented = await things.findOneAndUpdate(
    {
      ...readyUserStorageMatch(ownerId),
      'crystal.storageUsedBytes': { $gte: bytes },
      $expr: safeWholeNumberExpression('$crystal.storageUsedBytes')
    } as any,
    {
      $inc: { 'crystal.storageUsedBytes': -bytes },
      $set: { 'crystal.storageUpdatedAt': now }
    },
    { session, returnDocument: 'after' }
  );
  if (decremented) return;
  if (await queueUserStorageDelta(ownerId, deltaBytes, session)) return;

  // Missing/pre-migration ledgers have nothing authoritative to decrement and
  // must never block deletion. An initialized-but-inconsistent ledger is
  // fenced from new growth until the source-document reconciliation repairs it.
  await markUserStorageNeedsReconcile(ownerId, session, now);
};

/** Only the Timeline deletion recorder calls this, after the canonical delete
 * refunded the exact removed payload in the SAME transaction. It moves those
 * bytes into retained history without admitting new customer content. Existing
 * overage must not block cleanup. Unknown ledgers remain fenced for reconcile. */
export const retainDeletedThingStorage = async (ownerId: string, bytes: number, session: any): Promise<void> => {
  if (!session || (typeof session.inTransaction === 'function' && !session.inTransaction()) || !Number.isSafeInteger(bytes) || bytes < 0) throw new StorageMutationError(500, 'storage_invariant', 'Invalid retained deletion storage');
  if (!bytes) return;
  const result = await (await getThingsCollection()).updateOne({
    ...readyUserStorageMatch(ownerId),
    $expr: { $and: [safeWholeNumberExpression('$crystal.storageUsedBytes'), { $lte: [{ $add: ['$crystal.storageUsedBytes', bytes] }, Number.MAX_SAFE_INTEGER] }] }
  } as any, { $inc: { 'crystal.storageUsedBytes': bytes }, $set: { 'crystal.storageUpdatedAt': new Date() } }, { session });
  if (!result.matchedCount && !await queueUserStorageDelta(ownerId, bytes, session, true)) await markUserStorageNeedsReconcile(ownerId, session);
};

// Recovery path for a delete whose persisted byte stamp cannot be trusted.
// Touching the same subscription row in the delete transaction serializes it
// against reconciliation even when it was already initializing/non-ready.
export const markUserStorageNeedsReconcile = async (
  ownerId: string,
  session: any,
  now = new Date()
): Promise<void> => {
  const fenced = await (await getThingsCollection()).updateOne(
    {
      ...userSubscriptionLedgerMatch(ownerId),
      'crystal.storageAccountingVersion': USER_STORAGE_ACCOUNTING_VERSION
    },
    {
      $set: {
        'crystal.storageLedgerStatus': USER_STORAGE_STATUS.needsReconcile,
        'crystal.storageUpdatedAt': now
      }
    },
    { session }
  );
  if (fenced.matchedCount) await ensureUserStorageRecoveryJob(ownerId, session);
};

// Exact repair primitive. Because every normal content mutation touches this
// same subscription ledger in its transaction, the snapshot aggregate and
// ledger write conflict/retry against concurrent writers. The resulting total
// is therefore from one serializable point, not a racy best-effort sum.
export const reconcileUserStorage = async (ownerId: string): Promise<UserStorageUsage> =>
  withHomeMongoTransaction(async (session) => {
    const repaired = await reconcileUserStorageInTransaction(ownerId, session);
    if (!repaired) {
      throw new StorageMutationError(503, 'accounting_unavailable', 'The account subscription ledger is missing');
    }
    return usageFromSubscriptionDoc(repaired);
  });


export type UserStorageRecoveryResult = {
  state: 'ready' | 'pending' | 'blocked';
  stamped: number;
  afterShareId?: string;
  reason?: 'schema-migration-required' | 'invalid-source' | 'ledger-unavailable';
};

// Called by the durable, per-account recovery worker, never inside an active
// content mutation. A census taken after a source UPDATE must not add that
// mutation's delta again. Authoritative source totals supersede pending deltas.
export const recoverUserStorageAccounting = async (
  ownerId: string,
  options: { assertLease: (session: any) => Promise<void>; maxDocuments?: number; afterShareId?: string; deadlineAt?: number }
): Promise<UserStorageRecoveryResult> => {
  if (typeof options?.assertLease !== 'function') throw new Error('Storage recovery requires a current durable lease');
  const maxDocuments = options.maxDocuments ?? 100;
  if (!Number.isSafeInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > 1000) throw new Error('Invalid storage recovery processing batch');
  const things = await getThingsCollection();
  const invalidMatch = { ownerId, $expr: billableStorageCandidateExpression, $nor: [currentStorageSourceMatch] };
  const sourceMatch = { ownerId, $expr: billableStorageCandidateExpression, ...(options.afterShareId ? { shareId: { $gt: options.afterShareId } } : {}) };
  const candidates = await things.find(sourceMatch as any).sort({ shareId: 1 }).limit(maxDocuments).maxTimeMS(5_000).toArray();
  let stamped = 0;
  let processedShareId = options.afterShareId;
  for (const candidate of candidates) {
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) return { state: 'pending', stamped, ...(processedShareId ? { afterShareId: processedShareId } : {}) };
    if (typeof candidate.shareId !== 'string' || !candidate.shareId) return { state: 'blocked', stamped, reason: 'invalid-source' };
    const outcome = await withHomeMongoTransaction(async (session) => {
      await options.assertLease(session);
      const ledger = await things.findOne(subscriptionThingMatch('user', ownerId), { session });
      if (!ledger || !userSubscriptionLedgerEnvelopeIsTrusted(ledger, ownerId) ||
          ledger.crystal?.storageAccountingVersion !== USER_STORAGE_ACCOUNTING_VERSION ||
          ![USER_STORAGE_STATUS.ready, USER_STORAGE_STATUS.needsReconcile].includes(ledger.crystal?.storageLedgerStatus) ||
          !userStorageAllowanceIsValid(ledger.crystal)) return 'ledger-unavailable' as const;
      const source = await things.findOne({ _id: candidate._id, ownerId, $expr: billableStorageCandidateExpression } as any, { session });
      if (!source) return 'gone' as const;
      if (source.schemaVersion !== COLLECTION_SCHEMA_VERSIONS.things || !Array.isArray(source.thingtime)) return 'schema-migration-required' as const;
      if (storageSandboxState(source) !== 'real') return 'invalid-source' as const;
      if (currentContentStorageSizeBytes(source) !== null) return 'current' as const;
      let sizeBytes: number;
      try { sizeBytes = thingStorageSizeBytes(source); } catch { return 'invalid-source' as const; }
      // Serialize with every normal writer and queue reservation. Only source
      // stamps change; ownership, audience, payload and byte semantics remain.
      const fenced = await things.updateOne(userSubscriptionLedgerMatch(ownerId) as any, { $set: {
        'crystal.storageLedgerStatus': USER_STORAGE_STATUS.needsReconcile,
        'crystal.storageUpdatedAt': new Date()
      } }, { session });
      if (!fenced.matchedCount) return 'ledger-unavailable' as const;
      const result = await things.updateOne(exactDocumentSnapshotMatch(source) as any, { $set: {
        storageClass: 'content', storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION, sizeBytes
      } }, { session });
      await options.assertLease(session);
      return result.modifiedCount ? 'stamped' as const : 'gone' as const;
    });
    if (outcome === 'stamped') stamped += 1;
    else if (outcome !== 'gone' && outcome !== 'current') return { state: 'blocked', stamped, reason: outcome };
    processedShareId = candidate.shareId;
  }
  if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) return { state: 'pending', stamped, ...(processedShareId ? { afterShareId: processedShareId } : {}) };
  const lastShareId = candidates.at(-1)?.shareId;
  if (lastShareId && await things.findOne({ ownerId, shareId: { $gt: lastShareId }, $expr: billableStorageCandidateExpression } as any, { projection: { _id: 1 }, maxTimeMS: 5_000 })) return { state: 'pending', stamped, afterShareId: lastShareId };
  if (await things.findOne(invalidMatch as any, { projection: { _id: 1 }, maxTimeMS: 5_000 })) return { state: 'pending', stamped };
  return withHomeMongoTransaction(async (session) => {
    await options.assertLease(session);
    const ledger = await things.findOne(subscriptionThingMatch('user', ownerId), { session });
    if (!ledger || !userSubscriptionLedgerEnvelopeIsTrusted(ledger, ownerId) ||
        ledger.crystal?.storageAccountingVersion !== USER_STORAGE_ACCOUNTING_VERSION ||
        ![USER_STORAGE_STATUS.ready, USER_STORAGE_STATUS.needsReconcile].includes(ledger.crystal?.storageLedgerStatus) ||
        !userStorageAllowanceIsValid(ledger.crystal)) return { state: 'blocked', stamped, reason: 'ledger-unavailable' as const };
    const reconciled = await reconcileUserStorageInTransaction(ownerId, session);
    await options.assertLease(session);
    return reconciled ? { state: 'ready', stamped } : { state: 'blocked', stamped, reason: 'ledger-unavailable' as const };
  });
};
