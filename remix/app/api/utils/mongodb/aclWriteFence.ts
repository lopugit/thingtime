/** Persisted compatibility contract, enforced by MongoDB even for old API
 * instances that do not know relational grants. No account data is published. */
export const ACL_ROOT_BASELINE = ['tt:all', 'tt:user', 'tt:userFriends', 'tt:userFamily', 'tt:inherit', 'tt:hidden', 'tt:custom', 'tt:extsourced', 'tt:service-workspace'];

const stringValue = (value: any) => ({ $cond: [{ $eq: [{ $type: value }, 'string'] }, value, ''] });
const nonemptyString = (value: string) => ({ $and: [{ $eq: [{ $type: value }, 'string'] }, { $ne: [value, ''] }] });
const baseline = { $cond: [{ $isArray: '$aclBaseline' }, '$aclBaseline', []] };
const unsigned = { $let: { vars: { entry: stringValue('$$this') }, in: {
  $cond: [{ $eq: [{ $substrCP: ['$$entry', 0, 1] }, '-'] }, { $substrCP: ['$$entry', 1, { $strLenCP: '$$entry' }] }, '$$entry']
} } };
const negative = { $concat: ['-', unsigned] };
// Reduce preserves the same ordered de-duplication as legacyAclFence, including
// a positive owner marker followed by a negative owner hint when necessary.
const fence = { $concatArrays: [['tt:user'], { $reduce: { input: baseline, initialValue: [], in: {
  $cond: [{ $in: [negative, '$$value'] }, '$$value', { $concatArrays: ['$$value', [negative]] }]
} } }] };

export const THING_ACL_WRITE_FENCE = { $expr: { $and: [
  { $cond: [{ $eq: [{ $type: '$aclGeneration' }, 'missing'] }, true, { $and: [
    nonemptyString('$aclGeneration'),
    { $eq: ['$aclBaselineVersion', 1] }, { $isArray: '$aclBaseline' },
    { $allElementsTrue: [{ $map: { input: baseline, in: { $and: [
      { $eq: [{ $type: '$$this' }, 'string'] },
      { $or: [{ $in: [unsigned, ACL_ROOT_BASELINE] }, { $and: [
        nonemptyString('$appId'), { $eq: [unsigned, { $concat: ['tt:app/', stringValue('$appId')] }] }
      ] }] }
    ] } } }] },
    { $eq: ['$acl', fence] }
  ] }] },
  { $cond: [{ $eq: [{ $type: '$tokenAclGeneration' }, 'missing'] }, true, { $and: [
    nonemptyString('$tokenAclGeneration'), { $eq: ['$tokenAcl', []] }
  ] }] },
  // The first relational release predates the timestamp floor. Its exact
  // negative audience/token fences remain mandatory above. Only an ABSENT
  // floor selects that legacy format: null, other types and a regressed
  // timestamp never do. Current content/ACL writers upgrade it atomically.
  { $cond: [{ $and: [{ $eq: [{ $type: '$aclGeneration' }, 'missing'] }, { $eq: [{ $type: '$tokenAclGeneration' }, 'missing'] }] }, true, { $and: [
    { $eq: [{ $type: '$updatedAt' }, 'date'] },
    { $or: [
      { $eq: [{ $type: '$aclWriteFenceAfter' }, 'missing'] },
      { $and: [{ $eq: [{ $type: '$aclWriteFenceAfter' }, 'date'] }, { $gte: ['$updatedAt', '$aclWriteFenceAfter'] }] }
    ] }
  ] }] }
] } };

// Recognize only the byte-structural canonical rule shipped by the earlier
// guard implementation. Unknown validators remain independent constraints.
const previousWriteFence = { $expr: { $and: [
  ...THING_ACL_WRITE_FENCE.$expr.$and.slice(0, 2),
  { $cond: [(THING_ACL_WRITE_FENCE.$expr.$and[2] as any).$cond[0], true, { $and: [
    { $eq: [{ $type: '$aclWriteFenceAfter' }, 'date'] }, { $eq: [{ $type: '$updatedAt' }, 'date'] },
    { $gte: ['$updatedAt', '$aclWriteFenceAfter'] }
  ] }] }
] } };
const sameRule = (left: any, right: any): boolean => JSON.stringify(left) === JSON.stringify(right);
const containsRule = (validator: any, rule: any): boolean => sameRule(validator, rule) ||
  (Array.isArray(validator?.$and) && validator.$and.some((entry: any) => containsRule(entry, rule)));
const containsFence = (validator: any): boolean => containsRule(validator, THING_ACL_WRITE_FENCE);
const containsPreviousFence = (validator: any): boolean => containsRule(validator, previousWriteFence);
const upgradePreviousFence = (validator: any): any => {
  if (sameRule(validator, previousWriteFence)) return THING_ACL_WRITE_FENCE;
  if (!Array.isArray(validator?.$and)) return validator;
  const entries = validator.$and.map(upgradePreviousFence);
  return entries.some((entry: any, index: number) => entry !== validator.$and[index]) ? { ...validator, $and: entries } : validator;
};

export type AclWriteFenceStage = 'connect' | 'adoption' | 'inspect' | 'create' | 'modify' | 'verify' | 'selection';
export type AclWriteFenceCategory = 'unauthorized' | 'authentication' | 'timeout' | 'connection' | 'unsupported' | 'not-ready' | 'wrong-plane' | 'unknown';

// Driver messages can contain credentials, hosts, command bodies and user data.
// Retain only this closed diagnostic vocabulary, never the original cause.
export class AclWriteFenceError extends Error {
  readonly stage: AclWriteFenceStage;
  readonly category: AclWriteFenceCategory;
  constructor(stage: AclWriteFenceStage, category: AclWriteFenceCategory) {
    super(`Relational grant storage protection is unavailable (${stage}/${category}). Database validation must be provisioned before editing grants.`);
    this.name = 'AclWriteFenceError'; this.stage = stage; this.category = category;
  }
}
export const aclWriteFenceError = (error: any, stage: AclWriteFenceStage): AclWriteFenceError => {
  if (error instanceof AclWriteFenceError) return error;
  const category: AclWriteFenceCategory = error?.code === 13 ? 'unauthorized' : error?.code === 18 ? 'authentication' :
    [50, 262].includes(error?.code) || ['MongoOperationTimeoutError', 'MongoNetworkTimeoutError', 'TimeoutError', 'AbortError'].includes(error?.name) ? 'timeout' :
    ['MongoNetworkError', 'MongoServerSelectionError'].includes(error?.name) ? 'connection' :
    [2, 9, 59, 72, 115].includes(error?.code) ? 'unsupported' : 'unknown';
  return new AclWriteFenceError(stage, category);
};
const atStage = async <T>(stage: AclWriteFenceStage, work: () => Promise<T>): Promise<T> => {
  try { return await work(); } catch (error) { throw aclWriteFenceError(error, stage); }
};
const collectionInfo = (db: any, collectionName: string, stage: 'inspect' | 'verify') =>
  atStage(stage, async () => (await db.listCollections({ name: collectionName }, { timeoutMS: 5000 }).toArray())[0]);
const readyOptions = (options: any): boolean => containsFence(options?.validator) && !containsPreviousFence(options?.validator) &&
  (options?.validationLevel || 'strict') === 'strict' && (options?.validationAction || 'error') === 'error';

export const isThingAclWriteFenceReady = async (db: any, collectionName: string): Promise<boolean> =>
  readyOptions((await collectionInfo(db, collectionName, 'inspect'))?.options);

/** Provision outside content transactions. Existing constraints remain in the
 * conjunction; strict/error is mandatory, including for already-invalid rows.
 * Old runtimes cannot weaken this contract by updating the root document. */
export const installThingAclWriteFence = async (db: any, collectionName: string): Promise<void> => {
  let existing = await collectionInfo(db, collectionName, 'inspect');
  if (!existing) {
    await atStage('create', async () => {
      try {
        await db.createCollection(collectionName, { validator: THING_ACL_WRITE_FENCE, validationLevel: 'strict', validationAction: 'error', timeoutMS: 5000 });
      } catch (error: any) { if (error?.code !== 48) throw error; }
    });
    existing = await collectionInfo(db, collectionName, 'inspect');
  }
  const options = existing?.options || {};
  if (!readyOptions(options)) {
    const previous = upgradePreviousFence(options.validator);
    const validator = containsFence(previous) ? previous : previous && Object.keys(previous).length ? { $and: [previous, THING_ACL_WRITE_FENCE] } : THING_ACL_WRITE_FENCE;
    await atStage('modify', () => db.command({ collMod: collectionName, validator, validationLevel: 'strict', validationAction: 'error', maxTimeMS: 5000 }, { timeoutMS: 5000 }));
  }
  if (!readyOptions((await collectionInfo(db, collectionName, 'verify'))?.options))
    throw new AclWriteFenceError('verify', 'not-ready');
};
