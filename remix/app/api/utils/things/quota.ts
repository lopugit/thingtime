import { createHash, randomUUID } from 'node:crypto';

import { ensureIndexes, getThingsCollection } from '../mongodb/collections';
import {
  assertServiceQuotaChildId,
  parseServiceQuotaCount,
  parseServiceQuotaId,
  parseServiceQuotaKey,
  parseServiceQuotaPolicy,
  ServiceQuotaError,
  serviceQuotaPoliciesEqual,
  serviceQuotaStatus,
  utcServiceQuotaDayKey
} from './quotaCore';
import type {
  ServiceQuotaPolicy,
  ServiceQuotaReservation,
  ServiceQuotaState,
  ServiceQuotaStatus
} from './quotaCore';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry';

const QUOTA_KIND = 'service-quota';
const QUOTA_VERSION = 1;

type QuotaThingDoc = {
  shareId: string;
  schemaVersion: number;
  thingtime: string[];
  crystal: {
    quotaKind: typeof QUOTA_KIND;
    quotaVersion: typeof QUOTA_VERSION;
    key: string;
    policy: ServiceQuotaPolicy;
    dayKey: string;
    dailyUsed: number;
    reservations: ServiceQuotaReservation[];
    permitIds: string[];
    releasedIds: string[];
    rollingPermits: Array<{ id: string; at: number }>;
    lastReleaseResult?: { requestId: string; releaseId: string; applied: boolean };
  };
  ownerId: string;
  acl: string[];
  targetId: null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
};

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

const quotaShareId = (ownerId: string, key: string): string =>
  `quota-${createHash('sha256').update(ownerId).update('\0').update(key).digest('hex').slice(0, 48)}`;

const quotaMatch = (ownerId: string, key: string) => ({
  shareId: quotaShareId(ownerId, key),
  ownerId,
  thingtime: 'data',
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

const initializeQuotaThing = async (
  ownerId: string,
  key: string,
  policy: ServiceQuotaPolicy,
  now: number
): Promise<void> => {
  await ensureIndexes();
  const things = await getThingsCollection();
  const at = new Date(now);
  const doc: QuotaThingDoc = {
    shareId: quotaShareId(ownerId, key),
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
    thingtime: ['data'],
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
    await things.updateOne(
      { shareId: doc.shareId, ownerId },
      { $setOnInsert: doc },
      { upsert: true }
    );
  } catch (error: any) {
    // Two cold service calls can race the deterministic upsert. The winner's
    // document is the only possible safe destination; the mutation below will
    // validate its pinned policy before changing quota state.
    if (error?.code !== 11000) throw error;
  }
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

const documentToState = (doc: any): ServiceQuotaState => {
  const crystal = doc?.crystal;
  if (
    !crystal ||
    crystal.quotaKind !== QUOTA_KIND ||
    crystal.quotaVersion !== QUOTA_VERSION ||
    typeof crystal.key !== 'string' ||
    !crystal.policy ||
    typeof crystal.dayKey !== 'string' ||
    !Number.isSafeInteger(crystal.dailyUsed) ||
    !Array.isArray(crystal.reservations) ||
    !Array.isArray(crystal.permitIds) ||
    !Array.isArray(crystal.releasedIds) ||
    !Array.isArray(crystal.rollingPermits)
  ) {
    throw unavailable();
  }
  return {
    key: crystal.key,
    policy: {
      dailyLimit: Number(crystal.policy.dailyLimit),
      rollingLimit: Number(crystal.policy.rollingLimit),
      rollingWindowMs: Number(crystal.policy.rollingWindowMs)
    },
    dayKey: crystal.dayKey,
    dailyUsed: crystal.dailyUsed,
    reservations: crystal.reservations.map((entry: any) => ({
      id: String(entry.id),
      count: Number(entry.count),
      releasedCount: Number(entry.releasedCount || 0)
    })),
    permitIds: crystal.permitIds.map(String),
    releasedIds: crystal.releasedIds.map(String),
    rollingPermits: crystal.rollingPermits.map((entry: any) => ({ id: String(entry.id), at: Number(entry.at) }))
  };
};

const quotaNotFound = (): never => {
  throw new ServiceQuotaError('Quota not found', 404, 'QUOTA_NOT_FOUND');
};

export const getServiceQuotaStatus = async (
  ownerId: string,
  rawKey: unknown,
  now = Date.now()
): Promise<ServiceQuotaStatus> =>
  withStoreErrors(async () => {
    const key = parseServiceQuotaKey(rawKey);
    await ensureIndexes();
    const things = await getThingsCollection();
    const doc = await things.findOneAndUpdate(quotaMatch(ownerId, key), normalizePipeline(now), {
      returnDocument: 'after'
    });
    if (!doc) return quotaNotFound();
    return serviceQuotaStatus(documentToState(doc));
  });

const reserveQuota = async (
  ownerId: string,
  input: Extract<ServiceQuotaMutationInput, { operation: 'reserve' }>,
  now: number
): Promise<ServiceQuotaMutationResult> => {
  const key = parseServiceQuotaKey(input.key);
  const policy = parseServiceQuotaPolicy(input.policy);
  const count = parseServiceQuotaCount(input.count, policy);
  const reservationId = parseServiceQuotaId('reservationId', input.reservationId);

  await initializeQuotaThing(ownerId, key, policy, now);
  const things = await getThingsCollection();
  const reservationIds = reservationIdsExpression();
  const shouldCreate = {
    $and: [
      pinnedPolicyExpression(policy),
      { $not: [{ $in: [reservationId, reservationIds] }] },
      {
        $lte: [
          { $ifNull: ['$crystal.dailyUsed', 0] },
          { $subtract: ['$crystal.policy.dailyLimit', count] }
        ]
      }
    ]
  };
  const doc = await things.findOneAndUpdate(
    quotaMatch(ownerId, key),
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
                $concatArrays: [
                  '$crystal.reservations',
                  [{ id: reservationId, count, releasedCount: 0 }]
                ]
              },
              '$crystal.reservations'
            ]
          }
        }
      }
    ],
    { returnDocument: 'after' }
  );
  if (!doc) return quotaNotFound();

  const state = documentToState(doc);
  if (!serviceQuotaPoliciesEqual(state.policy, policy)) {
    throw new ServiceQuotaError('Quota policy is already pinned to different limits', 409, 'QUOTA_POLICY_CONFLICT');
  }
  const reservation = state.reservations.find((entry) => entry.id === reservationId);
  if (reservation && reservation.count !== count) {
    throw new ServiceQuotaError(
      'reservationId was reused with a different count',
      409,
      'QUOTA_RESERVATION_CONFLICT'
    );
  }
  if (!reservation) {
    throw new ServiceQuotaError('Daily quota limit reached', 429, 'QUOTA_DAILY_LIMIT');
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
  now: number
): Promise<ServiceQuotaMutationResult> => {
  const key = parseServiceQuotaKey(input.key);
  const reservationId = parseServiceQuotaId('reservationId', input.reservationId);
  const permitId = assertServiceQuotaChildId('permitId', reservationId, input.permitId);
  await ensureIndexes();
  const things = await getThingsCollection();
  const permitIds = { $ifNull: ['$crystal.permitIds', []] };
  const releasedIds = { $ifNull: ['$crystal.releasedIds', []] };
  const rollingPermits = { $ifNull: ['$crystal.rollingPermits', []] };
  const shouldGrant = {
    $and: [
      { $in: [reservationId, reservationIdsExpression()] },
      { $not: [{ $in: [permitId, releasedIds] }] },
      { $not: [{ $in: [permitId, permitIds] }] },
      { $lt: [{ $size: rollingPermits }, '$crystal.policy.rollingLimit'] }
    ]
  };
  const doc = await things.findOneAndUpdate(
    quotaMatch(ownerId, key),
    [
      ...normalizePipeline(now),
      {
        $set: {
          'crystal.permitIds': {
            $cond: [shouldGrant, { $concatArrays: [permitIds, [permitId]] }, permitIds]
          },
          'crystal.rollingPermits': {
            $cond: [
              shouldGrant,
              { $concatArrays: [rollingPermits, [{ id: permitId, at: now }]] },
              rollingPermits
            ]
          }
        }
      }
    ],
    { returnDocument: 'after' }
  );
  if (!doc) return quotaNotFound();

  const state = documentToState(doc);
  if (!state.reservations.some((entry) => entry.id === reservationId)) {
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

  const oldest = state.rollingPermits.length
    ? Math.min(...state.rollingPermits.map((permit) => permit.at))
    : now;
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
  now: number
): Promise<ServiceQuotaMutationResult> => {
  const key = parseServiceQuotaKey(input.key);
  const reservationId = parseServiceQuotaId('reservationId', input.reservationId);
  const releaseId = assertServiceQuotaChildId('releaseId', reservationId, input.releaseId);
  await ensureIndexes();
  const things = await getThingsCollection();
  const reservation = reservationExpression(reservationId);
  const permitIds = { $ifNull: ['$crystal.permitIds', []] };
  const releasedIds = { $ifNull: ['$crystal.releasedIds', []] };
  const shouldRelease = {
    $and: [
      { $in: [reservationId, reservationIdsExpression()] },
      { $not: [{ $in: [releaseId, permitIds] }] },
      { $not: [{ $in: [releaseId, releasedIds] }] },
      { $gt: ['$crystal.dailyUsed', 0] },
      {
        $gt: [
          { $ifNull: [`${'$'}${'$'}reservation.count`, 0] },
          { $ifNull: [`${'$'}${'$'}reservation.releasedCount`, 0] }
        ]
      }
    ]
  };
  const requestId = randomUUID();
  const doc = await things.findOneAndUpdate(
    quotaMatch(ownerId, key),
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
                            $mergeObjects: [
                              '$$entry',
                              { releasedCount: { $add: [{ $ifNull: ['$$entry.releasedCount', 0] }, 1] } }
                            ]
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
  if (!doc) return quotaNotFound();

  const state = documentToState(doc);
  const storedReservation = state.reservations.find((entry) => entry.id === reservationId);
  if (!storedReservation) {
    throw new ServiceQuotaError('Quota reservation is no longer active', 429, 'QUOTA_RESERVATION_EXPIRED');
  }
  if (state.permitIds.includes(releaseId)) {
    throw new ServiceQuotaError('A permitted quota slot cannot be released', 409, 'QUOTA_RELEASE_CONFLICT');
  }
  if (storedReservation.count === 0) {
    return {
      operation: 'release',
      status: serviceQuotaStatus(state),
      release: { releaseId, released: true, applied: false }
    };
  }
  if (!state.releasedIds.includes(releaseId)) {
    throw new ServiceQuotaError('Reservation has no unreleased quota slots', 409, 'QUOTA_RELEASE_CONFLICT');
  }

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
};

const resetQuota = async (
  ownerId: string,
  input: Extract<ServiceQuotaMutationInput, { operation: 'reset' }>,
  now: number
): Promise<ServiceQuotaMutationResult> => {
  const key = parseServiceQuotaKey(input.key);
  await ensureIndexes();
  const things = await getThingsCollection();
  const doc = await things.findOneAndUpdate(
    quotaMatch(ownerId, key),
    [
      ...normalizePipeline(now),
      {
        $set: {
          'crystal.dailyUsed': 0,
          'crystal.reservations': {
            $map: {
              input: '$crystal.reservations',
              as: 'reservation',
              in: { id: '$$reservation.id', count: 0, releasedCount: 0 }
            }
          }
        }
      }
    ],
    { returnDocument: 'after' }
  );
  if (!doc) return quotaNotFound();
  return { operation: 'reset', status: serviceQuotaStatus(documentToState(doc)) };
};

export const mutateServiceQuota = async (
  ownerId: string,
  input: ServiceQuotaMutationInput,
  now = Date.now()
): Promise<ServiceQuotaMutationResult> =>
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
