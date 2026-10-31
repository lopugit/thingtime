// Never forward Google's free-form message or metadata: either can contain
// credentials, project identifiers, or request details.
export class GooglePlacesError extends Error {
	constructor(public status: number, message: string) {
		super(message);
	}
}
const guidance: Record<string, string> = {
	SERVICE_DISABLED: 'Enable Places API (New) in the Google Cloud project that owns GOOGLE_PLACES_API_KEY.',
	BILLING_DISABLED: 'Enable billing for the Google Cloud project that owns GOOGLE_PLACES_API_KEY.',
	API_KEY_HTTP_REFERRER_BLOCKED:
		'GOOGLE_PLACES_API_KEY has website restrictions. This server-side key must allow Places API (New) server requests; keep website restrictions on your separate Maps JavaScript key.',
	API_KEY_IP_ADDRESS_BLOCKED:
		'The IP restrictions on GOOGLE_PLACES_API_KEY do not allow this server. Check the allowed server addresses in Google Cloud.',
	API_KEY_SERVICE_BLOCKED: 'Allow Places API (New) in the API restrictions for GOOGLE_PLACES_API_KEY.',
	API_KEY_INVALID: 'Replace GOOGLE_PLACES_API_KEY in your Thingtime Vault with a valid Google Places server key.',
	API_KEY_EXPIRED: 'Replace the expired GOOGLE_PLACES_API_KEY in your Thingtime Vault.',
	CONSUMER_INVALID: 'Check the Google Cloud project associated with GOOGLE_PLACES_API_KEY.'
};
function providerError(status: number, data: any) {
	const reasons = Array.isArray(data?.error?.details) ? data.error.details.map((detail: any) => detail?.reason) : [];
	const reason = reasons.find((value: unknown) => typeof value === 'string' && Object.prototype.hasOwnProperty.call(guidance, value));
	if (reason) return new GooglePlacesError(409, guidance[reason]);
	if (status === 429) return new GooglePlacesError(429, 'Google Places quota is exhausted. Check your Google Cloud quota or try again later.');
	if (status === 401 || status === 403)
		return new GooglePlacesError(
			409,
			'Google Places rejected the server key. Check Places API (New), billing, and the API and application restrictions for GOOGLE_PLACES_API_KEY.'
		);
	if (status === 400) return new GooglePlacesError(422, 'Google Places could not accept this lookup. Try a different address or refresh the page.');
	return new GooglePlacesError(502, 'Google Places is temporarily unavailable. Try again shortly.');
}
export async function requestGooglePlaces(key: string, path: string, fields: string, body?: unknown) {
	try {
		const response = await fetch(`https://places.googleapis.com/v1/${path}`, {
			method: body ? 'POST' : 'GET',
			redirect: 'error',
			signal: AbortSignal.timeout(8000),
			headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fields },
			...(body ? { body: JSON.stringify(body) } : {})
		});
		const reader = response.body?.getReader();
		if (!reader) throw providerError(response.status, null);
		const chunks: Uint8Array[] = [];
		let size = 0;
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			size += next.value.length;
			if (size > 128 * 1024) {
				await reader.cancel();
				throw new Error('Response too large');
			}
			chunks.push(next.value);
		}
		let data: any;
		try {
			data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
		} catch {
			throw providerError(response.status, null);
		}
		if (!response.ok) throw providerError(response.status, data);
		return data;
	} catch (error) {
		if (error instanceof GooglePlacesError) throw error;
		throw new GooglePlacesError(502, 'Google Places could not be reached. Try again shortly.');
	}
}
