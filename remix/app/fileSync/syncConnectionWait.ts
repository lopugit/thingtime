/** Temporary transport/HTTP failures may resume with their original operation
 * receipts. Authority, fingerprint and protocol failures require review. */
export const SYNC_RETRY_DELAY_MS = 30_000;
export const SYNC_RETRY_MAX_MS = 300_000;
export class SyncConnectionWait extends Error {
	constructor(message: string, readonly retryAfterMs = SYNC_RETRY_DELAY_MS) {
		super(message);
	}
}
/** A bounded scheduling hint only. Never retain response bodies, URLs or headers. */
export function cloudSyncHttpError(status: number, retryAfter: string | null = null, now = Date.now()): Error {
	const message = `Cloud sync request failed (${status}); retain this run for retry or reconciliation.`;
	if (status !== 408 && status !== 429 && !(status >= 500 && status <= 599)) return Error(message);
	let delay = SYNC_RETRY_DELAY_MS;
	if (retryAfter && retryAfter.length <= 128) {
		const requested = /^[0-9]+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now;
		if (!Number.isNaN(requested)) delay = Math.max(SYNC_RETRY_DELAY_MS, Math.min(SYNC_RETRY_MAX_MS, requested));
	}
	return new SyncConnectionWait(message, delay);
}
export function isSyncConnectionFailure(error: unknown): boolean {
	if (error instanceof SyncConnectionWait) return true;
	if (!(error instanceof Error)) return false;
	if (error.name === 'TimeoutError') return true;
	if (error.name === 'TypeError' && /^(failed to fetch|fetch failed|load failed|networkerror(?:\b|:))/i.test(error.message)) return true;
	return /^(?:network (?:request|connection) (?:failed|lost|unavailable)|connection (?:lost|closed)|the network connection was lost)\.?$/i.test(
		error.message
	);
}
