// Operational pending budget, not an individual Thing or file size limit.
export const USER_STORAGE_PENDING_LIMIT_BYTES = 100 * 1024 * 1024;
export const USER_STORAGE_PENDING_FIELDS = ['storagePendingBytes', 'storagePendingCount', 'storagePendingSince'] as const;

export const userStoragePendingStateIsTrusted = (crystal: any): boolean => {
  const present = USER_STORAGE_PENDING_FIELDS.filter(key => Object.prototype.hasOwnProperty.call(crystal ?? {}, key));
  if (!present.length) return true;
  return present.length === USER_STORAGE_PENDING_FIELDS.length &&
    Number.isSafeInteger(crystal.storagePendingBytes) && crystal.storagePendingBytes >= 0 && crystal.storagePendingBytes <= USER_STORAGE_PENDING_LIMIT_BYTES &&
    Number.isSafeInteger(crystal.storagePendingCount) && crystal.storagePendingCount > 0 &&
    crystal.storagePendingSince instanceof Date && Number.isFinite(crystal.storagePendingSince.getTime());
};

export const userStoragePendingMongoExpression = {
  $or: [
    { $and: USER_STORAGE_PENDING_FIELDS.map(key => ({ $eq: [{ $type: `$crystal.${key}` }, 'missing'] })) },
    { $and: [
      ...['storagePendingBytes', 'storagePendingCount'].map(key => ({ $and: [
        { $isNumber: `$crystal.${key}` },
        { $eq: [`$crystal.${key}`, { $convert: { input: `$crystal.${key}`, to: 'long', onError: null, onNull: null } }] },
        { $gte: [`$crystal.${key}`, key === 'storagePendingCount' ? 1 : 0] },
        { $lte: [`$crystal.${key}`, key === 'storagePendingBytes' ? USER_STORAGE_PENDING_LIMIT_BYTES : Number.MAX_SAFE_INTEGER] }
      ] })),
      { $eq: [{ $type: '$crystal.storagePendingSince' }, 'date'] }
    ] }
  ]
};
