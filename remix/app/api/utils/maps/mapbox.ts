import { revealUserVaultValue } from '../lopu/userVault';
import { MAPBOX_PROFILES, type MapCoordinate, type MapStop, type MapboxProfile } from '~/schemas/maps';

const ORIGIN = 'https://api.mapbox.com';
const TIMEOUT_MS = 12_000;
// Processing chunks, not a maximum number of addresses accepted from a caller.
// Mapbox permits 1,000 queries per batch; smaller chunks keep each response short.
const GEOCODE_BATCH_SIZE = 50;
const matchStatuses = new Set(['matched', 'unmatched', 'not_applicable', 'inferred', 'plausible']);
const matchFields = ['address_number', 'street', 'postcode', 'place', 'region', 'locality', 'country', 'secondary_address'] as const;
const confidences = new Set(['exact', 'high', 'medium', 'low']);
const accuracies = new Set(['rooftop', 'parcel', 'point', 'interpolated', 'approximate', 'intersection']);
const featureTypes = new Set(['country', 'region', 'postcode', 'district', 'place', 'locality', 'neighborhood', 'street', 'address', 'secondary_address']);

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

async function providerJson(path: string, params: Record<string, string>, key: string, transport: typeof fetch, signal?: AbortSignal, body?: unknown): Promise<any> {
	const url = new URL(path, ORIGIN);
	if (url.origin !== ORIGIN) return fail(500, 'Map service configuration is invalid.');
	for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
	url.searchParams.set('access_token', key);
	const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
	try {
		requestSignal.throwIfAborted();
		const response = await transport(url, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), redirect: 'error', credentials: 'omit', cache: 'no-store', signal: requestSignal });
		requestSignal.throwIfAborted();
		if (!response.ok) {
			if (response.status === 429) return fail(429, 'Mapbox rate limit reached. Try again shortly.');
			if (response.status === 401 || response.status === 403) return fail(409, 'Mapbox rejected the selected credential or its API permissions.');
			if (response.status === 400 || response.status === 422) return fail(422, 'Mapbox could not process these locations.');
			return fail(502, 'Mapbox is unavailable. Try again shortly.');
		}
		const reader = response.body?.getReader();
		if (!reader) return fail(502, 'Mapbox returned an empty response.');
		const chunks: Uint8Array[] = [];
		try {
			for (;;) {
				const next = await reader.read();
				requestSignal.throwIfAborted();
				if (next.done) break;
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

function geocodeSuggestions(data: any) {
	if (!Array.isArray(data?.features)) return fail(502, 'Mapbox returned an incomplete address result.');
	return data.features.flatMap((feature: any) => {
		const coordinates = feature?.geometry?.coordinates;
		const id = feature?.properties?.mapbox_id;
		const properties = feature?.properties;
		const address = typeof properties?.full_address === 'string' ? properties.full_address :
			[properties?.name, properties?.place_formatted].filter(part => typeof part === 'string' && part).join(', ');
		const matchCode: Record<string, string> = {};
		if (confidences.has(properties?.match_code?.confidence)) matchCode.confidence = properties.match_code.confidence;
		for (const field of matchFields) if (matchStatuses.has(properties?.match_code?.[field])) matchCode[field] = properties.match_code[field];
		return coordinate(coordinates) && typeof id === 'string' && id && typeof address === 'string' && address
			? [{ id, label: typeof properties.name === 'string' ? properties.name : address, address, coordinates,
				...(featureTypes.has(properties.feature_type) ? { featureType: properties.feature_type as string } : {}),
				...(accuracies.has(properties.coordinates?.accuracy) ? { accuracy: properties.coordinates.accuracy as string } : {}),
				...(Object.keys(matchCode).length ? { matchCode } : {}) }]
			: [];
	});
}

export async function mapboxGeocode(ownerId: string, input: any, transport: typeof fetch = fetch, reveal = revealUserVaultValue, signal?: AbortSignal) {
	if (input?.autocomplete !== undefined && typeof input.autocomplete !== 'boolean') return fail(400, 'Autocomplete must be true or false.');
	const permanent = input?.permanent === true;
	const autocomplete = permanent ? false : input?.autocomplete ?? true;
	const cachePolicy = permanent ? 'permanent-geocoding-only' as const : 'transient' as const;
	if (input?.queries !== undefined) {
		if (input.query !== undefined || !Array.isArray(input.queries)) return fail(400, 'Choose one address or a list of address queries.');
		const entries: { id: string; query: string; expectedId?: string }[] = input.queries.map((entry: any) => {
			if (!entry || typeof entry.id !== 'string' || !entry.id || typeof entry.query !== 'string' || !entry.query.trim()) return fail(400, 'Every address query needs an ID and address.');
			if (permanent && (typeof entry.expectedId !== 'string' || !entry.expectedId)) return fail(400, 'Choose each address suggestion before saving it.');
			return { id: entry.id, query: entry.query.trim(), ...(permanent ? { expectedId: entry.expectedId } : {}) };
		});
		if (new Set(entries.map(entry => entry.id)).size !== entries.length) return fail(400, 'Address query IDs must be unique.');
		const key = await keyFor(ownerId, input.vaultId, reveal);
		const unique = [...new Set(entries.map(entry => entry.query))];
		const byQuery = new Map<string, ReturnType<typeof geocodeSuggestions>>();
		for (let offset = 0; offset < unique.length; offset += GEOCODE_BATCH_SIZE) {
			if (signal?.aborted) return fail(499, 'Map request was cancelled.');
			const queries = unique.slice(offset, offset + GEOCODE_BATCH_SIZE);
			const data = await providerJson('/search/geocode/v6/batch', { permanent: String(permanent) }, key, transport, signal,
				queries.map(query => ({ q: query, autocomplete, limit: permanent ? 1 : 8, types: ['address', 'street', 'place', 'locality'] })));
			if (!Array.isArray(data?.batch) || data.batch.length !== queries.length) return fail(502, 'Mapbox returned an incomplete address batch.');
			queries.forEach((query, index) => byQuery.set(query, geocodeSuggestions(data.batch[index])));
		}
		const results = entries.map(entry => {
			const suggestions = byQuery.get(entry.query)!;
			if (permanent && suggestions[0]?.id !== entry.expectedId) return fail(409, 'A selected address changed. Search again before saving.');
			return { id: entry.id, suggestions };
		});
		return { ok: true as const, results, cachePolicy };
	}
	const query = typeof input?.query === 'string' ? input.query.trim() : '';
	if (!query) return fail(400, 'Enter an address.');
	if (permanent && (typeof input?.expectedId !== 'string' || !input.expectedId)) return fail(400, 'Choose an address suggestion before saving it.');
	const key = await keyFor(ownerId, input?.vaultId, reveal);
	const data = await providerJson('/search/geocode/v6/forward', { q: query, autocomplete: String(autocomplete), permanent: String(permanent), limit: permanent ? '1' : '8', types: 'address,street,place,locality' }, key, transport, signal);
	const suggestions = geocodeSuggestions(data);
	if (permanent && suggestions[0]?.id !== input.expectedId) return fail(409, 'The selected address changed. Search again before saving.');
	return { ok: true as const, suggestions, cachePolicy };
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
	if (data?.code !== 'Ok' || !trip || !Array.isArray(waypoints) || waypoints.length !== stops.length || trip?.geometry?.type !== 'LineString' || !Array.isArray(trip.geometry.coordinates) || trip.geometry.coordinates.length < 2 || !trip.geometry.coordinates.every(coordinate) || !Number.isFinite(trip.distance) || trip.distance < 0 || !Number.isFinite(trip.duration) || trip.duration < 0)
		return fail(502, 'Mapbox returned an incomplete optimized route.');
	const indices = waypoints.map((point: any) => point?.waypoint_index);
	if (indices.some((index: any) => !Number.isInteger(index) || index < 0 || index >= stops.length) || new Set(indices).size !== stops.length)
		return fail(502, 'Mapbox returned an incomplete stop order.');
	if (indices[0] !== 0 || (!roundtrip && indices[indices.length - 1] !== stops.length - 1))
		return fail(502, 'Mapbox returned a route that does not preserve the selected endpoints.');
	const orderedStopIds = (stops as MapStop[]).map((stop, index) => ({ id: stop.id, order: indices[index] })).sort((a, b) => a.order - b.order).map((stop) => stop.id);
	return { ok: true as const, orderedStopIds, geometry: { type: 'LineString' as const, coordinates: trip.geometry.coordinates as MapCoordinate[] }, distanceMeters: trip.distance as number, durationSeconds: trip.duration as number, cachePolicy: 'transient' as const, notice: 'Mapbox navigation results are for current display only and must not be stored or cached.' };
}

export async function mapboxBrowserConfig(ownerId: string, input: any, reveal = revealUserVaultValue) {
	const key = await keyFor(ownerId, input?.vaultId, reveal);
	if (!key.startsWith('pk.')) return fail(409, 'Choose a public Mapbox pk token for browser map display.');
	return { ok: true as const, publicToken: key };
}
