import { revealUserVaultValue } from '../lopu/userVault';
import { MAPBOX_PROFILES, type MapCoordinate, type MapStop, type MapboxProfile } from '~/schemas/maps';

const ORIGIN = 'https://api.mapbox.com';
const TIMEOUT_MS = 12_000;
const RESPONSE_BYTES = 2 * 1024 * 1024;

export class MapsError extends Error {
	constructor(public status: number, message: string) { super(message); }
}

const fail = (status: number, message: string): never => { throw new MapsError(status, message); };
const coordinate = (value: unknown): value is MapCoordinate =>
	Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number' && Number.isFinite(n)) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;

async function keyFor(ownerId: string, vaultId: unknown, reveal = revealUserVaultValue): Promise<string> {
	if (typeof vaultId !== 'string' || !vaultId) return fail(400, 'Choose a Mapbox Vault credential.');
	const key = await reveal(ownerId, vaultId);
	if (!key || !/^(pk|sk)\.[A-Za-z0-9._-]+$/.test(key)) return fail(409, 'The selected Mapbox Vault credential is unavailable.');
	return key;
}

async function providerJson(path: string, params: Record<string, string>, key: string, transport: typeof fetch, signal?: AbortSignal): Promise<any> {
	const url = new URL(path, ORIGIN);
	if (url.origin !== ORIGIN) return fail(500, 'Map service configuration is invalid.');
	for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
	url.searchParams.set('access_token', key);
	try {
		const response = await transport(url, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS) });
		if (!response.ok) {
			if (response.status === 429) return fail(429, 'Mapbox rate limit reached. Try again shortly.');
			if (response.status === 401 || response.status === 403) return fail(409, 'Mapbox rejected the selected credential or its API permissions.');
			if (response.status === 400 || response.status === 422) return fail(422, 'Mapbox could not process these locations.');
			return fail(502, 'Mapbox is unavailable. Try again shortly.');
		}
		const reader = response.body?.getReader();
		if (!reader) return fail(502, 'Mapbox returned an empty response.');
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			for (;;) {
				const next = await reader.read();
				if (next.done) break;
				size += next.value.byteLength;
				if (size > RESPONSE_BYTES) return fail(502, 'Mapbox returned more route data than this request can process.');
				chunks.push(next.value);
			}
		} finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch (error) {
		if (error instanceof MapsError) throw error;
		if (signal?.aborted) return fail(499, 'Map request was cancelled.');
		return fail(502, 'Mapbox could not be reached. Try again shortly.');
	}
}

export async function mapboxGeocode(ownerId: string, input: any, transport: typeof fetch = fetch, reveal = revealUserVaultValue, signal?: AbortSignal) {
	const query = typeof input?.query === 'string' ? input.query.trim() : '';
	if (!query) return fail(400, 'Enter an address.');
	const permanent = input?.permanent === true;
	if (permanent && (typeof input?.expectedId !== 'string' || !input.expectedId)) return fail(400, 'Choose an address suggestion before saving it.');
	const key = await keyFor(ownerId, input?.vaultId, reveal);
	const data = await providerJson('/search/geocode/v6/forward', { q: query, autocomplete: permanent ? 'false' : 'true', permanent: String(permanent), limit: permanent ? '1' : '8', types: 'address,street,place,locality' }, key, transport, signal);
	const suggestions = (Array.isArray(data?.features) ? data.features : []).flatMap((feature: any) => {
		const coordinates = feature?.geometry?.coordinates;
		const id = feature?.properties?.mapbox_id;
		const address = feature?.properties?.full_address || feature?.properties?.place_formatted || feature?.properties?.name;
		return coordinate(coordinates) && typeof id === 'string' && typeof address === 'string'
			? [{ id, label: String(feature.properties.name || address), address, coordinates }]
			: [];
	});
	if (permanent && suggestions[0]?.id !== input.expectedId) return fail(409, 'The selected address changed. Search again before saving.');
	return { ok: true as const, suggestions, cachePolicy: permanent ? 'permanent-geocoding-only' as const : 'transient' as const };
}

export async function mapboxOptimize(ownerId: string, input: any, transport: typeof fetch = fetch, reveal = revealUserVaultValue, signal?: AbortSignal) {
	const stops: unknown = input?.stops;
	if (!Array.isArray(stops) || stops.length < 2 || stops.length > 12) return fail(400, 'Mapbox Optimization v1 requires 2 to 12 stops.');
	if (!stops.every((stop: any) => stop && typeof stop.id === 'string' && stop.id && coordinate(stop.coordinates))) return fail(400, 'Every stop needs an ID and valid coordinates.');
	if (new Set(stops.map((stop: MapStop) => stop.id)).size !== stops.length) return fail(400, 'Stop IDs must be unique.');
	const profile: MapboxProfile = input?.profile ?? 'driving';
	if (!(MAPBOX_PROFILES as readonly string[]).includes(profile)) return fail(400, 'Choose a supported travel profile.');
	const roundtrip = input?.roundtrip !== false;
	const key = await keyFor(ownerId, input?.vaultId, reveal);
	const coordinates = (stops as MapStop[]).map((stop) => stop.coordinates.join(',')).join(';');
	const data = await providerJson(`/optimized-trips/v1/mapbox/${profile}/${coordinates}`, { geometries: 'geojson', overview: 'full', steps: 'false', source: 'first', destination: roundtrip ? 'any' : 'last', roundtrip: String(roundtrip) }, key, transport, signal);
	const trip = data?.trips?.[0];
	const waypoints = data?.waypoints;
	if (!trip || !Array.isArray(waypoints) || waypoints.length !== stops.length || !Array.isArray(trip?.geometry?.coordinates) || !trip.geometry.coordinates.every(coordinate) || !Number.isFinite(trip.distance) || !Number.isFinite(trip.duration))
		return fail(502, 'Mapbox returned an incomplete optimized route.');
	const indices = waypoints.map((point: any) => point?.waypoint_index);
	if (indices.some((index: any) => !Number.isInteger(index) || index < 0 || index >= stops.length) || new Set(indices).size !== stops.length)
		return fail(502, 'Mapbox returned an incomplete stop order.');
	const orderedStopIds = (stops as MapStop[]).map((stop, index) => ({ id: stop.id, order: indices[index] })).sort((a, b) => a.order - b.order).map((stop) => stop.id);
	return { ok: true as const, orderedStopIds, geometry: { type: 'LineString' as const, coordinates: trip.geometry.coordinates as MapCoordinate[] }, distanceMeters: trip.distance as number, durationSeconds: trip.duration as number, cachePolicy: 'transient' as const, notice: 'Mapbox navigation results are for current display only and must not be stored or cached.' };
}

export async function mapboxBrowserConfig(ownerId: string, input: any, reveal = revealUserVaultValue) {
	const key = await keyFor(ownerId, input?.vaultId, reveal);
	if (!key.startsWith('pk.')) return fail(409, 'Choose a public Mapbox pk token for browser map display.');
	return { ok: true as const, publicToken: key };
}
