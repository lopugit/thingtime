export type LngLat = [number, number];
export type MapboxPoint = { id: string; coordinates: LngLat; label: string; markerLabel?: string; color?: string; selected?: boolean; group?: 'favourite' | 'route' };

export function publicMapboxToken(value: unknown): string | null {
	const token = value && typeof value === 'object' ? (value as Record<string, unknown>).publicToken : null;
	return typeof token === 'string' && /^pk\.[A-Za-z0-9._-]+$/.test(token) ? token : null;
}

export const validCoordinates = (value: unknown): value is LngLat =>
	Array.isArray(value) && value.length === 2 &&
	value.every((part) => typeof part === 'number' && Number.isFinite(part)) &&
	Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;

export function mapboxPoints(value: unknown): MapboxPoint[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry, index) => {
		if (!entry || typeof entry !== 'object' || !validCoordinates(entry.coordinates)) return [];
		return [{
			id: typeof entry.id === 'string' ? entry.id : String(index),
			coordinates: entry.coordinates,
			label: typeof entry.label === 'string' ? entry.label : '',
			...(typeof entry.markerLabel === 'string' ? { markerLabel: entry.markerLabel } : {}),
			...(typeof entry.color === 'string' && /^#[a-f0-9]{6}$/i.test(entry.color) ? { color: entry.color } : {}),
			...(typeof entry.selected === 'boolean' ? { selected: entry.selected } : {}),
			...(entry.group === 'favourite' || entry.group === 'route' ? { group: entry.group } : {})
		}];
	});
}

/** Stored independently supplied place coordinates; no provider search results are persisted here. */
export function mapboxFavouritePoints(value: unknown): MapboxPoint[] {
	if (!Array.isArray(value)) return [];
	return mapboxPoints(value.map((item) => ({
		id: item?.id,
		label: item?.label ?? item?.crystal?.title,
		coordinates: item?.coordinates ?? [item?.crystal?.longitude, item?.crystal?.latitude],
		markerLabel: '•', color: '#167d8d', group: 'favourite'
	})));
}

export function mapboxHeight(value: unknown): number | string {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
	if (typeof value === 'string' && (/^\d+(?:\.\d+)?(?:px|%|dvh|svh|vh|rem)$/.test(value) ||
		/^calc\([\d\s.+*/()%-]+(?:px|dvh|svh|vh|rem)[\d\s.+*/()%-]*(?:px|dvh|svh|vh|rem)?\)$/.test(value))) return value;
	return 420;
}

/** Only the active route may consume a live, in-memory Navigation result. */
export function activeMapboxNavigation(value: unknown, routeId: unknown): Record<string, any> | null {
	return value && typeof value === 'object' && !Array.isArray(value) && typeof routeId === 'string' && routeId &&
		(value as Record<string, unknown>).routeId === routeId ? value as Record<string, any> : null;
}

/** Source pages can be locally sorted; rank the complete stop set before numbering. */
export function mapboxOrderedRoutePoints(value: unknown, navigation: Record<string, any> | null): MapboxPoint[] {
	const result = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	const points = mapboxPoints(result.points);
	const ranks = new Map<string, number>();
	if (Array.isArray(result.items)) for (const item of result.items) {
		if (typeof item?.id === 'string' && typeof item?.crystal?.rank === 'number' && Number.isFinite(item.crystal.rank)) ranks.set(item.id, item.crystal.rank);
	}
	const order = new Map<unknown, number>(Array.isArray(navigation?.orderedStopIds) ? navigation.orderedStopIds.map((id: unknown, index: number) => [id, index]) : []);
	return points.sort((a, b) => {
		const left = order.size ? order.get(a.id) : ranks.get(a.id), right = order.size ? order.get(b.id) : ranks.get(b.id);
		return (left ?? Infinity) - (right ?? Infinity);
	});
}

export function mapboxRoute(value: unknown): { type: 'Feature'; properties: Record<string, never>; geometry: { type: 'LineString'; coordinates: LngLat[] } } | null {
	const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : null;
	const geometry = candidate?.type === 'Feature' ? candidate.geometry : candidate;
	if (!geometry || typeof geometry !== 'object') return null;
	const line = geometry as { type?: unknown; coordinates?: unknown };
	if (line.type !== 'LineString' || !Array.isArray(line.coordinates) || !line.coordinates.every(validCoordinates)) return null;
	return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line.coordinates } };
}

export function mapboxStyle(value: unknown): string {
	if (typeof value !== 'string') return 'mapbox://styles/mapbox/streets-v12';
	if (/^mapbox:\/\/styles\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(value)) return value;
	try {
		const url = new URL(value);
		if (url.protocol === 'https:' && url.hostname === 'api.mapbox.com' && /^\/styles\/v1\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname) && !url.search && !url.hash) return value;
	} catch { /* invalid URL */ }
	return 'mapbox://styles/mapbox/streets-v12';
}
