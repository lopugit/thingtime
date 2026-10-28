export type LngLat = [number, number];
export type MapboxPoint = { id: string; coordinates: LngLat; label: string };

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
			label: typeof entry.label === 'string' ? entry.label : ''
		}];
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
