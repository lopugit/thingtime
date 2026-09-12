/** Retry only the idempotent root read, never login or another mutation. */
export class RootDataUnavailableError extends Error {
	constructor() {
		super('Could not refresh the current session');
		this.name = 'RootDataUnavailableError';
	}
}

export const fetchRootData = async <T>(
	url: string,
	signal: AbortSignal,
	fetcher: typeof fetch = fetch,
	options = { timeoutMs: 10_000, retryDelayMs: 250 }
): Promise<T> => {
	for (let attempt = 0; attempt < 2; attempt++) {
		signal.throwIfAborted();
		const controller = new AbortController();
		const abort = () => controller.abort(signal.reason);
		signal.addEventListener('abort', abort, { once: true });
		const timer = setTimeout(() => controller.abort(), options.timeoutMs);
		let retry = false;
		try {
			const response = await fetcher(url, {
				signal: controller.signal,
				credentials: 'include',
				cache: 'no-store',
				headers: { Accept: 'application/json' }
			});
			signal.throwIfAborted();
			if (response.ok) {
				const data = (await response.json()) as T;
				signal.throwIfAborted();
				controller.signal.throwIfAborted();
				return data;
			}
			retry = [408, 502, 503, 504].includes(response.status);
			await response.body?.cancel();
			if (!retry) throw new RootDataUnavailableError();
		} catch (error) {
			signal.throwIfAborted();
			// Browser network failures and our own timeout can be transient. Bad
			// JSON and HTTP permission/validation failures are not retried.
			retry = error instanceof TypeError || controller.signal.aborted;
			if (!retry) throw new RootDataUnavailableError();
		} finally {
			clearTimeout(timer);
			signal.removeEventListener('abort', abort);
		}
		if (!retry || attempt === 1) throw new RootDataUnavailableError();
		await new Promise<void>((resolve, reject) => {
			const aborted = () => {
				clearTimeout(delay);
				signal.removeEventListener('abort', aborted);
				reject(signal.reason);
			};
			const delay = setTimeout(() => {
				signal.removeEventListener('abort', aborted);
				resolve();
			}, options.retryDelayMs);
			signal.addEventListener('abort', aborted, { once: true });
			if (signal.aborted) aborted();
		});
	}
	throw new RootDataUnavailableError();
};
