import { createHash } from 'node:crypto';

import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, USER_STORAGE_LEDGER_ENVELOPE_VERSION } from '../../../schemas/registry.ts';
import { QUOTA_OVERRIDE_BOUNDS, QUOTA_OVERRIDE_FIELDS, REQUIRED_TIER_QUOTA_FIELDS } from './tierCatalog.ts';

export type SubscriptionIdentitySubject = 'user' | 'app';

export const subscriptionShareId = (subjectType: SubscriptionIdentitySubject, subjectId: string): string =>
	`subscription-${createHash('sha256').update(subjectType).update('\0').update(subjectId).digest('hex').slice(0, 48)}`;

export const subscriptionThingMatch = (subjectType: SubscriptionIdentitySubject, subjectId: string) => ({
	shareId: subscriptionShareId(subjectType, subjectId),
	thingtime: 'subscription'
});

export const USER_SUBSCRIPTION_ROOT_KEYS = [
	'_id',
	'shareId',
	'schemaVersion',
	'thingtime',
	'crystal',
	'ownerId',
	'acl',
	'targetId',
	'tags',
	'storageLedgerEnvelopeVersion',
	'createdAt',
	'updatedAt'
] as const;

export const USER_SUBSCRIPTION_CRYSTAL_KEYS = [
	'quotaKind',
	'subjectType',
	'subjectId',
	'tier',
	'tierVersionId',
	'tierVersion',
	'tierName',
	'tierMetered',
	'tierQuotas',
	'overrides',
	'note',
	'updatedBy',
	'isDefaultAssignment',
	'storageUsedBytes',
	'storageAccountingVersion',
	'storageLedgerStatus',
	'storageReconciledAt',
	'storageUpdatedAt'
] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => Object.keys(value).every((key) => allowed.includes(key));
const validDate = (value: unknown): boolean => value instanceof Date && Number.isFinite(value.getTime());
const validNullableQuota = (value: unknown): boolean => value === null || (Number.isSafeInteger(value) && Number(value) >= 0);
// Validate stored snapshots without the input sanitizer's coercion/clamping.
// Immutable older revisions legitimately omit newly introduced optional quotas.
const storedQuotaFieldsAreTrusted = (value: unknown): value is Record<string, unknown> =>
	isPlainObject(value) &&
	hasOnlyKeys(value, QUOTA_OVERRIDE_FIELDS) &&
	Object.entries(value).every(([key, quota]) =>
		validNullableQuota(quota) &&
		(key !== 'speedTestsPerHour' || quota === null || Number(quota) <= QUOTA_OVERRIDE_BOUNDS.speedTestsPerHour.max)
	);
const storedTierQuotasAreTrusted = (value: unknown): boolean =>
	storedQuotaFieldsAreTrusted(value) && REQUIRED_TIER_QUOTA_FIELDS.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const storedOverridesAreTrusted = (value: unknown): boolean => value === null || storedQuotaFieldsAreTrusted(value);

const tierAssignmentShapeIsTrusted = (crystal: Record<string, unknown>): boolean => {
	const quotas = crystal.tierQuotas;
	const overrides = crystal.overrides;
	return (
		typeof crystal.tier === 'string' &&
		!!crystal.tier.trim() &&
		typeof crystal.tierVersionId === 'string' &&
		!!crystal.tierVersionId.trim() &&
		Number.isSafeInteger(crystal.tierVersion) &&
		Number(crystal.tierVersion) >= 1 &&
		typeof crystal.tierName === 'string' &&
		typeof crystal.tierMetered === 'boolean' &&
		storedTierQuotasAreTrusted(quotas) &&
		storedOverridesAreTrusted(overrides) &&
		(crystal.note === null || typeof crystal.note === 'string') &&
		(crystal.updatedBy === null || typeof crystal.updatedBy === 'string') &&
		typeof crystal.isDefaultAssignment === 'boolean'
	);
};

const userSubscriptionIdentityIsTrusted = (doc: any, subjectId: string, requireEnvelopeMarker: boolean): boolean =>
	typeof subjectId === 'string' &&
	!!subjectId &&
	isPlainObject(doc) &&
	hasOnlyKeys(doc, USER_SUBSCRIPTION_ROOT_KEYS) &&
	doc.shareId === subscriptionShareId('user', subjectId) &&
	doc.schemaVersion === COLLECTION_SCHEMA_VERSIONS.things &&
	Array.isArray(doc.thingtime) &&
	doc.thingtime.length === 1 &&
	doc.thingtime[0] === 'subscription' &&
	doc.ownerId === subjectId &&
	Array.isArray(doc.acl) &&
	doc.acl.length === 1 &&
	doc.acl[0] === ACL_OWNER &&
	doc.targetId === null &&
	Array.isArray(doc.tags) &&
	doc.tags.length === 0 &&
	(requireEnvelopeMarker
		? doc.storageLedgerEnvelopeVersion === USER_STORAGE_LEDGER_ENVELOPE_VERSION
		: !Object.prototype.hasOwnProperty.call(doc, 'storageLedgerEnvelopeVersion')) &&
	validDate(doc.createdAt) &&
	validDate(doc.updatedAt) &&
	isPlainObject(doc.crystal) &&
	hasOnlyKeys(doc.crystal, USER_SUBSCRIPTION_CRYSTAL_KEYS) &&
	doc.crystal.quotaKind === 'subscription' &&
	doc.crystal.subjectType === 'user' &&
	doc.crystal.subjectId === subjectId &&
	tierAssignmentShapeIsTrusted(doc.crystal);

export const userSubscriptionLedgerEnvelopeIsTrusted = (doc: any, subjectId: string): boolean =>
	userSubscriptionIdentityIsTrusted(doc, subjectId, true);

// Exact pre-marker shape created by the old server. Migration may add only the
// root proof; a squatted row, wrong subject, or extra payload is never blessed.
export const legacyUserSubscriptionLedgerEnvelopeCanUpgrade = (doc: any, subjectId: string): boolean =>
	userSubscriptionIdentityIsTrusted(doc, subjectId, false);

// Operator diagnostics contain only fixed field labels, never stored values or
// arbitrary key names. This does not relax the validator or authorize a repair.
export const userSubscriptionLedgerEnvelopeIssues = (doc: any, subjectId: string): string[] => {
	if (!isPlainObject(doc)) return ['root.object'];
	const issues: string[] = [];
	const check = (field: string, valid: boolean) => {
		if (!valid) issues.push(field);
	};
	check('root.fields', hasOnlyKeys(doc, USER_SUBSCRIPTION_ROOT_KEYS));
	for (const key of ['extended', 'storageClass', 'sizeBytes', 'storageAccountingVersion', 'kind', 'parentId', 'secure', 'uniqueKeys']) {
		if (Object.prototype.hasOwnProperty.call(doc, key)) issues.push(`root.unexpected.${key}`);
	}
	check('root.shareId', typeof subjectId === 'string' && !!subjectId && doc.shareId === subscriptionShareId('user', subjectId));
	check('root.schemaVersion', doc.schemaVersion === COLLECTION_SCHEMA_VERSIONS.things);
	check('root.thingtime', Array.isArray(doc.thingtime) && doc.thingtime.length === 1 && doc.thingtime[0] === 'subscription');
	check('root.ownerId', doc.ownerId === subjectId);
	check('root.acl', Array.isArray(doc.acl) && doc.acl.length === 1 && doc.acl[0] === ACL_OWNER);
	check('root.targetId', doc.targetId === null);
	check('root.tags', Array.isArray(doc.tags) && doc.tags.length === 0);
	check(
		'root.storageLedgerEnvelopeVersion',
		!Object.prototype.hasOwnProperty.call(doc, 'storageLedgerEnvelopeVersion') ||
			doc.storageLedgerEnvelopeVersion === USER_STORAGE_LEDGER_ENVELOPE_VERSION
	);
	check('root.createdAt', validDate(doc.createdAt));
	check('root.updatedAt', validDate(doc.updatedAt));
	if (!isPlainObject(doc.crystal)) return [...issues, 'crystal.object'];
	const c = doc.crystal;
	check('crystal.fields', hasOnlyKeys(c, USER_SUBSCRIPTION_CRYSTAL_KEYS));
	check('crystal.quotaKind', c.quotaKind === 'subscription');
	check('crystal.subjectType', c.subjectType === 'user');
	check('crystal.subjectId', c.subjectId === subjectId);
	check('crystal.tier', typeof c.tier === 'string' && !!c.tier.trim());
	check('crystal.tierVersionId', typeof c.tierVersionId === 'string' && !!c.tierVersionId.trim());
	check('crystal.tierVersion', Number.isSafeInteger(c.tierVersion) && Number(c.tierVersion) >= 1);
	check('crystal.tierName', typeof c.tierName === 'string');
	check('crystal.tierMetered', typeof c.tierMetered === 'boolean');
	check('crystal.tierQuotas', storedTierQuotasAreTrusted(c.tierQuotas));
	check('crystal.overrides', storedOverridesAreTrusted(c.overrides));
	check('crystal.note', c.note === null || typeof c.note === 'string');
	check('crystal.updatedBy', c.updatedBy === null || typeof c.updatedBy === 'string');
	check('crystal.isDefaultAssignment', typeof c.isDefaultAssignment === 'boolean');
	// Keep diagnostics fail-closed if the canonical validator gains a rule.
	if (!issues.length && !userSubscriptionLedgerEnvelopeIsTrusted(doc, subjectId) && !legacyUserSubscriptionLedgerEnvelopeCanUpgrade(doc, subjectId))
		issues.push('envelope.unclassified');
	return issues;
};

const objectKeysSubsetExpression = (value: string, allowed: readonly string[]) => ({
	$setIsSubset: [
		{
			$map: {
				input: {
					$cond: [{ $eq: [{ $type: value }, 'object'] }, { $objectToArray: value }, []]
				},
				as: 'field',
				in: '$$field.k'
			}
		},
		[...allowed]
	]
});

// Shared hot-path identity. Counter-specific status/value predicates compose
// on top of this exact envelope; reads use the matching JS validator so a
// malformed row cannot display exact while writes fail closed.
const userSubscriptionLedgerMongoMatch = (subjectId: string, envelopeVersion: number | { $exists: false }) => ({
	shareId: subscriptionShareId('user', subjectId),
	schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
	thingtime: ['subscription'],
	ownerId: subjectId,
	acl: [ACL_OWNER],
	targetId: null,
	tags: [],
	storageLedgerEnvelopeVersion: envelopeVersion,
	createdAt: { $type: 'date' },
	updatedAt: { $type: 'date' },
	'crystal.quotaKind': 'subscription',
	'crystal.subjectType': 'user',
	'crystal.subjectId': subjectId,
	$and: [
		{
			$expr: {
				$and: [
					objectKeysSubsetExpression('$$ROOT', USER_SUBSCRIPTION_ROOT_KEYS),
					objectKeysSubsetExpression('$crystal', USER_SUBSCRIPTION_CRYSTAL_KEYS)
				]
			}
		}
	]
});

export const userSubscriptionLedgerMatch = (subjectId: string) => userSubscriptionLedgerMongoMatch(subjectId, USER_STORAGE_LEDGER_ENVELOPE_VERSION);

export const legacyUserSubscriptionLedgerMatch = (subjectId: string) => userSubscriptionLedgerMongoMatch(subjectId, { $exists: false });
