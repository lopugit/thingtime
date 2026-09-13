export class ModerationRequestError extends Error {
	constructor(readonly status: number, readonly code: string) {
		super(`Moderation provider unavailable (${status}; ${code})`);
	}
}

// Share the same bounded retry policy between text and image review. Never
// return a clear verdict when the provider is unavailable, or log its body.
export const requestOmniModeration = async (
	url: string,
	init: RequestInit,
	fetchImpl: typeof fetch = fetch,
	pause: (ms: number) => Promise<void> = (ms) => new Promise(resolve => setTimeout(resolve, ms))
): Promise<unknown> => {
	for (let attempt = 0; attempt < 2; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 8_000);
		let response: Response;
		let payload: any;
		try {
			response = await fetchImpl(url, { ...init, signal: controller.signal });
			payload = await response.json().catch(() => null);
		} finally { clearTimeout(timer); }
		if (response.ok) return payload;
		const rawCode = payload?.error?.code;
		const code = ['rate_limit_exceeded', 'insufficient_quota', 'invalid_api_key', 'model_not_found'].includes(rawCode) ? rawCode : 'provider_error';
		const retryAfter = response.headers.get('retry-after');
		const delay = retryAfter == null ? 1_000 : Number(retryAfter) * 1_000;
		if (attempt === 0 && code !== 'insufficient_quota' && [429, 500, 502, 503, 504].includes(response.status) && Number.isFinite(delay) && delay >= 0 && delay <= 2_000) {
			await pause(Math.max(delay, 250));
			continue;
		}
		throw new ModerationRequestError(response.status, code);
	}
	throw new Error('Moderation provider unavailable');
};
