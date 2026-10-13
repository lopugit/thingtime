import { isActionLookupProvider } from '../../../schemas/actionLookups';

const MAX_BYTES = 128 * 1024;
// Injected transport keeps the provider boundary testable. No authored URLs,
// headers, redirects or credentials enter an action's returned data or errors.
export async function runLookup(
	request: { provider: unknown; query: unknown; credential: string; deadline: number },
	transport: typeof fetch = fetch
) {
	if (!isActionLookupProvider(request.provider)) throw new Error('Unknown lookup provider');
	if (typeof request.query !== 'string' || !request.query.trim() || request.query.length > 500)
		throw new Error('Address lookup needs 1–500 characters');
	if (!request.credential.trim()) throw new Error('Choose your Google Maps credential in Vault');
	const remaining = Math.min(8000, request.deadline - Date.now());
	if (remaining <= 0) throw new Error('Lookup time budget exhausted');
	const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
	url.searchParams.set('address', request.query.trim());
	url.searchParams.set('key', request.credential);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), remaining);
	try {
		const response = await transport(url, { redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json' } });
		if (!response.ok || !response.body) throw new Error('provider');
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let bytes = 0;
		try {
			while (true) {
				const chunk = await reader.read();
				if (chunk.done) break;
				bytes += chunk.value.byteLength;
				if (bytes > MAX_BYTES) {
					controller.abort();
					throw new Error('size');
				}
				chunks.push(chunk.value);
			}
		} finally {
			await reader.cancel().catch(() => {});
			reader.releaseLock();
		}
		const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
		if (!['OK', 'ZERO_RESULTS'].includes(data.status) || !Array.isArray(data.results)) throw new Error('provider');
		const items = data.results.slice(0, 5).flatMap((item: any) => {
			const location = item?.geometry?.location;
			if (
				typeof item?.formatted_address !== 'string' ||
				typeof item?.place_id !== 'string' ||
				!Number.isFinite(location?.lat) ||
				!Number.isFinite(location?.lng)
			)
				return [];
			return [
				{ address: item.formatted_address.slice(0, 1000), placeId: item.place_id.slice(0, 300), latitude: location.lat, longitude: location.lng }
			];
		});
		return { provider: request.provider, attribution: 'Google Maps', items, empty: items.length === 0 };
	} catch {
		// Never forward upstream error bodies or URL-bearing fetch exceptions.
		throw new Error('Google Maps lookup failed. Check the Vault key, Geocoding API access and quota, then retry.');
	} finally {
		clearTimeout(timeout);
	}
}
