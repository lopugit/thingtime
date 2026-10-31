import { randomUUID } from 'node:crypto';

import { getThingsCollection } from '../mongodb/collections';
import {
	SERVICE_QUOTA_MAX_CHILD_HISTORY,
	SERVICE_QUOTA_MAX_RESERVATION_HISTORY,
  assertServiceQuotaChildId,
  parseServiceQuotaCount,
  parseServiceQuotaId,
  parseServiceQuotaKey,
  parseServiceQuotaPolicy,
	serviceQuotaChildHistoryFull,
	serviceQuotaClaimedChildCount,
  ServiceQuotaError,
  serviceQuotaPoliciesEqual,
	serviceQuotaReservationIdsConflict,
  serviceQuotaStatus,
  utcServiceQuotaDayKey
} from './quotaCore';
import type { ServiceQuotaPolicy, ServiceQuotaState, ServiceQuotaStatus } from './quotaCore';
import { SERVICE_QUOTA_THINGTIME, SERVICE_QUOTA_VERSION, quotaShareId, requireCanonicalServiceQuotaDocumentState } from './quotaLegacyCore';
import type { QuotaThingDoc } from './quotaLegacyCore';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry';

const QUOTA_KIND = SERVICE_QUOTA_THINGTIME;
const QUOTA_VERSION = SERVICE_QUOTA_VERSION;

export { SERVICE_QUOTA_THINGTIME, buildConservativeLegacyServiceQuotaThing, classifyLegacyServiceQuotaThing, quotaShareId } from './quotaLegacyCore';
export type { LegacyServiceQuotaClassification, QuotaThingDoc } from './quotaLegacyCore';

export type ServiceQuotaMutationInput =
  | {
      key: unknown;
      operation: 'reserve';
      reservationId: unknown;
      count: unknown;
      policy: unknown;
    }
  | {
      key: unknown;
      operation: 'permit';
      reservationId: unknown;
      permitId: unknown;
    }
  | {
      key: unknown;
      operation: 'release';
      reservationId: unknown;
      releaseId: unknown;
    }
  | { key: unknown; operation: 'reset' };

export type ServiceQuotaMutationResult =
  | {
      operation: 'reserve';
      status: ServiceQuotaStatus;
      reservation: { dayKey: string; reservationId: string };
    }
  | {
      operation: 'permit';
      status: ServiceQuotaStatus;
      permit: { permitId: string; granted: true } | { permitId: string; granted: false; retryAt: number };
    }
  | {
      operation: 'release';
      status: ServiceQuotaStatus;
      release: { releaseId: string; released: true; applied: boolean };
    }
  | { operation: 'reset'; status: ServiceQuotaStatus };

const quotaMatch = (ownerId: string, key: string) => ({
  shareId: quotaShareId(ownerId, key),
  ownerId,
	// Legacy `data` quota rows are promoted only by the storage migration, where
	// their complete state and any account-byte effect can be reconciled. A hot
	// request must never reclassify a billed content row outside that ledger
	// transaction.
	thingtime: SERVICE_QUOTA_THINGTIME,
  'crystal.quotaKind': QUOTA_KIND,
  'crystal.quotaVersion': QUOTA_VERSION
});

const unavailable = (cause?: unknown): ServiceQuotaError => {
  const error = new ServiceQuotaError('Quota store is unavailable', 503, 'QUOTA_UNAVAILABLE');
  if (cause !== undefined) (error as ServiceQuotaError & { cause?: unknown }).cause = cause;
  return error;
};

const withStoreErrors = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ServiceQuotaError) throw error;
    throw unavailable(error);
  }
};

const initializeQuotaThing = async (ownerId: string, key: string, policy: ServiceQuotaPolicy, now: number): Promise<void> => {
  const things = await getThingsCollection();
  const at = new Date(now);
  const doc: QuotaThingDoc = {
    shareId: quotaShareId(ownerId, key),
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
		thingtime: [SERVICE_QUOTA_THINGTIME],
		storageClass: 'control',
    crystal: {
      quotaKind: QUOTA_KIND,
      quotaVersion: QUOTA_VERSION,
      key,
      policy,
      dayKey: utcServiceQuotaDayKey(now),
      dailyUsed: 0,
      reservations: [],
      permitIds: [],
      releasedIds: [],
      rollingPermits: []
    },
    ownerId,
    acl: [ACL_OWNER],
    targetId: null,
    tags: [QUOTA_KIND],
    createdAt: at,
    updatedAt: at
  };

  try {
		const result = await things.updateOne({ shareId: doc.shareId, ownerId }, { $setOnInsert: doc }, { upsert: true });
		if (result.upsertedCount === 1) return;
  } catch (error: any) {
    // Two cold service calls can race the deterministic upsert. The winner's
    // document is the only possible safe destination; the mutation below will
    // validate its pinned policy before changing quota state.
    if (error?.code !== 11000) throw error;
  }

	// updateOne can match a same-owner legacy `data` row without throwing a
	// duplicate-key error. Always verify the existing destination instead of
	// allowing the next operation to misreport that collision as a 404.
	const existing = await things.findOne({ shareId: doc.shareId, ownerId });
	requireCanonicalServiceQuotaDocumentState(existing, ownerId, key);
};

const storedDayIsCurrentOrNewer = (dayKey: string) => ({
  $gte: [{ $ifNull: ['$crystal.dayKey', ''] }, dayKey]
});

const normalizePipeline = (now: number): Record<string, unknown>[] => {
  const dayKey = utcServiceQuotaDayKey(now);
  const at = new Date(now);
  const currentOrNewer = storedDayIsCurrentOrNewer(dayKey);
  return [
    {
      $set: {
				schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
				thingtime: [SERVICE_QUOTA_THINGTIME],
				storageClass: 'control',
				sizeBytes: '$$REMOVE',
				storageAccountingVersion: '$$REMOVE',
				acl: [ACL_OWNER],
				targetId: null,
				tags: [QUOTA_KIND],
        'crystal.dayKey': {
          $cond: [currentOrNewer, { $ifNull: ['$crystal.dayKey', dayKey] }, dayKey]
        },
        'crystal.dailyUsed': {
          $cond: [currentOrNewer, { $ifNull: ['$crystal.dailyUsed', 0] }, 0]
        },
        'crystal.reservations': {
          $cond: [currentOrNewer, { $ifNull: ['$crystal.reservations', []] }, []]
        },
        'crystal.permitIds': {
          $cond: [currentOrNewer, { $ifNull: ['$crystal.permitIds', []] }, []]
        },
        'crystal.releasedIds': {
          $cond: [currentOrNewer, { $ifNull: ['$crystal.releasedIds', []] }, []]
        },
        'crystal.rollingPermits': {
          $filter: {
            input: { $ifNull: ['$crystal.rollingPermits', []] },
            as: 'permit',
            cond: {
              $gt: [
                '$$permit.at',
                {
                  $subtract: [now, { $ifNull: ['$crystal.policy.rollingWindowMs', 0] }]
                }
              ]
            }
          }
        },
        updatedAt: at
      }
    }
  ];
};

const reservationIdsExpression = () => ({
  $map: {
    input: { $ifNull: ['$crystal.reservations', []] },
    as: 'reservation',
    in: '$$reservation.id'
  }
});

const childHistorySizeExpression = () => ({
	$add: [{ $size: { $ifNull: ['$crystal.permitIds', []] } }, { $size: { $ifNull: ['$crystal.releasedIds', []] } }]
});

const claimedChildCountExpression = (reservationId: string) => ({
	$size: {
		$filter: {
			input: {
				$concatArrays: [{ $ifNull: ['$crystal.permitIds', []] }, { $ifNull: ['$crystal.releasedIds', []] }]
			},
			as: 'childId',
			cond: { $eq: [{ $indexOfBytes: ['$$childId', `${reservationId}:`] }, 0] }
		}
	}
});

const rollingPermitIdsExpression = () => ({
	$map: {
		input: { $ifNull: ['$crystal.rollingPermits', []] },
		as: 'permit',
		in: '$$permit.id'
	}
});

const reservationNamespaceConflictExpression = (reservationId: string) => ({
	$anyElementTrue: [
		{
			$map: {
				input: { $ifNull: ['$crystal.reservations', []] },
				as: 'reservation',
				in: {
					$or: [
						{ $eq: ['$$reservation.id', reservationId] },
						{ $eq: [{ $indexOfBytes: [reservationId, { $concat: ['$$reservation.id', ':'] }] }, 0] },
						{ $eq: [{ $indexOfBytes: ['$$reservation.id', `${reservationId}:`] }, 0] }
					]
				}
			}
		}
	]
});

const pinnedPolicyExpression = (policy: ServiceQuotaPolicy) => ({
  $and: [
    { $eq: ['$crystal.policy.dailyLimit', policy.dailyLimit] },
    { $eq: ['$crystal.policy.rollingLimit', policy.rollingLimit] },
    { $eq: ['$crystal.policy.rollingWindowMs', policy.rollingWindowMs] }
  ]
});

const reservationExpression = (reservationId: string) => ({
  $arrayElemAt: [
    {
      $filter: {
        input: { $ifNull: ['$crystal.reservations', []] },
        as: 'reservation',
        cond: { $eq: ['$$reservation.id', reservationId] }
      }
    },
    0
  ]
});

const quotaHistoryLimit = (): never => {
  throw new ServiceQuotaError(
    'Daily quota idempotency history is full; reset the quota or wait for UTC rollover',
    429,
    'QUOTA_HISTORY_LIMIT'
  );
};

const documentToState = (doc: any, ownerId: string, key: string): ServiceQuotaState =>
  requireCanonicalServiceQuotaDocumentState(doc, ownerId, key);

const quotaNotFound = (): never => {
  throw new ServiceQuotaError('Quota not found', 404, 'QUOTA_NOT_FOUND');
};

const validatedQuotaPreimage = async (ownerId: string, key: string) => {
  const things = await getThingsCollection();
  const doc = await things.findOne(quotaMatch(ownerId, key));
  if (!doc) return quotaNotFound();
  const state = requireCanonicalServiceQuotaDocumentState(doc, ownerId, key);
  return { things, doc, state };
};

const quotaPreimageMatch = (ownerId: string, key: string, doc: any) => ({
  ...quotaMatch(ownerId, key),
  _id: doc._id,
  schemaVersion: doc.schemaVersion,
  thingtime: doc.thingtime,
  storageClass: doc.storageClass,
  acl: doc.acl,
  targetId: doc.targetId,
  tags: doc.tags,
  createdAt: doc.createdAt,
  // The complete canonical envelope is the optimistic concurrency token.
  // Every quota mutation changes crystal/updatedAt; a concurrent valid
  // operation therefore causes a harmless retry, while an identity or root
  // mutation cannot be silently normalized into a trusted control record.
  crystal: doc.crystal,
  ...(Object.prototype.hasOwnProperty.call(doc, 'updatedAt')
    ? { updatedAt: doc.updatedAt }
    : { updatedAt: { $exists: false } })
});

const MAX_QUOTA_CAS_ATTEMPTS = 5;

const retryQuotaContention = async <T>(
  attempt: number,
  retry: (nextAttempt: number) => Promise<T>
): Promise<T> => {
  if (attempt + 1 >= MAX_QUOTA_CAS_ATTEMPTS) throw unavailable();
  return retry(attempt + 1);
};

const readServiceQuotaStatus = async (
  ownerId: string,
  key: string,
  now: number,
  attempt: number
): Promise<ServiceQuotaStatus> => {
  const preimage = await validatedQuotaPreimage(ownerId, key);
  const doc = await preimage.things.findOneAndUpdate(
    quotaPreimageMatch(ownerId, key, preimage.doc),
    normalizePipeline(now),
    { returnDocument: 'after' }
  );
  if (!doc)
    return retryQuotaContention(attempt, (nextAttempt) =>
      readServiceQuotaStatus(ownerId, key, now, nextAttempt)
    );
  return serviceQuotaStatus(documentToState(doc, ownerId, key));
};

export const getServiceQuotaStatus = async (
  ownerId: string,
  rawKey: unknown,
  now = Date.now()
): Promise<ServiceQuotaStatus> =>
  withStoreErrors(async () =>
    readServiceQuotaStatus(ownerId, parseServiceQuotaKey(rawKey), now, 0)
  );

const reserveQuota = async (
  ownerId: string,
  input: Extract<ServiceQuotaMutationInput, { operation: 'reserve' }>,
  now: number,
  attempt = 0
): Promise<ServiceQuotaMutationResult> => {
  const key = parseServiceQuotaKey(input.key);
  const policy = parseServiceQuotaPolicy(input.policy);
  const count = parseServiceQuotaCount(input.count, policy);
  const reservationId = parseServiceQuotaId('reservationId', input.reservationId);

  await initializeQuotaThing(ownerId, key, policy, now);
	const preimage = await validatedQuotaPreimage(ownerId, key);
  const reservationIds = reservationIdsExpression();
  const shouldCreate = {
    $and: [
      pinnedPolicyExpression(policy),
      { $not: [{ $in: [reservationId, reservationIds] }] },
			{ $not: [reservationNamespaceConflictExpression(reservationId)] },
      {
				$lt: [{ $size: { $ifNull: ['$crystal.reservations', []] } }, SERVICE_QUOTA_MAX_RESERVATION_HISTORY]
			},
			{
				$lte: [{ $ifNull: ['$crystal.dailyUsed', 0] }, { $subtract: ['$crystal.policy.dailyLimit', count] }]
      }
    ]
  };
	const doc = await preimage.things.findOneAndUpdate(
		quotaPreimageMatch(ownerId, key, preimage.doc),
    [
      ...normalizePipeline(now),
      {
        $set: {
          'crystal.dailyUsed': {
            $cond: [shouldCreate, { $add: ['$crystal.dailyUsed', count] }, '$crystal.dailyUsed']
          },
          'crystal.reservations': {
            $cond: [
              shouldCreate,
              {
								$concatArrays: ['$crystal.reservations', [{ id: reservationId, count, releasedCount: 0 }]]
              },
              '$crystal.reservations'
            ]
          }
        }
      }
    ],
    { returnDocument: 'after' }
  );
	if (!doc) return retryQuotaContention(attempt, (nextAttempt) => reserveQuota(ownerId, input, now, nextAttempt));

	const state = documentToState(doc, ownerId, key);
  if (!serviceQuotaPoliciesEqual(state.policy, policy)) {
    throw new ServiceQuotaError('Quota policy is already pinned to different limits', 409, 'QUOTA_POLICY_CONFLICT');
  }
  const reservation = state.reservations.find((entry) => entry.id === reservationId);
  if (reservation && reservation.count !== count) {
		throw new ServiceQuotaError('reservationId was reused with a different count', 409, 'QUOTA_RESERVATION_CONFLICT');
  }
  if (!reservation) {
		if (state.reservations.some((entry) => serviceQuotaReservationIdsConflict(entry.id, reservationId))) {
			throw new ServiceQuotaError('reservationId overlaps an existing reservation namespace', 409, 'QUOTA_RESERVATION_CONFLICT');
		}
		if (state.dailyUsed + count > state.policy.dailyLimit) {
    throw new ServiceQuotaError('Daily quota limit reached', 429, 'QUOTA_DAILY_LIMIT');
  }
		if (state.reservations.length >= SERVICE_QUOTA_MAX_RESERVATION_HISTORY) quotaHistoryLimit();
		throw unavailable();
	}

  return {
    operation: 'reserve',
    status: serviceQuotaStatus(state),
    reservation: { dayKey: state.dayKey, reservationId }
  };
};

const permitQuota = async (
  ownerId: string,
  input: Extract<ServiceQuotaMutationInput, { operation: 'permit' }>,
	now: number,
	attempt = 0
): Promise<ServiceQuotaMutationResult> => {
  const key = parseServiceQuotaKey(input.key);
  const reservationId = parseServiceQuotaId('reservationId', input.reservationId);
  const permitId = assertServiceQuotaChildId('permitId', reservationId, input.permitId);
	const preimage = await validatedQuotaPreimage(ownerId, key);
  const permitIds = { $ifNull: ['$crystal.permitIds', []] };
  const releasedIds = { $ifNull: ['$crystal.releasedIds', []] };
  const rollingPermits = { $ifNull: ['$crystal.rollingPermits', []] };
	const activeRollingIds = rollingPermitIdsExpression();
	const claimedChildren = claimedChildCountExpression(reservationId);
	const reservation = reservationExpression(reservationId);
  const shouldGrant = {
		$let: {
			vars: { reservation },
			in: {
    $and: [
      { $in: [reservationId, reservationIdsExpression()] },
      { $not: [{ $in: [permitId, releasedIds] }] },
      { $not: [{ $in: [permitId, permitIds] }] },
					{ $not: [{ $in: [permitId, activeRollingIds] }] },
					{ $lt: [claimedChildren, { $ifNull: ['$$reservation.count', 0] }] },
					{ $lt: [childHistorySizeExpression(), SERVICE_QUOTA_MAX_CHILD_HISTORY] },
      { $lt: [{ $size: rollingPermits }, '$crystal.policy.rollingLimit'] }
    ]
			}
		}
  };
	const doc = await preimage.things.findOneAndUpdate(
		quotaPreimageMatch(ownerId, key, preimage.doc),
    [
      ...normalizePipeline(now),
      {
        $set: {
          'crystal.permitIds': {
            $cond: [shouldGrant, { $concatArrays: [permitIds, [permitId]] }, permitIds]
          },
          'crystal.rollingPermits': {
						$cond: [shouldGrant, { $concatArrays: [rollingPermits, [{ id: permitId, at: now }]] }, rollingPermits]
          }
        }
      }
    ],
    { returnDocument: 'after' }
  );
	if (!doc) return retryQuotaContention(attempt, (nextAttempt) => permitQuota(ownerId, input, now, nextAttempt));

	const state = documentToState(doc, ownerId, key);
	if (state.rollingPermits.some((entry) => entry.id === permitId)) {
		return {
			operation: 'permit',
			status: serviceQuotaStatus(state),
			permit: { permitId, granted: true }
		};
	}
	const storedReservation = state.reservations.find((entry) => entry.id === reservationId);
	if (!storedReservation) {
    throw new ServiceQuotaError('Quota reservation is no longer active', 429, 'QUOTA_RESERVATION_EXPIRED');
  }
  if (state.releasedIds.includes(permitId)) {
    throw new ServiceQuotaError('A released quota slot cannot acquire a permit', 409, 'QUOTA_PERMIT_CONFLICT');
  }
  if (state.permitIds.includes(permitId)) {
    return {
      operation: 'permit',
      status: serviceQuotaStatus(state),
      permit: { permitId, granted: true }
    };
  }
	if (serviceQuotaClaimedChildCount(state, reservationId) >= storedReservation.count) {
		throw new ServiceQuotaError('Reservation has no unclaimed quota slots', 409, 'QUOTA_PERMIT_CONFLICT');
	}
	if (serviceQuotaChildHistoryFull(state)) quotaHistoryLimit();

	const oldest = state.rollingPermits.length ? Math.min(...state.rollingPermits.map((permit) => permit.at)) : now;
  return {
    operation: 'permit',
    status: serviceQuotaStatus(state),
    permit: {
      permitId,
      granted: false,
      retryAt: Math.max(now + 10, oldest + state.policy.rollingWindowMs + 10)
    }
  };
};

const releaseQuota = async (
  ownerId: string,
  input: Extract<ServiceQuotaMutationInput, { operation: 'release' }>,
	now: number,
	attempt = 0
): Promise<ServiceQuotaMutationResult> => {
  const key = parseServiceQuotaKey(input.key);
  const reservationId = parseServiceQuotaId('reservationId', input.reservationId);
  const releaseId = assertServiceQuotaChildId('releaseId', reservationId, input.releaseId);
	const preimage = await validatedQuotaPreimage(ownerId, key);
  const reservation = reservationExpression(reservationId);
  const permitIds = { $ifNull: ['$crystal.permitIds', []] };
  const releasedIds = { $ifNull: ['$crystal.releasedIds', []] };
	const activeRollingIds = rollingPermitIdsExpression();
	const claimedChildren = claimedChildCountExpression(reservationId);
  const shouldRelease = {
    $and: [
      { $in: [reservationId, reservationIdsExpression()] },
      { $not: [{ $in: [releaseId, permitIds] }] },
      { $not: [{ $in: [releaseId, releasedIds] }] },
			{ $not: [{ $in: [releaseId, activeRollingIds] }] },
			{ $lt: [childHistorySizeExpression(), SERVICE_QUOTA_MAX_CHILD_HISTORY] },
      { $gt: ['$crystal.dailyUsed', 0] },
      {
				$gt: [{ $ifNull: [`${'$'}${'$'}reservation.count`, 0] }, { $ifNull: [`${'$'}${'$'}reservation.releasedCount`, 0] }]
			},
			{ $lt: [claimedChildren, { $ifNull: [`${'$'}${'$'}reservation.count`, 0] }] }
    ]
  };
  const requestId = randomUUID();
	const doc = await preimage.things.findOneAndUpdate(
		quotaPreimageMatch(ownerId, key, preimage.doc),
    [
      ...normalizePipeline(now),
      {
        $set: {
          'crystal.dailyUsed': {
            $let: {
              vars: { reservation },
              in: { $cond: [shouldRelease, { $subtract: ['$crystal.dailyUsed', 1] }, '$crystal.dailyUsed'] }
            }
          },
          'crystal.releasedIds': {
            $let: {
              vars: { reservation },
              in: { $cond: [shouldRelease, { $concatArrays: [releasedIds, [releaseId]] }, releasedIds] }
            }
          },
          'crystal.reservations': {
            $let: {
              vars: { reservation },
              in: {
                $cond: [
                  shouldRelease,
                  {
                    $map: {
                      input: '$crystal.reservations',
                      as: 'entry',
                      in: {
                        $cond: [
                          { $eq: ['$$entry.id', reservationId] },
                          {
														$mergeObjects: ['$$entry', { releasedCount: { $add: [{ $ifNull: ['$$entry.releasedCount', 0] }, 1] } }]
                          },
                          '$$entry'
                        ]
                      }
                    }
                  },
                  '$crystal.reservations'
                ]
              }
            }
          },
          'crystal.lastReleaseResult': {
            $let: {
              vars: { reservation },
              in: { requestId, releaseId, applied: shouldRelease }
            }
          }
        }
      }
    ],
    { returnDocument: 'after' }
  );
	if (!doc) return retryQuotaContention(attempt, (nextAttempt) => releaseQuota(ownerId, input, now, nextAttempt));

	const state = documentToState(doc, ownerId, key);
  const storedReservation = state.reservations.find((entry) => entry.id === reservationId);
  if (!storedReservation) {
    throw new ServiceQuotaError('Quota reservation is no longer active', 429, 'QUOTA_RESERVATION_EXPIRED');
  }
  if (state.permitIds.includes(releaseId)) {
    throw new ServiceQuotaError('A permitted quota slot cannot be released', 409, 'QUOTA_RELEASE_CONFLICT');
  }
	if (state.rollingPermits.some((permit) => permit.id === releaseId)) {
		throw new ServiceQuotaError('An actively permitted quota slot cannot be released', 409, 'QUOTA_RELEASE_CONFLICT');
  }
	if (state.releasedIds.includes(releaseId)) {
  return {
    operation: 'release',
    status: serviceQuotaStatus(state),
    release: {
      releaseId,
      released: true,
      applied:
        doc.crystal?.lastReleaseResult?.requestId === requestId &&
        doc.crystal.lastReleaseResult.releaseId === releaseId &&
        doc.crystal.lastReleaseResult.applied === true
    }
  };
	}
	if (serviceQuotaClaimedChildCount(state, reservationId) >= storedReservation.count) {
		throw new ServiceQuotaError('Reservation has no unreleased quota slots', 409, 'QUOTA_RELEASE_CONFLICT');
	}
	if (serviceQuotaChildHistoryFull(state)) quotaHistoryLimit();
	throw new ServiceQuotaError('Reservation has no unreleased quota slots', 409, 'QUOTA_RELEASE_CONFLICT');
};

const resetQuota = async (
  ownerId: string,
  input: Extract<ServiceQuotaMutationInput, { operation: 'reset' }>,
	now: number,
	attempt = 0
): Promise<ServiceQuotaMutationResult> => {
  const key = parseServiceQuotaKey(input.key);
	const preimage = await validatedQuotaPreimage(ownerId, key);
	const doc = await preimage.things.findOneAndUpdate(
		quotaPreimageMatch(ownerId, key, preimage.doc),
    [
      ...normalizePipeline(now),
      {
        $set: {
          'crystal.dailyUsed': 0,
					'crystal.reservations': [],
					'crystal.permitIds': [],
					'crystal.releasedIds': [],
					'crystal.lastReleaseResult': '$$REMOVE'
        }
      }
    ],
    { returnDocument: 'after' }
  );
	if (!doc) return retryQuotaContention(attempt, (nextAttempt) => resetQuota(ownerId, input, now, nextAttempt));
	return { operation: 'reset', status: serviceQuotaStatus(documentToState(doc, ownerId, key)) };
};

export const mutateServiceQuota = async (ownerId: string, input: ServiceQuotaMutationInput, now = Date.now()): Promise<ServiceQuotaMutationResult> =>
  withStoreErrors(async () => {
    if (!input || typeof input !== 'object') {
      throw new ServiceQuotaError('JSON body is required', 400, 'INVALID_REQUEST');
    }
    if (input.operation === 'reserve') return reserveQuota(ownerId, input, now);
    if (input.operation === 'permit') return permitQuota(ownerId, input, now);
    if (input.operation === 'release') return releaseQuota(ownerId, input, now);
    if (input.operation === 'reset') return resetQuota(ownerId, input, now);
    throw new ServiceQuotaError('operation must be reserve, permit, release, or reset', 400, 'INVALID_REQUEST');
  });
