export const SERVICE_QUOTA_KEY_MAX_CHARS = 128;
export const SERVICE_QUOTA_ID_MAX_CHARS = 160;
export const SERVICE_QUOTA_MAX_DAILY_LIMIT = 10_000;
export const SERVICE_QUOTA_MAX_ROLLING_LIMIT = 1_000;
export const SERVICE_QUOTA_MIN_WINDOW_MS = 100;
export const SERVICE_QUOTA_MAX_WINDOW_MS = 24 * 60 * 60 * 1_000;

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_,:-]*$/;

export type ServiceQuotaPolicy = {
  dailyLimit: number;
  rollingLimit: number;
  rollingWindowMs: number;
};

export type ServiceQuotaReservation = {
  id: string;
  count: number;
  releasedCount: number;
};

export type ServiceQuotaPermit = {
  id: string;
  at: number;
};

export type ServiceQuotaState = {
  key: string;
  policy: ServiceQuotaPolicy;
  dayKey: string;
  dailyUsed: number;
  reservations: ServiceQuotaReservation[];
  permitIds: string[];
  releasedIds: string[];
  rollingPermits: ServiceQuotaPermit[];
};

export type ServiceQuotaStatus = {
  key: string;
  policy: ServiceQuotaPolicy;
  dayKey: string;
  dailyUsed: number;
  dailyRemaining: number;
  rollingUsed: number;
  rollingRemaining: number;
  rollingResetAt: number | null;
};

export type ServiceQuotaErrorCode =
  | 'INVALID_REQUEST'
  | 'QUOTA_NOT_FOUND'
  | 'QUOTA_POLICY_CONFLICT'
  | 'QUOTA_RESERVATION_CONFLICT'
  | 'QUOTA_DAILY_LIMIT'
  | 'QUOTA_RESERVATION_EXPIRED'
  | 'QUOTA_PERMIT_CONFLICT'
  | 'QUOTA_RELEASE_CONFLICT'
  | 'QUOTA_UNAVAILABLE';

export class ServiceQuotaError extends Error {
  readonly status: number;
  readonly code: ServiceQuotaErrorCode;

  constructor(message: string, status: number, code: ServiceQuotaErrorCode) {
    super(message);
    this.name = 'ServiceQuotaError';
    this.status = status;
    this.code = code;
  }
}

const invalid = (message: string): never => {
  throw new ServiceQuotaError(message, 400, 'INVALID_REQUEST');
};

export const parseServiceQuotaKey = (value: unknown): string => {
  if (typeof value !== 'string') return invalid('key is required');
  const key = value.trim();
  if (!key || key.length > SERVICE_QUOTA_KEY_MAX_CHARS || !KEY_PATTERN.test(key)) {
    return invalid(
      `key must be 1-${SERVICE_QUOTA_KEY_MAX_CHARS} characters of letters, digits, . _ : - and start alphanumeric`
    );
  }
  return key;
};

export const parseServiceQuotaId = (label: string, value: unknown): string => {
  if (typeof value !== 'string') return invalid(`${label} is required`);
  const id = value.trim();
  if (!id || id.length > SERVICE_QUOTA_ID_MAX_CHARS || !ID_PATTERN.test(id)) {
    return invalid(
      `${label} must be 1-${SERVICE_QUOTA_ID_MAX_CHARS} characters of letters, digits, _ , : - and start alphanumeric`
    );
  }
  return id;
};

const boundedInteger = (label: string, value: unknown, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    return invalid(`${label} must be a whole number from ${minimum} to ${maximum}`);
  }
  return Number(value);
};

export const parseServiceQuotaPolicy = (value: unknown): ServiceQuotaPolicy => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('policy is required');
  const policy = value as Record<string, unknown>;
  return {
    dailyLimit: boundedInteger('policy.dailyLimit', policy.dailyLimit, 1, SERVICE_QUOTA_MAX_DAILY_LIMIT),
    rollingLimit: boundedInteger('policy.rollingLimit', policy.rollingLimit, 1, SERVICE_QUOTA_MAX_ROLLING_LIMIT),
    rollingWindowMs: boundedInteger(
      'policy.rollingWindowMs',
      policy.rollingWindowMs,
      SERVICE_QUOTA_MIN_WINDOW_MS,
      SERVICE_QUOTA_MAX_WINDOW_MS
    )
  };
};

export const parseServiceQuotaCount = (value: unknown, policy: ServiceQuotaPolicy): number =>
  boundedInteger('count', value, 1, policy.dailyLimit);

export const serviceQuotaPoliciesEqual = (left: ServiceQuotaPolicy, right: ServiceQuotaPolicy): boolean =>
  left.dailyLimit === right.dailyLimit &&
  left.rollingLimit === right.rollingLimit &&
  left.rollingWindowMs === right.rollingWindowMs;

export const assertServiceQuotaChildId = (
  label: 'permitId' | 'releaseId',
  reservationId: string,
  value: unknown
): string => {
  const id = parseServiceQuotaId(label, value);
  if (!id.startsWith(`${reservationId}:`)) {
    throw new ServiceQuotaError(
      `${label} does not belong to reservationId`,
      409,
      label === 'permitId' ? 'QUOTA_PERMIT_CONFLICT' : 'QUOTA_RELEASE_CONFLICT'
    );
  }
  return id;
};

export const utcServiceQuotaDayKey = (now: number): string => new Date(now).toISOString().slice(0, 10);

export const createServiceQuotaState = (
  key: string,
  policy: ServiceQuotaPolicy,
  now: number
): ServiceQuotaState => ({
  key,
  policy: { ...policy },
  dayKey: utcServiceQuotaDayKey(now),
  dailyUsed: 0,
  reservations: [],
  permitIds: [],
  releasedIds: [],
  rollingPermits: []
});

export const normalizeServiceQuotaState = (state: ServiceQuotaState, now: number): ServiceQuotaState => {
  const currentDayKey = utcServiceQuotaDayKey(now);
  const movedForward = state.dayKey < currentDayKey;
  const cutoff = now - state.policy.rollingWindowMs;

  return {
    ...state,
    // ISO UTC day keys sort chronologically. A late/clock-skewed invocation
    // must never move a quota that is already on a newer day backwards.
    dayKey: movedForward ? currentDayKey : state.dayKey,
    dailyUsed: movedForward ? 0 : state.dailyUsed,
    reservations: movedForward ? [] : state.reservations.map((entry) => ({ ...entry })),
    permitIds: movedForward ? [] : [...state.permitIds],
    releasedIds: movedForward ? [] : [...state.releasedIds],
    rollingPermits: state.rollingPermits.filter((permit) => permit.at > cutoff).map((permit) => ({ ...permit }))
  };
};

export const serviceQuotaStatus = (state: ServiceQuotaState): ServiceQuotaStatus => {
  const oldest = state.rollingPermits.reduce<number | null>(
    (minimum, permit) => (minimum === null || permit.at < minimum ? permit.at : minimum),
    null
  );
  return {
    key: state.key,
    policy: { ...state.policy },
    dayKey: state.dayKey,
    dailyUsed: state.dailyUsed,
    dailyRemaining: Math.max(0, state.policy.dailyLimit - state.dailyUsed),
    rollingUsed: state.rollingPermits.length,
    rollingRemaining: Math.max(0, state.policy.rollingLimit - state.rollingPermits.length),
    rollingResetAt: oldest === null ? null : oldest + state.policy.rollingWindowMs
  };
};

export const reserveServiceQuotaState = (
  inputState: ServiceQuotaState,
  input: { reservationId: string; count: number; policy: ServiceQuotaPolicy },
  now: number
): { state: ServiceQuotaState; reservation: { dayKey: string; reservationId: string } } => {
  const state = normalizeServiceQuotaState(inputState, now);
  if (!serviceQuotaPoliciesEqual(state.policy, input.policy)) {
    throw new ServiceQuotaError('Quota policy is already pinned to different limits', 409, 'QUOTA_POLICY_CONFLICT');
  }

  const existing = state.reservations.find((reservation) => reservation.id === input.reservationId);
  if (existing) {
    if (existing.count !== input.count) {
      throw new ServiceQuotaError(
        'reservationId was reused with a different count',
        409,
        'QUOTA_RESERVATION_CONFLICT'
      );
    }
    return { state, reservation: { dayKey: state.dayKey, reservationId: input.reservationId } };
  }

  if (state.dailyUsed + input.count > state.policy.dailyLimit) {
    throw new ServiceQuotaError('Daily quota limit reached', 429, 'QUOTA_DAILY_LIMIT');
  }

  const next = {
    ...state,
    dailyUsed: state.dailyUsed + input.count,
    reservations: [...state.reservations, { id: input.reservationId, count: input.count, releasedCount: 0 }]
  };
  return { state: next, reservation: { dayKey: next.dayKey, reservationId: input.reservationId } };
};

export const permitServiceQuotaState = (
  inputState: ServiceQuotaState,
  input: { reservationId: string; permitId: string },
  now: number
): {
  state: ServiceQuotaState;
  permit: { permitId: string; granted: true } | { permitId: string; granted: false; retryAt: number };
} => {
  const state = normalizeServiceQuotaState(inputState, now);
  if (!state.reservations.some((reservation) => reservation.id === input.reservationId)) {
    throw new ServiceQuotaError('Quota reservation is no longer active', 429, 'QUOTA_RESERVATION_EXPIRED');
  }
  if (state.releasedIds.includes(input.permitId)) {
    throw new ServiceQuotaError('A released quota slot cannot acquire a permit', 409, 'QUOTA_PERMIT_CONFLICT');
  }
  if (state.permitIds.includes(input.permitId)) {
    return { state, permit: { permitId: input.permitId, granted: true } };
  }
  if (state.rollingPermits.length >= state.policy.rollingLimit) {
    const oldest = Math.min(...state.rollingPermits.map((permit) => permit.at));
    return {
      state,
      permit: {
        permitId: input.permitId,
        granted: false,
        retryAt: Math.max(now + 10, oldest + state.policy.rollingWindowMs + 10)
      }
    };
  }

  return {
    state: {
      ...state,
      permitIds: [...state.permitIds, input.permitId],
      rollingPermits: [...state.rollingPermits, { id: input.permitId, at: now }]
    },
    permit: { permitId: input.permitId, granted: true }
  };
};

export const releaseServiceQuotaState = (
  inputState: ServiceQuotaState,
  input: { reservationId: string; releaseId: string },
  now: number
): {
  state: ServiceQuotaState;
  release: { releaseId: string; released: true; applied: boolean };
} => {
  const state = normalizeServiceQuotaState(inputState, now);
  const reservation = state.reservations.find((entry) => entry.id === input.reservationId);
  if (!reservation) {
    throw new ServiceQuotaError('Quota reservation is no longer active', 429, 'QUOTA_RESERVATION_EXPIRED');
  }
  if (state.releasedIds.includes(input.releaseId)) {
    return { state, release: { releaseId: input.releaseId, released: true, applied: false } };
  }
  if (state.permitIds.includes(input.releaseId)) {
    throw new ServiceQuotaError('A permitted quota slot cannot be released', 409, 'QUOTA_RELEASE_CONFLICT');
  }
  // Admin reset deliberately zeros reservation counts while preserving their
  // identity. A late cache-hit release from that in-flight workflow is a
  // successful no-op: it must neither decrement fresh post-reset usage nor
  // fail the workflow that owned the old reservation.
  if (reservation.count === 0) {
    return { state, release: { releaseId: input.releaseId, released: true, applied: false } };
  }
  if (reservation.count <= reservation.releasedCount || state.dailyUsed <= 0) {
    throw new ServiceQuotaError('Reservation has no unreleased quota slots', 409, 'QUOTA_RELEASE_CONFLICT');
  }

  return {
    state: {
      ...state,
      dailyUsed: state.dailyUsed - 1,
      releasedIds: [...state.releasedIds, input.releaseId],
      reservations: state.reservations.map((entry) =>
        entry.id === input.reservationId ? { ...entry, releasedCount: entry.releasedCount + 1 } : entry
      )
    },
    release: { releaseId: input.releaseId, released: true, applied: true }
  };
};

export const resetServiceQuotaState = (inputState: ServiceQuotaState, now: number): ServiceQuotaState => {
  const state = normalizeServiceQuotaState(inputState, now);
  return {
    ...state,
    dailyUsed: 0,
    // Keep reservation + permit identity so reset does not cancel in-flight
    // work. Zero counts stop late cache-hit releases decrementing new usage.
    reservations: state.reservations.map((reservation) => ({ ...reservation, count: 0, releasedCount: 0 }))
  };
};
