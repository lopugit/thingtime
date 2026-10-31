import { AiTransportFailure, AiWaterfallFailure, canFallbackAiProvider } from './providerWaterfall';
import { parseAiWaterfallConfig, type AiWaterfallEntry } from './waterfallConfig';

export const executeAiWaterfall = async <T>(options: {
	config: unknown;
	startIndex?: number;
	signal?: AbortSignal;
	authorize: (entry: AiWaterfallEntry) => Promise<void>;
	attempt: (entry: AiWaterfallEntry, signal: AbortSignal) => Promise<T>;
}) => {
	const config = parseAiWaterfallConfig(options.config);
	const start = options.startIndex ?? 0;
	if (!Number.isInteger(start) || start < 0 || start >= config.entries.length) throw new TypeError('Invalid waterfall position.');
	// Validate all ownership/consent before delivering any source content.
	for (const entry of config.entries) await options.authorize(entry);
	const attempts: Array<{ connectionId: string; outcome: 'unavailable'; status?: number }> = [];
	for (let index = start; index < config.entries.length; index++) {
		options.signal?.throwIfAborted();
		const entry = config.entries[index];
		await options.authorize(entry);
		const timeout = AbortSignal.timeout(90_000);
		const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
		try {
			const value = await options.attempt(entry, signal);
			signal.throwIfAborted();
			return { value, index, entry, attempts };
		} catch (error) {
			options.signal?.throwIfAborted();
			const failure = timeout.aborted ? new AiTransportFailure(408) : error;
			if (!canFallbackAiProvider(failure) && !(failure instanceof AiTransportFailure && failure.status === 404)) throw failure;
			attempts.push({
				connectionId: entry.endpointId,
				outcome: 'unavailable',
				...(failure instanceof AiTransportFailure && failure.status ? { status: failure.status } : {})
			});
		}
	}
	throw new AiWaterfallFailure(attempts);
};
