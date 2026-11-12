import { userSubscriptionLedgerEnvelopeIsTrusted } from '../subscriptions/subscriptionIdentity';
import { StorageMutationError, USER_STORAGE_ACCOUNTING_VERSION, USER_STORAGE_STATUS } from './storageCore';

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

/** Shared admission proof for an ordinary account's stored entitlement. Does
 * not reconcile, inherit Character entitlements or perform a storage write. */
export const readyUserStorageAdmission = (existing: any, ownerId: string): { usedBytes: number; allowanceBytes: number | null } => {
 if (!existing || !userSubscriptionLedgerEnvelopeIsTrusted(existing, ownerId) ||
     existing.crystal?.storageAccountingVersion !== USER_STORAGE_ACCOUNTING_VERSION ||
     existing.crystal?.storageLedgerStatus !== USER_STORAGE_STATUS.ready ||
     !Number.isSafeInteger(existing.crystal?.storageUsedBytes) || existing.crystal.storageUsedBytes < 0 ||
     !userStorageAllowanceIsValid(existing.crystal)) {
  throw new StorageMutationError(503, 'accounting_unavailable', 'Account storage accounting is being initialized — try again shortly');
 }
 return { usedBytes: Number(existing.crystal.storageUsedBytes), allowanceBytes: userStorageAllowanceFromCrystal(existing.crystal) };
};

export const assertUserStorageQuota = (usedBytes: number, allowanceBytes: number | null, deltaBytes: number): void => {
 if (allowanceBytes !== null && usedBytes + deltaBytes > allowanceBytes) {
  throw new StorageMutationError(507, 'quota_exceeded', `This change needs more account storage (${usedBytes} of ${allowanceBytes} bytes used). Saved history also uses storage; deleting a Thing keeps its recorded history.`);
 }
};
