// Shared execution policy for explicitly selected AI connections. Credentials
// and provider payloads never enter the public attempt trace.
export type AiAttempt = { connectionId: string; outcome: 'succeeded' | 'unavailable'; status?: number };

export class AiTransportFailure extends Error {
	constructor(public readonly status?: number) {
		super(status ? `The selected AI provider rejected the request (${status}).` : 'The selected AI provider could not be reached.');
		this.name = 'AiTransportFailure';
	}
}

export class AiWaterfallFailure extends Error {
	constructor(public readonly attempts: AiAttempt[]) {
		super('The selected AI connections are unavailable. Check their status and allowance.');
		this.name = 'AiWaterfallFailure';
	}
}

export const AI_CONNECTION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/;
export const parseAiConnectionIds = (value: unknown): string[] => {
	if (!Array.isArray(value) || value.length < 1 || value.length > 4 ||
		value.some((id) => typeof id !== 'string' || !AI_CONNECTION_ID.test(id)) || new Set(value).size !== value.length)
		throw new TypeError('Choose one to four distinct AI connections.');
	return [...value];
};

export const canFallbackAiProvider = (error: unknown): boolean =>
	error instanceof AiTransportFailure && (error.status === undefined || [401, 403, 408, 429, 500, 502, 503, 504, 529].includes(error.status));

export const runAiProviderWaterfall = async <T>(options: {
	connectionIds: readonly string[];
	signal?: AbortSignal;
	// Consent/ownership failures must never be treated as provider downtime.
	beforeAttempt: (connectionId: string) => Promise<void>;
	attempt: (connectionId: string, signal: AbortSignal) => Promise<T>;
}): Promise<{ value: T; connectionId: string; attempts: AiAttempt[] }> => {
	const ids = parseAiConnectionIds(options.connectionIds);
	const attempts: AiAttempt[] = [];
	const deadline = Date.now() + 80_000;
	for (const connectionId of ids) {
		options.signal?.throwIfAborted();
		await options.beforeAttempt(connectionId);
		options.signal?.throwIfAborted();
		const remaining = deadline - Date.now();
		if (remaining <= 0) break;
		const timeout = AbortSignal.timeout(Math.min(20_000, remaining));
		const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
		try {
			const value = await options.attempt(connectionId, signal);
			signal.throwIfAborted();
			attempts.push({ connectionId, outcome: 'succeeded' });
			return { value, connectionId, attempts };
		} catch (error) {
			options.signal?.throwIfAborted();
			const failure = timeout.aborted ? new AiTransportFailure(408) : error;
			if (!canFallbackAiProvider(failure)) throw failure;
			attempts.push({ connectionId, outcome: 'unavailable', ...(failure instanceof AiTransportFailure && failure.status ? { status: failure.status } : {}) });
		}
	}
	throw new AiWaterfallFailure(attempts);
};
