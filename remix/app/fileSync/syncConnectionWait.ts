/** Only transport failures are eligible for automatic retry. HTTP, ACL,
 * fingerprint and protocol failures still require review. Durable operation
 * receipts determine whether a lost response is replayed or already complete. */
export class SyncConnectionWait extends Error {}
export function isSyncConnectionFailure(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	if (error.name === 'TimeoutError') return true;
	if (error.name === 'TypeError' && /^(failed to fetch|fetch failed|load failed|networkerror(?:\b|:))/i.test(error.message)) return true;
	return /^(?:network (?:request|connection) (?:failed|lost|unavailable)|connection (?:lost|closed)|the network connection was lost)\.?$/i.test(error.message);
}
