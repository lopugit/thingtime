import { RecordingFailure, recordingProviderFailure } from './recordingsCore';
import { AiTransportFailure, AiWaterfallFailure, runAiProviderWaterfall } from '../ai/providerWaterfall';

export type RecordingStage = 'transcription' | 'analysis';
export const recordingStageSetting = (stage: RecordingStage) => (stage === 'transcription' ? 'transcriptionProviders' : 'analysisProviders');

export const recordingProviderSupports = (provider: string, stage: RecordingStage) =>
	provider === 'openai' || (stage === 'analysis' && provider === 'anthropic');

// No raw provider payloads are retained. Only availability/auth/limit failures
// advance to another explicitly selected connection; malformed requests do not.
export const canFallbackRecordingProvider = (error: unknown) => {
	if (error instanceof RecordingFailure) return error.code === 'provider_auth' || error.code === 'provider_limit';
	if (!error || typeof error !== 'object') return false;
	const status = 'status' in error ? error.status : undefined;
	if ([401, 403, 408, 429, 500, 502, 503, 504, 529].includes(status as number)) return true;
	return 'name' in error && ['APIConnectionError', 'APIConnectionTimeoutError', 'AbortError', 'TimeoutError'].includes(String(error.name));
};

export const runRecordingWaterfall = async <T>(options: {
	ids: readonly string[];
	stage: RecordingStage;
	// Runs outside the provider catch so revoked consent always stops, rather
	// than being mistaken for a reason to send private content elsewhere.
	beforeAttempt: (id: string) => Promise<void>;
	attempt: (id: string, signal: AbortSignal) => Promise<T>;
}) => {
	const ids = [...new Set(options.ids)].slice(0, 4);
	let last: unknown = new RecordingFailure(options.stage);
	if (!ids.length) throw last;
	try {
		return (await runAiProviderWaterfall({
			connectionIds: ids,
			beforeAttempt: options.beforeAttempt,
			attempt: async (id, signal) => {
				try { return await options.attempt(id, signal); }
				catch (error) {
					last = error instanceof RecordingFailure ? error : recordingProviderFailure(error, options.stage);
					if (!canFallbackRecordingProvider(error)) throw last;
					const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
					throw new AiTransportFailure(status);
				}
			}
		})).value;
	} catch (error) {
		if (error instanceof AiWaterfallFailure) throw last;
		throw error;
	}
};
