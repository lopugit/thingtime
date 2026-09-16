import { recordErrorLog, type ErrorLogContext } from '../errors/errorLogs';

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
	pause: (ms: number) => Promise<void> = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  log: (error: unknown, fields: ErrorLogContext) => Promise<unknown> = recordErrorLog
): Promise<unknown> => {
	for (let attempt = 0; attempt < 2; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 8_000);
		let response: Response;
		let payload: any;
		try {
			response = await fetchImpl(url, { ...init, signal: controller.signal });
			payload = await response.json().catch(() => null);
		} catch (error) {
      await log(error, { source: 'moderation', provider: 'openai', code: controller.signal.aborted ? 'timeout' : 'network_error', attempt: attempt + 1 });
      throw error;
    } finally { clearTimeout(timer); }
		if (response.ok) return payload;
		const rawCode = payload?.error?.code ?? payload?.error?.type;
		const code = ['rate_limit_exceeded', 'insufficient_quota', 'invalid_api_key', 'model_not_found'].includes(rawCode) ? rawCode : 'provider_error';
		const retryAfter = response.headers.get('retry-after');
    // The upstream message belongs only in the redacted admin log. Keep the
    // thrown/public error unchanged and never serialize init or the full body.
    const reason = typeof payload?.error?.message === 'string' ? payload.error.message : 'Provider returned no JSON error message';
    await log(new Error(reason), { source: 'moderation', provider: 'openai', status: response.status,
      code: typeof rawCode === 'string' ? rawCode : 'provider_error', providerType: typeof payload?.error?.type === 'string' ? payload.error.type : undefined,
      providerRequestId: response.headers.get('x-request-id') || undefined, retryAfter: retryAfter || undefined, attempt: attempt + 1 });
		const delay = retryAfter == null ? 1_000 : Number(retryAfter) * 1_000;
		if (attempt === 0 && code !== 'insufficient_quota' && [429, 500, 502, 503, 504].includes(response.status) && Number.isFinite(delay) && delay >= 0 && delay <= 2_000) {
			await pause(Math.max(delay, 250));
			continue;
		}
		throw new ModerationRequestError(response.status, code);
	}
	throw new Error('Moderation provider unavailable');
};
