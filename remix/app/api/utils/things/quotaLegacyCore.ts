import { createHash } from 'node:crypto';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import {
	SERVICE_QUOTA_MAX_CHILD_HISTORY,
	SERVICE_QUOTA_MAX_RESERVATION_HISTORY,
	isConsistentServiceQuotaState,
	parseServiceQuotaId,
	parseServiceQuotaKey,
	parseServiceQuotaPolicy,
	ServiceQuotaError,
	utcServiceQuotaDayKey
} from './quotaCore.ts';
import type { ServiceQuotaPolicy, ServiceQuotaReservation, ServiceQuotaState } from './quotaCore.ts';
// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry.ts';

export const SERVICE_QUOTA_THINGTIME = 'service-quota';
export const SERVICE_QUOTA_VERSION = 1;

export type QuotaThingDoc = {
	shareId: string;
	schemaVersion: number;
	thingtime: string[];
	storageClass: 'control';
	crystal: {
		quotaKind: typeof SERVICE_QUOTA_THINGTIME;
		quotaVersion: typeof SERVICE_QUOTA_VERSION;
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

type LegacyServiceQuotaQuarantineReason = 'unsupported-version' | 'identity-mismatch' | 'noncanonical-envelope' | 'invalid-state';

export type LegacyServiceQuotaClassification =
	| { disposition: 'ignore' }
	| { disposition: 'quarantine'; reason: LegacyServiceQuotaQuarantineReason }
	| {
			disposition: 'rebuild';
			ownerId: string;
			key: string;
			policy: ServiceQuotaPolicy;
	  };

export const quotaShareId = (ownerId: string, key: string): string =>
	`quota-${createHash('sha256').update(ownerId).update('\0').update(key).digest('hex').slice(0, 48)}`;

export const validatedServiceQuotaDocumentState = (doc: any): ServiceQuotaState | null => {
	const crystal = doc?.crystal;
	try {
		if (
			!crystal ||
			crystal.quotaKind !== SERVICE_QUOTA_THINGTIME ||
			crystal.quotaVersion !== SERVICE_QUOTA_VERSION ||
			!Array.isArray(crystal.reservations) ||
			!Array.isArray(crystal.permitIds) ||
			!Array.isArray(crystal.releasedIds) ||
			!Array.isArray(crystal.rollingPermits)
		) {
			return null;
		}
		const key = parseServiceQuotaKey(crystal.key);
		if (key !== crystal.key) return null;
		const policy = parseServiceQuotaPolicy(crystal.policy);
		const dayKey = typeof crystal.dayKey === 'string' ? crystal.dayKey : '';
		if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || new Date(`${dayKey}T00:00:00.000Z`).toISOString().slice(0, 10) !== dayKey) {
			return null;
		}
		if (!Number.isSafeInteger(crystal.dailyUsed) || crystal.dailyUsed < 0 || crystal.dailyUsed > policy.dailyLimit) return null;
		if (
			crystal.reservations.length > SERVICE_QUOTA_MAX_RESERVATION_HISTORY ||
			crystal.permitIds.length + crystal.releasedIds.length > SERVICE_QUOTA_MAX_CHILD_HISTORY ||
			crystal.rollingPermits.length > policy.rollingLimit
		) {
			return null;
		}

		const reservationIds = new Set<string>();
		const reservations: ServiceQuotaReservation[] = [];
		for (const entry of crystal.reservations) {
			const id = parseServiceQuotaId('reservationId', entry?.id);
			if (id !== entry.id || reservationIds.has(id)) return null;
			if (!Number.isSafeInteger(entry?.count) || entry.count < 0 || entry.count > policy.dailyLimit) return null;
			if (!Number.isSafeInteger(entry?.releasedCount) || entry.releasedCount < 0 || entry.releasedCount > entry.count) return null;
			reservationIds.add(id);
			reservations.push({ id, count: entry.count, releasedCount: entry.releasedCount });
		}
		if (reservations.reduce((sum, entry) => sum + entry.count - entry.releasedCount, 0) !== crystal.dailyUsed) return null;

		const validateChildIds = (values: unknown[]): string[] | null => {
			const seen = new Set<string>();
			const result: string[] = [];
			for (const value of values) {
				const id = parseServiceQuotaId('permitId', value);
				if (id !== value || seen.has(id)) return null;
				seen.add(id);
				result.push(id);
			}
			return result;
		};
		const permitIds = validateChildIds(crystal.permitIds);
		const releasedIds = validateChildIds(crystal.releasedIds);
		if (!permitIds || !releasedIds || permitIds.some((id) => releasedIds.includes(id))) return null;

		const rollingIds = new Set<string>();
		const rollingPermits: Array<{ id: string; at: number }> = [];
		for (const entry of crystal.rollingPermits) {
			const id = parseServiceQuotaId('permitId', entry?.id);
			if (id !== entry?.id || rollingIds.has(id) || !Number.isSafeInteger(entry?.at) || entry.at < 0) {
				return null;
			}
			rollingIds.add(id);
			rollingPermits.push({ id, at: entry.at });
		}

		const state = { key, policy, dayKey, dailyUsed: crystal.dailyUsed, reservations, permitIds, releasedIds, rollingPermits };
		return isConsistentServiceQuotaState(state) ? state : null;
	} catch {
		return null;
	}
};

const isRecord = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);

const hasOwn = (value: Record<string, any>, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

const hasExactKeys = (value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, any> => {
	if (!isRecord(value)) return false;
	const allowed = new Set([...required, ...optional]);
	return required.every((key) => hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
};

const hasExactStringArray = (value: unknown, expected: readonly string[]): boolean =>
	Array.isArray(value) && value.length === expected.length && value.every((entry, index) => entry === expected[index]);

const isValidStoredDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());

const hasExactQuotaCrystalEnvelope = (value: unknown): value is Record<string, any> => {
	if (
		!hasExactKeys(
			value,
			['quotaKind', 'quotaVersion', 'key', 'policy', 'dayKey', 'dailyUsed', 'reservations', 'permitIds', 'releasedIds', 'rollingPermits'],
			['lastReleaseResult']
		) ||
		!hasExactKeys(value.policy, ['dailyLimit', 'rollingLimit', 'rollingWindowMs']) ||
		!Array.isArray(value.reservations) ||
		!value.reservations.every((entry: unknown) => hasExactKeys(entry, ['id', 'count', 'releasedCount'])) ||
		!Array.isArray(value.rollingPermits) ||
		!value.rollingPermits.every((entry: unknown) => hasExactKeys(entry, ['id', 'at']))
	) {
		return false;
	}

	if (hasOwn(value, 'lastReleaseResult')) {
		const result = value.lastReleaseResult;
		if (!hasExactKeys(result, ['requestId', 'releaseId', 'applied']) || typeof result.applied !== 'boolean') {
			return false;
		}
		try {
			if (
				parseServiceQuotaId('requestId', result.requestId) !== result.requestId ||
				parseServiceQuotaId('releaseId', result.releaseId) !== result.releaseId
			) {
				return false;
			}
		} catch {
			return false;
		}
	}
	return true;
};

export const validatedCanonicalServiceQuotaDocumentState = (
	value: unknown,
	expectedOwnerId: string,
	expectedKey: string
): ServiceQuotaState | null => {
	if (
		!hasExactKeys(
			value,
			['shareId', 'schemaVersion', 'thingtime', 'storageClass', 'crystal', 'ownerId', 'acl', 'targetId', 'tags', 'createdAt', 'updatedAt'],
			['_id']
		) ||
		value.schemaVersion !== COLLECTION_SCHEMA_VERSIONS.things ||
		!hasExactStringArray(value.thingtime, [SERVICE_QUOTA_THINGTIME]) ||
		value.storageClass !== 'control' ||
		value.ownerId !== expectedOwnerId ||
		value.shareId !== quotaShareId(expectedOwnerId, expectedKey) ||
		!hasExactStringArray(value.acl, [ACL_OWNER]) ||
		value.targetId !== null ||
		!hasExactStringArray(value.tags, [SERVICE_QUOTA_THINGTIME]) ||
		!isValidStoredDate(value.createdAt) ||
		!isValidStoredDate(value.updatedAt) ||
		!hasExactQuotaCrystalEnvelope(value.crystal)
	) {
		return null;
	}
	const state = validatedServiceQuotaDocumentState(value);
	return state?.key === expectedKey ? state : null;
};

export const requireCanonicalServiceQuotaDocumentState = (value: unknown, expectedOwnerId: string, expectedKey: string): ServiceQuotaState => {
	const state = validatedCanonicalServiceQuotaDocumentState(value, expectedOwnerId, expectedKey);
	if (!state) {
		throw new ServiceQuotaError('Quota store is unavailable', 503, 'QUOTA_UNAVAILABLE');
	}
	return state;
};

const hasExactLegacyServiceQuotaEnvelope = (doc: Record<string, any>): boolean => {
	if (
		!hasExactKeys(doc, ['_id', 'shareId', 'schemaVersion', 'thingtime', 'crystal', 'ownerId', 'acl', 'targetId', 'tags', 'createdAt', 'updatedAt']) ||
		doc.schemaVersion !== COLLECTION_SCHEMA_VERSIONS.things ||
		!hasExactStringArray(doc.thingtime, ['data']) ||
		!hasExactStringArray(doc.acl, [ACL_OWNER]) ||
		doc.targetId !== null ||
		!hasExactStringArray(doc.tags, [SERVICE_QUOTA_THINGTIME]) ||
		!isValidStoredDate(doc.createdAt) ||
		!isValidStoredDate(doc.updatedAt) ||
		!hasExactQuotaCrystalEnvelope(doc.crystal)
	) {
		return false;
	}
	return true;
};

// Legacy quota rows were ordinary, user-editable `data` Things, so matching a
// marker or even a valid state is not provenance. Only the exact historical
// server envelope is eligible for a conservative rebuild. Everything else
// remains ordinary billable data and keeps the reserved id occupied, failing
// quota operations closed rather than discarding or exempting user payload.
export const classifyLegacyServiceQuotaThing = (value: unknown): LegacyServiceQuotaClassification => {
	if (!isRecord(value)) {
		return { disposition: 'ignore' };
	}
	const claimsDataKind = value.thingtime === 'data' || (Array.isArray(value.thingtime) && value.thingtime.includes('data'));
	if (!claimsDataKind) {
		return { disposition: 'ignore' };
	}
	if (!isRecord(value.crystal) || value.crystal.quotaKind !== SERVICE_QUOTA_THINGTIME) {
		return { disposition: 'ignore' };
	}
	if (value.crystal.quotaVersion !== SERVICE_QUOTA_VERSION) {
		return { disposition: 'quarantine', reason: 'unsupported-version' };
	}

	let key: string;
	try {
		key = parseServiceQuotaKey(value.crystal.key);
	} catch {
		return { disposition: 'quarantine', reason: 'identity-mismatch' };
	}
	if (
		key !== value.crystal.key ||
		typeof value.ownerId !== 'string' ||
		value.ownerId.length === 0 ||
		value.shareId !== quotaShareId(value.ownerId, key)
	) {
		return { disposition: 'quarantine', reason: 'identity-mismatch' };
	}
	if (!hasExactLegacyServiceQuotaEnvelope(value)) {
		return { disposition: 'quarantine', reason: 'noncanonical-envelope' };
	}

	const state = validatedServiceQuotaDocumentState(value);
	if (!state) return { disposition: 'quarantine', reason: 'invalid-state' };
	return { disposition: 'rebuild', ownerId: value.ownerId, key, policy: { ...state.policy } };
};

// Never preserve counters, histories, timestamps, ACLs, or extra payload from
// a user-editable legacy row. The replacement is a new canonical control Thing
// whose bounded policy is fully consumed for both admission windows. Normal UTC
// rollover/window expiry is the only automatic path back to available quota.
export const buildConservativeLegacyServiceQuotaThing = (input: { ownerId: unknown; key: unknown; policy: unknown }, now: number): QuotaThingDoc => {
	if (typeof input.ownerId !== 'string' || input.ownerId.length === 0) {
		throw new ServiceQuotaError('ownerId is required', 400, 'INVALID_REQUEST');
	}
	if (!Number.isSafeInteger(now) || now < 0) {
		throw new ServiceQuotaError('now must be a non-negative integer timestamp', 400, 'INVALID_REQUEST');
	}
	const key = parseServiceQuotaKey(input.key);
	if (key !== input.key) {
		throw new ServiceQuotaError('key must be canonical', 400, 'INVALID_REQUEST');
	}
	const policy = parseServiceQuotaPolicy(input.policy);
	const reservationId = 'legacy-rebuild';
	const at = new Date(now);
	const state: ServiceQuotaState = {
		key,
		policy,
		dayKey: utcServiceQuotaDayKey(now),
		dailyUsed: policy.dailyLimit,
		reservations: [{ id: reservationId, count: policy.dailyLimit, releasedCount: 0 }],
		permitIds: [],
		releasedIds: [],
		rollingPermits: Array.from({ length: policy.rollingLimit }, (_, index) => ({
			id: `${reservationId}:rolling-${index}`,
			at: now
		}))
	};
	if (!isConsistentServiceQuotaState(state)) {
		throw new ServiceQuotaError('Quota state is inconsistent', 503, 'QUOTA_UNAVAILABLE');
	}

	return {
		shareId: quotaShareId(input.ownerId, key),
		schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
		thingtime: [SERVICE_QUOTA_THINGTIME],
		storageClass: 'control',
		crystal: {
			quotaKind: SERVICE_QUOTA_THINGTIME,
			quotaVersion: SERVICE_QUOTA_VERSION,
			...state
		},
		ownerId: input.ownerId,
		acl: [ACL_OWNER],
		targetId: null,
		tags: [SERVICE_QUOTA_THINGTIME],
		createdAt: at,
		updatedAt: at
	};
};
