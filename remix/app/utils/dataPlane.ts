/** Public database identity, identical to Timeline's canonical scope key.
 * It contains no connection URL or credentials. */
export const EXPECTED_DATA_PLANE_HEADER = 'X-Thingtime-Expected-Data-Plane';
export const isDataPlane = (value: unknown): value is string =>
	typeof value === 'string' && /^(?:home|custom-[0-9a-f]{64})$/.test(value);

export const thingHistoryHref = (thingId: string, dataPlane: string, ownerId: string) => {
	if (!isDataPlane(dataPlane)) throw new Error('Unknown Thing database');
	return `/thing/${encodeURIComponent(thingId)}?from=things&dataPlane=${encodeURIComponent(dataPlane)}&historyOwner=${encodeURIComponent(ownerId)}`;
};

/** Ambiguous legacy caches never seed a database-qualified Thing view. */
export const scopedThingCacheKey = (ownerId: string | null, dataPlane: unknown, thingId: string) =>
	isDataPlane(dataPlane) ? `tt-thing-v2-${JSON.stringify([ownerId, dataPlane, thingId])}` : null;
