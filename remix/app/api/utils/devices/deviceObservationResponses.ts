import { json } from '~/api/http';
import { StorageMutationError } from '../storage/storageCore';
import { DeviceObservationFailure } from './deviceObservations';
export const observationHeaders = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' };
export const observationResponse = async (work: () => Promise<unknown>) => {
	try {
		return json(await work(), { headers: observationHeaders });
	} catch (error) {
		if (error instanceof Response) {
			for (const [key, value] of Object.entries(observationHeaders)) error.headers.set(key, value);
			return error;
		}
		// Preserve canonical admission refusals at this private boundary. The original
		// operation remains authoritative; this metadata never retries a mutation.
		if (error instanceof StorageMutationError)
			return json(
				{ ok: false, error: error.message, code: error.code, retryable: error.status === 503 && error.code === 'accounting_unavailable' },
				{ status: error.status, headers: observationHeaders }
			);
		if (error instanceof DeviceObservationFailure)
			return json({ ok: false, error: error.message, code: error.code }, { status: error.status, headers: observationHeaders });
		throw error;
	}
};
