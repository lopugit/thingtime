// Only retry an explicit rejected request. Network/5xx/unknown outcomes must
// keep the existing upload reconciliation path, never blindly replay writes.
const waitForRetry = (milliseconds: number, signal?: AbortSignal): Promise<void> =>
	new Promise((resolve, reject) => {
		const abort = () => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
			reject(new DOMException('Upload cancelled', 'AbortError'));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', abort);
			resolve();
		}, milliseconds);
		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) abort();
	});

export const withAttachmentRateLimitRetry = async <T>(
	request: () => Promise<T>,
	signal?: AbortSignal,
	wait: typeof waitForRetry = waitForRetry
): Promise<T> => {
	for (let attempt = 0; ; attempt += 1) {
		if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
		try {
			return await request();
		} catch (error) {
			const failure = error as { status?: unknown; retryAfterSeconds?: unknown } | null;
			const seconds = failure?.retryAfterSeconds;
			if (attempt >= 2 || failure?.status !== 429 || typeof seconds !== 'number' ||
				!Number.isFinite(seconds) || seconds < 0 || seconds > 60) throw error;
			// Keep the same request closure, IDs and bytes. A removed selection,
			// account switch or unmount aborts the wait along with its request.
			await wait(Math.max(1, Math.ceil(seconds)) * 1000, signal);
		}
	}
};
