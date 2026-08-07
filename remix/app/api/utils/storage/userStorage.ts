import { getThingsCollection, withMongoTransaction } from '../mongodb/collections';
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
  realStorageSourceExpression,
  type UserStorageUsage
} from './storageCore';
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry';

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
  'crystal.storageUsedBytes': { $gte: 0 }
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
  return usageFromSubscriptionDoc(doc);
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
  const ownerByShareId = new Map(ids.map((id) => [subscriptionThingMatch('user', id).shareId, id]));
  const usages = new Map<string, UserStorageUsage>();
  for (const ownerId of ids) usages.set(ownerId, unavailableUserStorageUsage());
  for (const doc of docs) {
    const ownerId = ownerByShareId.get(String(doc.shareId));
    if (ownerId && userSubscriptionLedgerEnvelopeIsTrusted(doc, ownerId)) {
      usages.set(ownerId, usageFromSubscriptionDoc(doc));
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
      `This would exceed the account storage allowance (${usedBytes} of ${allowanceBytes} bytes used — delete content or change tier)`
    );
  }
  throw new StorageMutationError(503, 'accounting_unavailable', 'Account storage accounting is unavailable — try again');
};

const reconcileUserStorageInTransaction = async (
  ownerId: string,
  session: any,
  requiredStatus?: typeof USER_STORAGE_STATUS.needsReconcile
): Promise<any | null> => {
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
              {
                $match: {
                  schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
                  thingtime: { $type: 'array' },
                  storageClass: 'content',
                  storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
                  sizeBytes: { $type: 'number', $gte: 0, $lte: Number.MAX_SAFE_INTEGER }
                }
              },
              { $match: { $expr: realStorageSourceExpression } },
              {
                $match: {
                  $expr: {
                    $eq: [
                      '$sizeBytes',
                      { $convert: { input: '$sizeBytes', to: 'long', onError: null, onNull: null } }
                    ]
                  }
                }
              },
              { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$sizeBytes' } } }
            ]
          }
        }
      ],
      { session }
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
  return things.findOneAndUpdate(
    {
      ...userSubscriptionLedgerMatch(ownerId),
      ...(requiredStatus
        ? {
            'crystal.storageAccountingVersion': USER_STORAGE_ACCOUNTING_VERSION,
            'crystal.storageLedgerStatus': requiredStatus
          }
        : {})
    },
    {
      $set: {
        'crystal.storageUsedBytes': usedBytes,
        'crystal.storageAccountingVersion': USER_STORAGE_ACCOUNTING_VERSION,
        'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready,
        'crystal.storageReconciledAt': now,
        'crystal.storageUpdatedAt': now
      }
    },
    { session, returnDocument: 'after' }
  );
};

// Apply an exact account-wide content delta inside the SAME Mongo transaction
// as the content write. Positive growth is guarded by the entitlement stored
// on this subscription Thing. Shrinks/deletes normally decrement exactly; a
// pre-existing corrupt underflow is kept conservative, marks the ledger for
// reconciliation, and does not prevent the user from deleting content.
export const applyUserStorageDelta = async (ownerId: string, deltaBytes: number, session: any): Promise<void> => {
  if (deltaBytes === 0 || ownerId.startsWith('sandbox:')) return;
  if (!Number.isSafeInteger(deltaBytes)) {
    throw new StorageMutationError(500, 'storage_invariant', 'Storage accounting received an invalid byte delta');
  }
  const things = await getThingsCollection();
  const now = new Date();
  if (deltaBytes > 0) {
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
    if (!updated) {
      // An underflow fence is recoverable from the stamped source documents.
      // Repair it in this same transaction, then apply this growth exactly
      // once. Initializing/unknown ledgers still fail closed for the migration.
      const repaired = await reconcileUserStorageInTransaction(
        ownerId,
        session,
        USER_STORAGE_STATUS.needsReconcile
      );
      if (repaired) updated = await reserve();
    }
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

  // Missing/pre-migration ledgers have nothing authoritative to decrement and
  // must never block deletion. An initialized-but-inconsistent ledger is
  // fenced from new growth until the source-document reconciliation repairs it.
  await markUserStorageNeedsReconcile(ownerId, session, now);
};

// Recovery path for a delete whose persisted byte stamp cannot be trusted.
// Touching the same subscription row in the delete transaction serializes it
// against reconciliation even when it was already initializing/non-ready.
export const markUserStorageNeedsReconcile = async (
  ownerId: string,
  session: any,
  now = new Date()
): Promise<void> => {
  await (await getThingsCollection()).updateOne(
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
};

// Exact repair primitive. Because every normal content mutation touches this
// same subscription ledger in its transaction, the snapshot aggregate and
// ledger write conflict/retry against concurrent writers. The resulting total
// is therefore from one serializable point, not a racy best-effort sum.
export const reconcileUserStorage = async (ownerId: string): Promise<UserStorageUsage> =>
  withMongoTransaction(async (session) => {
    const repaired = await reconcileUserStorageInTransaction(ownerId, session);
    if (!repaired) {
      throw new StorageMutationError(503, 'accounting_unavailable', 'The account subscription ledger is missing');
    }
    return usageFromSubscriptionDoc(repaired);
  });
