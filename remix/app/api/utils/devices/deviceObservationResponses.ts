import { json } from '~/api/http';
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
		if (error instanceof DeviceObservationFailure)
			return json({ ok: false, error: error.message, code: error.code }, { status: error.status, headers: observationHeaders });
		throw error;
	}
};
