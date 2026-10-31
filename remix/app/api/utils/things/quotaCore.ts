export const SERVICE_QUOTA_KEY_MAX_CHARS = 128;
export const SERVICE_QUOTA_ID_MAX_CHARS = 160;
export const SERVICE_QUOTA_MAX_DAILY_LIMIT = 10_000;
export const SERVICE_QUOTA_MAX_ROLLING_LIMIT = 1_000;
export const SERVICE_QUOTA_MIN_WINDOW_MS = 100;
export const SERVICE_QUOTA_MAX_WINDOW_MS = 24 * 60 * 60 * 1_000;
// Exact idempotency needs same-day reservation/child history, but a caller can
// legitimately reserve, release, and reserve again. Policy limits therefore
// are not safe array-length bounds. These independent hard caps keep the
// persisted record comfortably beneath MongoDB's document limit; UTC rollover
// and admin reset compact the histories back to empty before more are accepted.
export const SERVICE_QUOTA_MAX_RESERVATION_HISTORY = 10_000;
export const SERVICE_QUOTA_MAX_CHILD_HISTORY = 10_000;

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
	| 'QUOTA_HISTORY_LIMIT'
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
		return invalid(`key must be 1-${SERVICE_QUOTA_KEY_MAX_CHARS} characters of letters, digits, . _ : - and start alphanumeric`);
  }
  return key;
};

export const parseServiceQuotaId = (label: string, value: unknown): string => {
  if (typeof value !== 'string') return invalid(`${label} is required`);
  const id = value.trim();
  if (!id || id.length > SERVICE_QUOTA_ID_MAX_CHARS || !ID_PATTERN.test(id)) {
		return invalid(`${label} must be 1-${SERVICE_QUOTA_ID_MAX_CHARS} characters of letters, digits, _ , : - and start alphanumeric`);
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
		rollingWindowMs: boundedInteger('policy.rollingWindowMs', policy.rollingWindowMs, SERVICE_QUOTA_MIN_WINDOW_MS, SERVICE_QUOTA_MAX_WINDOW_MS)
  };
};

export const parseServiceQuotaCount = (value: unknown, policy: ServiceQuotaPolicy): number => boundedInteger('count', value, 1, policy.dailyLimit);

export const serviceQuotaPoliciesEqual = (left: ServiceQuotaPolicy, right: ServiceQuotaPolicy): boolean =>
	left.dailyLimit === right.dailyLimit && left.rollingLimit === right.rollingLimit && left.rollingWindowMs === right.rollingWindowMs;

export const assertServiceQuotaChildId = (label: 'permitId' | 'releaseId', reservationId: string, value: unknown): string => {
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

export const serviceQuotaChildBelongsToReservation = (childId: string, reservationId: string): boolean => childId.startsWith(`${reservationId}:`);

export const serviceQuotaReservationIdsConflict = (left: string, right: string): boolean =>
	left === right || serviceQuotaChildBelongsToReservation(left, right) || serviceQuotaChildBelongsToReservation(right, left);

const reservationIdForChild = (reservationIds: Set<string>, childId: string): string | null => {
	let match: string | null = null;
	for (let separator = childId.indexOf(':'); separator >= 0; separator = childId.indexOf(':', separator + 1)) {
		const candidate = childId.slice(0, separator);
		if (!reservationIds.has(candidate)) continue;
		if (match !== null) return null;
		match = candidate;
	}
	return match;
};

export const serviceQuotaClaimedChildCount = (state: ServiceQuotaState, reservationId: string): number =>
	[...state.permitIds, ...state.releasedIds].filter((id) => serviceQuotaChildBelongsToReservation(id, reservationId)).length;

export const serviceQuotaChildHistoryFull = (state: ServiceQuotaState): boolean =>
	state.permitIds.length + state.releasedIds.length >= SERVICE_QUOTA_MAX_CHILD_HISTORY;

const hasValidUtcDayKey = (dayKey: unknown): dayKey is string =>
	typeof dayKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dayKey) && new Date(`${dayKey}T00:00:00.000Z`).toISOString().slice(0, 10) === dayKey;

const hasCanonicalQuotaId = (label: string, value: unknown): value is string => {
	try {
		return parseServiceQuotaId(label, value) === value;
	} catch {
		return false;
	}
};

// Shared persisted-state invariant for both the pure reference model and the
// Mongo implementation. Rolling permits intentionally stand alone: the daily
// reservation/id histories are compacted at UTC rollover while still-live
// rolling permits must continue throttling across midnight.
export const isConsistentServiceQuotaState = (state: ServiceQuotaState): boolean => {
	try {
		if (
			parseServiceQuotaKey(state.key) !== state.key ||
			!serviceQuotaPoliciesEqual(parseServiceQuotaPolicy(state.policy), state.policy) ||
			!hasValidUtcDayKey(state.dayKey) ||
			!Number.isSafeInteger(state.dailyUsed) ||
			state.dailyUsed < 0 ||
			state.dailyUsed > state.policy.dailyLimit ||
			!Array.isArray(state.reservations) ||
			!Array.isArray(state.permitIds) ||
			!Array.isArray(state.releasedIds) ||
			!Array.isArray(state.rollingPermits) ||
			state.reservations.length > SERVICE_QUOTA_MAX_RESERVATION_HISTORY ||
			state.permitIds.length + state.releasedIds.length > SERVICE_QUOTA_MAX_CHILD_HISTORY ||
			state.rollingPermits.length > state.policy.rollingLimit
		) {
			return false;
		}
	} catch {
		return false;
	}

	const reservationIds = new Set<string>();
	for (const reservation of state.reservations) {
		if (
			!hasCanonicalQuotaId('reservationId', reservation.id) ||
			reservationIds.has(reservation.id) ||
			!Number.isSafeInteger(reservation.count) ||
			reservation.count < 1 ||
			reservation.count > state.policy.dailyLimit ||
			!Number.isSafeInteger(reservation.releasedCount) ||
			reservation.releasedCount < 0 ||
			reservation.releasedCount > reservation.count
		) {
			return false;
		}
		reservationIds.add(reservation.id);
	}
	for (const reservationId of reservationIds) {
		for (let separator = reservationId.indexOf(':'); separator >= 0; separator = reservationId.indexOf(':', separator + 1)) {
			if (reservationIds.has(reservationId.slice(0, separator))) return false;
		}
	}

	if (state.reservations.reduce((sum, entry) => sum + entry.count - entry.releasedCount, 0) !== state.dailyUsed) {
		return false;
	}

	const permitIds = new Set(state.permitIds);
	const releasedIds = new Set(state.releasedIds);
	if (
		permitIds.size !== state.permitIds.length ||
		releasedIds.size !== state.releasedIds.length ||
		state.permitIds.some((id) => releasedIds.has(id)) ||
		state.permitIds.some((id) => !hasCanonicalQuotaId('permitId', id)) ||
		state.releasedIds.some((id) => !hasCanonicalQuotaId('releaseId', id))
	) {
		return false;
	}

	const claimedByReservation = new Map<string, number>();
	const releasedByReservation = new Map<string, number>();
	for (const id of state.permitIds) {
		const reservationId = reservationIdForChild(reservationIds, id);
		if (!reservationId) return false;
		claimedByReservation.set(reservationId, (claimedByReservation.get(reservationId) || 0) + 1);
	}
	for (const id of state.releasedIds) {
		const reservationId = reservationIdForChild(reservationIds, id);
		if (!reservationId) return false;
		claimedByReservation.set(reservationId, (claimedByReservation.get(reservationId) || 0) + 1);
		releasedByReservation.set(reservationId, (releasedByReservation.get(reservationId) || 0) + 1);
	}
	for (const reservation of state.reservations) {
		if (
			(claimedByReservation.get(reservation.id) || 0) > reservation.count ||
			(releasedByReservation.get(reservation.id) || 0) !== reservation.releasedCount
		) {
			return false;
		}
	}

	const rollingIds = new Set<string>();
	for (const permit of state.rollingPermits) {
		if (!hasCanonicalQuotaId('permitId', permit.id) || rollingIds.has(permit.id) || !Number.isSafeInteger(permit.at) || permit.at < 0) {
			return false;
		}
		// A same-day release cannot free an actively rolling slot under a different
		// operation; across UTC rollover releasedIds is empty, so retained rolling
		// permits remain valid without restoring compacted daily identity arrays.
		if (releasedIds.has(permit.id)) return false;
		rollingIds.add(permit.id);
	}
	return true;
};

const quotaHistoryLimit = (): never => {
	throw new ServiceQuotaError('Daily quota idempotency history is full; reset the quota or wait for UTC rollover', 429, 'QUOTA_HISTORY_LIMIT');
};

const quotaStateUnavailable = (): never => {
	throw new ServiceQuotaError('Quota state is inconsistent', 503, 'QUOTA_UNAVAILABLE');
};

const normalizedConsistentState = (state: ServiceQuotaState, now: number): ServiceQuotaState => {
	const normalized = normalizeServiceQuotaState(state, now);
	return isConsistentServiceQuotaState(normalized) ? normalized : quotaStateUnavailable();
};

export const utcServiceQuotaDayKey = (now: number): string => new Date(now).toISOString().slice(0, 10);

export const createServiceQuotaState = (key: string, policy: ServiceQuotaPolicy, now: number): ServiceQuotaState => ({
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
	const state = normalizedConsistentState(inputState, now);
  if (!serviceQuotaPoliciesEqual(state.policy, input.policy)) {
    throw new ServiceQuotaError('Quota policy is already pinned to different limits', 409, 'QUOTA_POLICY_CONFLICT');
  }

  const existing = state.reservations.find((reservation) => reservation.id === input.reservationId);
  if (existing) {
    if (existing.count !== input.count) {
			throw new ServiceQuotaError('reservationId was reused with a different count', 409, 'QUOTA_RESERVATION_CONFLICT');
    }
    return { state, reservation: { dayKey: state.dayKey, reservationId: input.reservationId } };
  }

	if (state.reservations.some((reservation) => serviceQuotaReservationIdsConflict(reservation.id, input.reservationId))) {
		throw new ServiceQuotaError('reservationId overlaps an existing reservation namespace', 409, 'QUOTA_RESERVATION_CONFLICT');
	}

  if (state.dailyUsed + input.count > state.policy.dailyLimit) {
    throw new ServiceQuotaError('Daily quota limit reached', 429, 'QUOTA_DAILY_LIMIT');
  }
	if (state.reservations.length >= SERVICE_QUOTA_MAX_RESERVATION_HISTORY) quotaHistoryLimit();

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
	const state = normalizedConsistentState(inputState, now);
	// Rolling permits outlive daily identity history at UTC rollover. A retry of
	// that same expensive unit remains granted until its rolling window expires.
	if (state.rollingPermits.some((permit) => permit.id === input.permitId)) {
		return { state, permit: { permitId: input.permitId, granted: true } };
	}
	const reservation = state.reservations.find((entry) => entry.id === input.reservationId);
	if (!reservation) {
    throw new ServiceQuotaError('Quota reservation is no longer active', 429, 'QUOTA_RESERVATION_EXPIRED');
  }
  if (state.releasedIds.includes(input.permitId)) {
    throw new ServiceQuotaError('A released quota slot cannot acquire a permit', 409, 'QUOTA_PERMIT_CONFLICT');
  }
  if (state.permitIds.includes(input.permitId)) {
    return { state, permit: { permitId: input.permitId, granted: true } };
  }
	if (serviceQuotaClaimedChildCount(state, input.reservationId) >= reservation.count) {
		throw new ServiceQuotaError('Reservation has no unclaimed quota slots', 409, 'QUOTA_PERMIT_CONFLICT');
	}
	if (serviceQuotaChildHistoryFull(state)) quotaHistoryLimit();
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
	const state = normalizedConsistentState(inputState, now);
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
	if (state.rollingPermits.some((permit) => permit.id === input.releaseId)) {
		throw new ServiceQuotaError('An actively permitted quota slot cannot be released', 409, 'QUOTA_RELEASE_CONFLICT');
  }
	if (
		serviceQuotaClaimedChildCount(state, input.reservationId) >= reservation.count ||
		reservation.count <= reservation.releasedCount ||
		state.dailyUsed <= 0
	) {
    throw new ServiceQuotaError('Reservation has no unreleased quota slots', 409, 'QUOTA_RELEASE_CONFLICT');
  }
	if (serviceQuotaChildHistoryFull(state)) quotaHistoryLimit();

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
	const state = normalizedConsistentState(inputState, now);
  return {
    ...state,
    dailyUsed: 0,
		// Reset is the explicit same-day compaction boundary. Daily reservation and
		// idempotency histories are discarded together; active rolling permits stay
		// until their own window expires so reset cannot bypass concurrency limits.
		reservations: [],
		permitIds: [],
		releasedIds: []
  };
};
