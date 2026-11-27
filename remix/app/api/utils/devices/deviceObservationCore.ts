/** Registered observation contracts. New domains add typed validation here, never arbitrary payload dispatch. */
export type DeviceLocationValue = {
	latitude: number;
	longitude: number;
	accuracyMeters: number;
	precision?: 'precise' | 'approximate';
	source?: 'core-location' | 'geolocation' | 'manual';
	altitudeMeters?: number;
	verticalAccuracyMeters?: number;
};
export type DeviceObservationInput = { id: string; type: 'location'; collectionId: string; observedAt: string; value: DeviceLocationValue };
export type DeviceObservation = Omit<DeviceObservationInput, 'collectionId'> & { deviceId: string; receivedAt: string };
export type DeviceObservationSettings = { enabled: boolean; retentionMs: number | null; collectionId: string | null };
export const isObservationType = (value: unknown): value is 'location' => value === 'location';
export const observationId = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.trim() === value;
export const observationDate = (value: unknown): string | null => {
	if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) return null;
	const time = Date.parse(value);
	return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
export function normalizeDeviceObservation(input: unknown, now = Date.now()): DeviceObservationInput | null {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const raw = input as Record<string, any>;
	if (
		Object.keys(raw).some((k) => !['id', 'type', 'collectionId', 'observedAt', 'value'].includes(k)) ||
		!observationId(raw.id) ||
		!isObservationType(raw.type) ||
		!observationId(raw.collectionId)
	)
		return null;
	const observedAt = observationDate(raw.observedAt);
	if (!observedAt || Date.parse(observedAt) > now + 60_000) return null;
	const v = raw.value;
	if (
		!v ||
		typeof v !== 'object' ||
		Array.isArray(v) ||
		Object.keys(v).some(
			(k) => !['latitude', 'longitude', 'accuracyMeters', 'precision', 'source', 'altitudeMeters', 'verticalAccuracyMeters'].includes(k)
		)
	)
		return null;
	const numeric = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
	if (
		!numeric(v.latitude) ||
		v.latitude < -90 ||
		v.latitude > 90 ||
		!numeric(v.longitude) ||
		v.longitude < -180 ||
		v.longitude > 180 ||
		!numeric(v.accuracyMeters) ||
		v.accuracyMeters < 0
	)
		return null;
	if (v.precision !== undefined && !['precise', 'approximate'].includes(v.precision)) return null;
	if (v.source !== undefined && !['core-location', 'geolocation', 'manual'].includes(v.source)) return null;
	if (v.altitudeMeters !== undefined && !numeric(v.altitudeMeters)) return null;
	if (v.verticalAccuracyMeters !== undefined && (!numeric(v.verticalAccuracyMeters) || v.verticalAccuracyMeters < 0)) return null;
	return {
		id: raw.id,
		type: raw.type,
		collectionId: raw.collectionId,
		observedAt,
		value: {
			latitude: v.latitude,
			longitude: v.longitude,
			accuracyMeters: v.accuracyMeters,
			...(v.precision !== undefined ? { precision: v.precision } : {}),
			...(v.source !== undefined ? { source: v.source } : {}),
			...(v.altitudeMeters !== undefined ? { altitudeMeters: v.altitudeMeters } : {}),
			...(v.verticalAccuracyMeters !== undefined ? { verticalAccuracyMeters: v.verticalAccuracyMeters } : {})
		}
	};
}
export function observationSettings(device: any, type: 'location'): DeviceObservationSettings {
	const saved = device?.crystal?.observationSettings?.[type];
	return {
		enabled: saved?.enabled === true && observationId(saved?.collectionId),
		retentionMs:
			saved?.retentionMs === null || saved?.retentionMs === undefined
				? null
				: Number.isSafeInteger(saved.retentionMs) && saved.retentionMs > 0
				? saved.retentionMs
				: null,
		collectionId: observationId(saved?.collectionId) ? saved.collectionId : null
	};
}
export const observationExpired = (observedAt: string, retentionMs: number | null, now: number) =>
	retentionMs !== null && Date.parse(observedAt) <= now - retentionMs;
export const observationCutoff = (retentionMs: number, now: number) => new Date(Math.max(-8_640_000_000_000_000, now - retentionMs));
export const observationCursor = (row: { observedAt: string; id: string }) =>
	Buffer.from(JSON.stringify([row.observedAt, row.id])).toString('base64url');
export function parseObservationCursor(value: unknown): { observedAt: string; id: string } | null {
	if (!value) return null;
	if (typeof value !== 'string') throw Error('Invalid observation cursor');
	try {
		const pair = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
		if (Array.isArray(pair) && pair.length === 2 && observationDate(pair[0]) === pair[0] && observationId(pair[1]))
			return { observedAt: pair[0], id: pair[1] };
	} catch {
		/* Refuse malformed cursor. */
	}
	throw Error('Invalid observation cursor');
}
