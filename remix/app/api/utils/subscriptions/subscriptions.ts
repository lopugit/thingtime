import { getThingsCollection } from '../mongodb/collections';
import { ACL_OWNER, APP_STORAGE_ACCOUNTING_VERSION, COLLECTION_SCHEMA_VERSIONS, USER_STORAGE_LEDGER_ENVELOPE_VERSION } from '~/schemas/registry';
import {
  DEFAULT_SUBSCRIPTION_TIER,
  isKnownSubscriptionTier,
  resolveQuotas,
  sanitizeQuotaOverrides,
  subscriptionTierById,
  type QuotaOverrides,
  type SubscriptionTierId,
  type TierQuotas
} from './tierCatalog';
import { getLiveSubscriptionTier, getSubscriptionTierVersion, tierAssignmentSnapshot, tierQuotasFromUnknown } from './tierCatalogStore';
import {
	subscriptionShareId,
	subscriptionThingMatch,
	userSubscriptionLedgerEnvelopeIsTrusted,
	userSubscriptionLedgerMatch
} from './subscriptionIdentity';
import { USER_STORAGE_ACCOUNTING_VERSION, USER_STORAGE_STATUS, normalizedStorageUsage, type UserStorageUsage } from '../storage/storageCore';

// Subscription assignments (FUNDAMENTALS.md: everything is a thing). USER
// assignments are deterministic protected `subscription` Things; generic
// CRUD can never self-assign one. APP assignments use the same service/API
// shape but live directly on the app Thing beside its aggregate usage ledger,
// so entitlement and admission cannot drift across documents.

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export type SubscriptionSubjectType = 'user' | 'app';

const SUBSCRIPTION_KIND = 'subscription';

const subscriptionMatch = subscriptionThingMatch;

const appMatch = (clientId: string) => ({
  thingtime: 'app',
  'crystal.clientId': clientId
});

const hasOwn = (value: unknown, key: string): boolean => !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key);

const safeStoredByteExpression = (field: string) => ({
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

export type SubscriptionInfo = {
  subjectType: SubscriptionSubjectType;
  subjectId: string;
  tier: SubscriptionTierId;
  // Exact immutable catalog revision selected for this assignment.
  tierVersionId: string;
  tierVersion: number;
  tierName: string;
  metered: boolean;
  // null = no admin override (pure tier defaults)
  overrides: QuotaOverrides | null;
  note: string | null;
  updatedBy: string | null;
  updatedAt: Date | null;
  // tier defaults + overrides, merged — what enforcement reads
  effective: TierQuotas;
	// Canonical live byte ledger for this subject. User account storage lives
	// on the protected subscription Thing beside its entitlement; app aggregate
	// storage lives on the app Thing beside the app entitlement.
	storage: UserStorageUsage | null;
  // true = this is the explicitly pinned default assignment (or a legacy
  // subject that predates materialized assignments).
  isDefault: boolean;
};

type TierSnapshot = ReturnType<typeof tierAssignmentSnapshot>;

const staticTierSnapshot = (tierId: unknown): TierSnapshot => {
  const descriptor = isKnownSubscriptionTier(tierId) ? subscriptionTierById(tierId) : subscriptionTierById(DEFAULT_SUBSCRIPTION_TIER);
  return tierAssignmentSnapshot(descriptor);
};

const initialSubscriptionSnapshot = (value: unknown): TierSnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const seed = value as Record<string, unknown>;
  const quotas = tierQuotasFromUnknown(seed.quotas);
  if (
    typeof seed.tierId !== 'string' ||
    !seed.tierId.trim() ||
    typeof seed.versionId !== 'string' ||
    !seed.versionId.trim() ||
    !Number.isSafeInteger(seed.version) ||
    Number(seed.version) < 1 ||
    typeof seed.title !== 'string' ||
    typeof seed.metered !== 'boolean' ||
    !quotas
  ) {
    return null;
  }
  return {
    tierId: seed.tierId.trim(),
    versionId: seed.versionId.trim(),
    version: Number(seed.version),
    title: seed.title,
    metered: seed.metered,
    quotas
  };
};

const snapshotFromCrystal = (crystal: any, prefix: '' | 'subscription'): TierSnapshot => {
  const field = (name: string) => `${prefix}${prefix ? name.charAt(0).toUpperCase() + name.slice(1) : name}`;
  const rawTier = crystal?.[field('tier')];
  const legacy = staticTierSnapshot(rawTier);
  const quotas = tierQuotasFromUnknown(crystal?.[field('tierQuotas')]) ?? legacy.quotas;
  return {
    tierId: typeof rawTier === 'string' && rawTier.trim() ? rawTier.trim() : legacy.tierId,
    versionId:
      typeof crystal?.[field('tierVersionId')] === 'string' && crystal[field('tierVersionId')] ? crystal[field('tierVersionId')] : legacy.versionId,
    version:
      Number.isSafeInteger(crystal?.[field('tierVersion')]) && Number(crystal[field('tierVersion')]) > 0
        ? Number(crystal[field('tierVersion')])
        : legacy.version,
    title: typeof crystal?.[field('tierName')] === 'string' && crystal[field('tierName')] ? crystal[field('tierName')] : legacy.title,
    metered: typeof crystal?.[field('tierMetered')] === 'boolean' ? crystal[field('tierMetered')] : legacy.metered,
    quotas
  };
};

const defaultSubscription = (
  subjectType: SubscriptionSubjectType,
  subjectId: string,
  snapshot = staticTierSnapshot(DEFAULT_SUBSCRIPTION_TIER)
): SubscriptionInfo => ({
  subjectType,
  subjectId,
  tier: snapshot.tierId,
  tierVersionId: snapshot.versionId,
  tierVersion: snapshot.version,
  tierName: snapshot.title,
  metered: snapshot.metered,
  overrides: null,
  note: null,
  updatedBy: null,
  updatedAt: null,
  effective: { ...snapshot.quotas },
	storage:
		subjectType === 'user'
			? normalizedStorageUsage({
					usedBytes: 0,
					allowanceBytes: snapshot.quotas.userStorageBytes,
					accountingVersion: null,
					ledgerStatus: null
				})
			: null,
  isDefault: true
});

const toInfo = (subjectType: SubscriptionSubjectType, subjectId: string, doc: any): SubscriptionInfo => {
  const crystal = doc?.crystal ?? {};
  const snapshot = snapshotFromCrystal(crystal, '');
  const sanitized = sanitizeQuotaOverrides(crystal.overrides);
  const overrides = sanitized.ok ? sanitized.overrides : null;
	const effective = resolveQuotas(snapshot.quotas, overrides);
	const rawUserStorageAllowance = hasOwn(crystal.overrides, 'userStorageBytes')
		? crystal.overrides.userStorageBytes
		: crystal?.tierQuotas?.userStorageBytes;
	const userStorageAllowanceValid =
		rawUserStorageAllowance === null || (Number.isSafeInteger(rawUserStorageAllowance) && Number(rawUserStorageAllowance) >= 0);
  return {
    subjectType,
    subjectId,
    tier: snapshot.tierId,
    tierVersionId: snapshot.versionId,
    tierVersion: snapshot.version,
    tierName: snapshot.title,
    metered: snapshot.metered,
    overrides,
    note: typeof crystal.note === 'string' && crystal.note ? crystal.note : null,
    updatedBy: typeof crystal.updatedBy === 'string' ? crystal.updatedBy : null,
    updatedAt: doc?.updatedAt instanceof Date ? doc.updatedAt : null,
		effective,
		storage:
			subjectType === 'user'
				? normalizedStorageUsage({
						usedBytes: crystal.storageUsedBytes,
						allowanceBytes: effective.userStorageBytes,
						allowanceValid: userStorageAllowanceValid,
						accountingVersion: crystal.storageAccountingVersion,
						ledgerStatus: crystal.storageLedgerStatus,
						reconciledAt: crystal.storageReconciledAt
					})
				: null,
    isDefault: crystal.isDefaultAssignment === true
  };
};

// App plans live on the app Thing itself, beside the aggregate byte counter.
// Tier/override changes and the runtime allowance therefore move in one
// atomic update instead of a subscription Thing drifting from the hot ledger.
const toAppInfo = (subjectId: string, doc: any): SubscriptionInfo => {
  if (!doc) return defaultSubscription('app', subjectId);
  const crystal = doc.crystal ?? {};
  const snapshot = snapshotFromCrystal(crystal, 'subscription');
  const hasOverride = hasOwn(crystal, 'storageAllowanceOverrideBytes');
  const rawOverride = crystal.storageAllowanceOverrideBytes;
  const overrideIsValid = rawOverride === null || (Number.isSafeInteger(rawOverride) && Number(rawOverride) >= 0);
  const overrides: QuotaOverrides | null = hasOverride && overrideIsValid ? { appStorageBytes: rawOverride as number | null } : null;
  const effective = resolveQuotas(snapshot.quotas, overrides);
  const actualAllowance = crystal.storageAllowanceBytes;
	const actualAllowanceValid = actualAllowance === null || (Number.isSafeInteger(actualAllowance) && Number(actualAllowance) >= 0);
	if (actualAllowanceValid) {
    effective.appStorageBytes = actualAllowance as number | null;
  }
  return {
    subjectType: 'app',
    subjectId,
    tier: snapshot.tierId,
    tierVersionId: snapshot.versionId,
    tierVersion: snapshot.version,
    tierName: snapshot.title,
    metered: snapshot.metered,
    overrides,
    note: typeof crystal.subscriptionNote === 'string' && crystal.subscriptionNote ? crystal.subscriptionNote : null,
    updatedBy: typeof crystal.subscriptionUpdatedBy === 'string' ? crystal.subscriptionUpdatedBy : null,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt : null,
    effective,
		storage: normalizedStorageUsage({
			usedBytes: crystal.storageUsedBytes,
			allowanceBytes: effective.appStorageBytes,
			allowanceValid: hasOwn(crystal, 'storageAllowanceBytes') && actualAllowanceValid,
			expectedAccountingVersion: APP_STORAGE_ACCOUNTING_VERSION,
			accountingVersion: crystal.storageAccountingVersion,
			ledgerStatus: crystal.storageLedgerStatus,
			reconciledAt: crystal.storageReconciledAt
		}),
    isDefault: snapshot.tierId === DEFAULT_SUBSCRIPTION_TIER && !overrides
  };
};

export const getSubscription = async (subjectType: SubscriptionSubjectType, subjectId: string): Promise<SubscriptionInfo> => {
  const things = await getThingsCollection();
  const doc = await things.findOne(subjectType === 'app' ? appMatch(subjectId) : subscriptionMatch(subjectType, subjectId));
	const trustedUserDoc = subjectType === 'user' && doc && userSubscriptionLedgerEnvelopeIsTrusted(doc, subjectId) ? doc : null;
  const userSeed =
		subjectType === 'user' && !trustedUserDoc
      ? await things.findOne({ shareId: subjectId, thingtime: 'user' }, { projection: { initialSubscription: 1 } })
      : null;
  const pinnedSignup = initialSubscriptionSnapshot(userSeed?.initialSubscription);
  const info =
    subjectType === 'app'
      ? doc
        ? toAppInfo(subjectId, doc)
        : defaultSubscription('app', subjectId)
			: trustedUserDoc
				? toInfo(subjectType, subjectId, trustedUserDoc)
      : defaultSubscription(subjectType, subjectId, pinnedSignup ?? undefined);
  return info;
};

// Batch counterpart for the admin lists: one indexed query for N subjects,
// implicit free for anyone without a doc. Bypasses the cache — admin reads
// want current truth.
export const getSubscriptions = async (subjectType: SubscriptionSubjectType, subjectIds: string[]): Promise<Map<string, SubscriptionInfo>> => {
  const ids = [...new Set(subjectIds.filter((id) => typeof id === 'string' && id))];
  const result = new Map<string, SubscriptionInfo>();
  if (!ids.length) return result;

  const things = await getThingsCollection();
  if (subjectType === 'app') {
    const docs = await things.find({ thingtime: 'app', 'crystal.clientId': { $in: ids } }).toArray();
    const byClientId = new Map(docs.map((doc: any) => [String(doc.crystal?.clientId ?? ''), doc]));
    for (const id of ids) {
      const doc = byClientId.get(id);
      result.set(id, doc ? toAppInfo(id, doc) : defaultSubscription('app', id));
    }
    return result;
  }
  const [docs, users] = await Promise.all([
    things.find({ thingtime: SUBSCRIPTION_KIND, shareId: { $in: ids.map((id) => subscriptionShareId(subjectType, id)) } }).toArray(),
    things.find({ thingtime: 'user', shareId: { $in: ids } }, { projection: { shareId: 1, initialSubscription: 1 } }).toArray()
  ]);
  const byShareId = new Map(docs.map((doc: any) => [doc.shareId, doc]));
  const seedByUserId = new Map<string, TierSnapshot | null>(
    users.map((doc: any) => [String(doc.shareId), initialSubscriptionSnapshot(doc.initialSubscription)])
  );

  for (const id of ids) {
    const doc = byShareId.get(subscriptionShareId(subjectType, id));
		result.set(
			id,
			doc && userSubscriptionLedgerEnvelopeIsTrusted(doc, id)
				? toInfo(subjectType, id, doc)
				: defaultSubscription(subjectType, id, seedByUserId.get(id) ?? undefined)
		);
  }
  return result;
};

export type SetSubscriptionInput = {
  subjectType: SubscriptionSubjectType;
  subjectId: string;
  // The affected user: the subject itself for users, the app's owner for apps.
  ownerId: string;
  tier: unknown;
  tierVersionId?: unknown;
  overrides?: unknown;
  note?: unknown;
  updatedBy: string;
  isDefaultAssignment?: boolean;
	// Internal account-creation/migration hook. Ordinary admin tier changes
	// never invent a zero ledger for an existing account.
	initialStorageUsedBytes?: number;
	// Internal composition hook: account creation inserts the user and its
	// authoritative subscription ledger in one Mongo transaction.
	session?: any;
};

export const setSubscription = async (input: SetSubscriptionInput): Promise<{ ok: true; subscription: SubscriptionInfo } | Fail> => {
  let selectedTier = await getLiveSubscriptionTier(input.tier, input.tierVersionId);
  let archivedExpectedVersionId: string | null = null;
  if (!selectedTier && input.tierVersionId) {
    const [exact, current] = await Promise.all([
      getSubscriptionTierVersion(input.tierVersionId),
      getSubscription(input.subjectType, input.subjectId)
    ]);
    // An administrator may update notes/overrides without forcing an existing
    // historical assignment onto a new plan. Archived revisions are accepted
    // only when they are already this subject's exact pinned revision.
    if (exact?.status === 'archived' && exact.id === input.tier && current.tierVersionId === exact.versionId) {
      selectedTier = exact;
      archivedExpectedVersionId = exact.versionId;
    }
  }
  if (!selectedTier) {
    return fail(400, `Unknown or non-live tier revision: ${String(input.tier)} — refresh the catalog at /api/v1/tiers`);
  }
  const snapshot = tierAssignmentSnapshot(selectedTier);
  const sanitized = sanitizeQuotaOverrides(input.overrides);
  if (sanitized.ok === false) return fail(400, sanitized.error);

  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 500) : null;
  const now = new Date();
  const things = await getThingsCollection();
	const mongoOptions = input.session ? { session: input.session } : {};

  if (input.subjectType === 'app') {
    const overrides = sanitized.overrides;
    const irrelevant = Object.keys(overrides || {}).filter((field) => field !== 'appStorageBytes');
    if (irrelevant.length) {
      return fail(400, `App subscriptions only accept the appStorageBytes override (received ${irrelevant.join(', ')})`);
    }
    const hasAllowanceOverride = hasOwn(overrides, 'appStorageBytes');
		const allowanceBytes = hasAllowanceOverride ? (overrides!.appStorageBytes ?? null) : snapshot.quotas.appStorageBytes;
    const filter: Record<string, unknown> = {
      ...appMatch(input.subjectId),
      ...(archivedExpectedVersionId
        ? {
            $or: [
              { 'crystal.subscriptionTierVersionId': archivedExpectedVersionId },
              {
                'crystal.subscriptionTierVersionId': { $exists: false },
                'crystal.subscriptionTier': snapshot.tierId
              }
            ]
          }
        : {}),
      ...(allowanceBytes === null
        ? {}
        : {
						'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION,
						'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready,
            $expr: {
							$and: [safeStoredByteExpression('$crystal.storageUsedBytes'), { $lte: ['$crystal.storageUsedBytes', allowanceBytes] }]
            }
          })
    };
    const set: Record<string, unknown> = {
      'crystal.subscriptionTier': snapshot.tierId,
      'crystal.subscriptionTierVersionId': snapshot.versionId,
      'crystal.subscriptionTierVersion': snapshot.version,
      'crystal.subscriptionTierName': snapshot.title,
      'crystal.subscriptionTierMetered': snapshot.metered,
      'crystal.subscriptionTierQuotas': snapshot.quotas,
      'crystal.storageAllowanceBytes': allowanceBytes,
      'crystal.subscriptionNote': note,
      'crystal.subscriptionUpdatedBy': input.updatedBy,
      'crystal.subscriptionUpdatedAt': now,
      updatedAt: now
    };
    const update: Record<string, unknown> = { $set: set };
    if (hasAllowanceOverride) set['crystal.storageAllowanceOverrideBytes'] = allowanceBytes;
    else update.$unset = { 'crystal.storageAllowanceOverrideBytes': '' };

		const updated = await things.findOneAndUpdate(filter as any, update as any, { ...mongoOptions, returnDocument: 'after' });
    if (!updated) {
      const existing = await things.findOne(appMatch(input.subjectId), {
				...mongoOptions,
        projection: {
          'crystal.storageUsedBytes': 1,
					'crystal.storageAccountingVersion': 1,
					'crystal.storageLedgerStatus': 1,
          'crystal.subscriptionTier': 1,
          'crystal.subscriptionTierVersionId': 1
        }
      });
      if (!existing) return fail(404, 'App not found');
      if (archivedExpectedVersionId) {
        const currentVersionId = existing.crystal?.subscriptionTierVersionId;
        const legacySameTier = !currentVersionId && existing.crystal?.subscriptionTier === snapshot.tierId;
        if (currentVersionId !== archivedExpectedVersionId && !legacySameTier) {
          return fail(409, 'The subscription changed while saving; refresh and try again');
        }
      }
			if (
				allowanceBytes !== null &&
				(existing.crystal?.storageAccountingVersion !== APP_STORAGE_ACCOUNTING_VERSION ||
					existing.crystal?.storageLedgerStatus !== USER_STORAGE_STATUS.ready ||
					!Number.isSafeInteger(existing.crystal?.storageUsedBytes) ||
					Number(existing.crystal.storageUsedBytes) < 0)
			) {
				return fail(503, 'App storage accounting is unavailable; reconcile it before changing to a finite tier');
			}
      return fail(409, `The app already uses ${Number(existing.crystal?.storageUsedBytes || 0)} bytes, above that plan's allowance`);
    }
    return { ok: true, subscription: toAppInfo(input.subjectId, updated) };
  }

  if (hasOwn(sanitized.overrides, 'appStorageBytes')) {
    return fail(400, 'appStorageBytes applies to app subscriptions, not user subscriptions');
  }

	const occupiedSubscriptionMatch = subscriptionMatch('user', input.subjectId);
	const baseSubscriptionMatch = userSubscriptionLedgerMatch(input.subjectId);
	const nextAllowanceBytes = resolveQuotas(snapshot.quotas, sanitized.overrides).userStorageBytes;
  const existingAssignment = archivedExpectedVersionId
    ? await things.findOne(baseSubscriptionMatch, {
				...mongoOptions,
        projection: { 'crystal.tierVersionId': 1, 'crystal.tier': 1 }
      })
    : null;
	const versionMatch = archivedExpectedVersionId
    ? {
        ...baseSubscriptionMatch,
        ...(existingAssignment
          ? {
              $or: [
                { 'crystal.tierVersionId': archivedExpectedVersionId },
                {
                  'crystal.tierVersionId': { $exists: false },
                  'crystal.tier': snapshot.tierId
                }
              ]
            }
          : { 'crystal.tierVersionId': { $exists: false } })
      }
    : baseSubscriptionMatch;
	// Existing ready ledgers can only move to a finite allowance at or above
	// their live counter. Uninitialized ledgers must reconcile before a finite
	// tier change, so a missing counter is never treated as zero. This is
	// deliberately a normal update filter, never an `$expr` upsert (Mongo
	// rejects `$expr` with upsert and would break first-time finite plans).
	const allowanceGuard =
		nextAllowanceBytes === null
			? null
			: {
					'crystal.storageAccountingVersion': USER_STORAGE_ACCOUNTING_VERSION,
					'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready,
					$expr: {
						$and: [safeStoredByteExpression('$crystal.storageUsedBytes'), { $lte: ['$crystal.storageUsedBytes', nextAllowanceBytes] }]
					}
				};
	const assignmentMatch = allowanceGuard ? { $and: [versionMatch, allowanceGuard] } : versionMatch;
	const initialStorageUsedBytes =
		Number.isSafeInteger(input.initialStorageUsedBytes) && Number(input.initialStorageUsedBytes) >= 0 ? Number(input.initialStorageUsedBytes) : null;
	const assignmentSet = {
      'crystal.tier': snapshot.tierId,
      'crystal.tierVersionId': snapshot.versionId,
      'crystal.tierVersion': snapshot.version,
      'crystal.tierName': snapshot.title,
      'crystal.tierMetered': snapshot.metered,
      'crystal.tierQuotas': snapshot.quotas,
      'crystal.overrides': sanitized.overrides,
      'crystal.note': note,
      'crystal.updatedBy': input.updatedBy,
      'crystal.isDefaultAssignment': input.isDefaultAssignment === true,
      updatedAt: now
	};
	const updateExisting = () => things.findOneAndUpdate(assignmentMatch as any, { $set: assignmentSet }, { ...mongoOptions, returnDocument: 'after' });

	const explainConflict = async () => {
		const current = await things.findOne(occupiedSubscriptionMatch, {
			...mongoOptions
		});
		if (!current) return fail(409, 'The subscription assignment id is unavailable; contact an administrator');
		if (!userSubscriptionLedgerEnvelopeIsTrusted(current, input.subjectId)) {
			return fail(503, 'The account subscription ledger has an invalid protected envelope; reconcile it before changing tier');
		}
		if (archivedExpectedVersionId && current.crystal?.tierVersionId !== archivedExpectedVersionId) {
			return fail(409, 'The subscription changed while saving; refresh and try again');
		}
		const usedBytes = current.crystal?.storageUsedBytes;
		if (
			nextAllowanceBytes !== null &&
			(current.crystal?.storageAccountingVersion !== USER_STORAGE_ACCOUNTING_VERSION ||
				current.crystal?.storageLedgerStatus !== USER_STORAGE_STATUS.ready ||
				!Number.isSafeInteger(usedBytes) ||
				Number(usedBytes) < 0)
		) {
			return fail(503, 'Account storage accounting is unavailable; reconcile it before changing to a finite tier');
		}
		if (nextAllowanceBytes !== null && Number.isSafeInteger(usedBytes) && Number(usedBytes) > nextAllowanceBytes) {
			return fail(409, `The account already uses ${Number(usedBytes)} bytes, above that plan's allowance`);
		}
		return fail(409, 'The subscription changed while saving; refresh and try again');
	};

	let updated = await updateExisting();
	if (updated) {
		return { ok: true, subscription: toInfo(input.subjectType, input.subjectId, updated) };
	}

	const current = await things.findOne(occupiedSubscriptionMatch, { ...mongoOptions, projection: { _id: 1 } });
	if (current) return explainConflict();
	if (initialStorageUsedBytes === null) {
		return fail(503, 'Account storage accounting must be initialized before creating this subscription assignment');
	}
	if (initialStorageUsedBytes !== null && nextAllowanceBytes !== null && initialStorageUsedBytes > nextAllowanceBytes) {
		return fail(409, `The account already uses ${initialStorageUsedBytes} bytes, above that plan's allowance`);
	}

	const insertDoc: any = {
		shareId: subscriptionShareId(input.subjectType, input.subjectId),
      schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
      thingtime: [SUBSCRIPTION_KIND],
		crystal: {
			quotaKind: SUBSCRIPTION_KIND,
			subjectType: input.subjectType,
			subjectId: input.subjectId,
			tier: snapshot.tierId,
			tierVersionId: snapshot.versionId,
			tierVersion: snapshot.version,
			tierName: snapshot.title,
			tierMetered: snapshot.metered,
			tierQuotas: snapshot.quotas,
			overrides: sanitized.overrides,
			note,
			updatedBy: input.updatedBy,
			isDefaultAssignment: input.isDefaultAssignment === true,
			...(initialStorageUsedBytes !== null
				? {
						storageUsedBytes: initialStorageUsedBytes,
						storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
						storageLedgerStatus: USER_STORAGE_STATUS.ready,
						storageReconciledAt: now,
						storageUpdatedAt: now
					}
				: {})
		},
		ownerId: input.subjectId,
      acl: [ACL_OWNER],
      targetId: null,
      tags: [],
		storageLedgerEnvelopeVersion: USER_STORAGE_LEDGER_ENVELOPE_VERSION,
		createdAt: now,
		updatedAt: now
  };
  try {
		await things.insertOne(insertDoc, mongoOptions);
  } catch (err: any) {
		if (err?.code !== 11000 || input.session) throw err;
		// A concurrent first assignment may win the deterministic-id insert.
		// Re-run the same guarded update; never fall back to an unguarded write.
		updated = await updateExisting();
		if (!updated) return explainConflict();
		return { ok: true, subscription: toInfo(input.subjectType, input.subjectId, updated) };
  }

	return { ok: true, subscription: toInfo(input.subjectType, input.subjectId, insertDoc) };
};

// Reset a subject to the current live default revision. User resets remain a
// concrete protected Thing so their exact default version is traceable later.
export const clearSubscription = async (
  subjectType: SubscriptionSubjectType,
  subjectId: string,
  updatedBy = 'system'
): Promise<{ ok: true } | Fail> => {
  if (subjectType === 'app') {
    const things = await getThingsCollection();
    const app = await things.findOne(appMatch(subjectId), { projection: { ownerId: 1 } });
    if (!app) return fail(404, 'App not found');
    const reset = await setSubscription({
      subjectType: 'app',
      subjectId,
      ownerId: String(app.ownerId),
      tier: DEFAULT_SUBSCRIPTION_TIER,
      overrides: null,
      updatedBy
    });
    return reset.ok ? { ok: true } : reset;
  }
  const reset = await setSubscription({
    subjectType: 'user',
    subjectId,
    ownerId: subjectId,
    tier: DEFAULT_SUBSCRIPTION_TIER,
    overrides: null,
    updatedBy,
    isDefaultAssignment: true
  });
  return reset.ok ? { ok: true } : reset;
};

// The app subject owns the aggregate namespace budget. Per-user limits are an
// app policy (default + relational user override), not the end user's personal
// Thingtime subscription.
export const resolveAppStorageBudget = async (appId: string, _endUserId?: string): Promise<number | null> => {
  const appSub = await getSubscription('app', appId);
  return appSub.effective.appStorageBytes;
};
