import { scheduledJobSecret } from '~/api/utils/automation/scheduledJobSecret';
import { recordScheduledPassResult } from '~/api/utils/automation/scheduledRunContext';
import { timingSafeEqual } from 'node:crypto';
import { json } from '~/api/http';
import { deviceObservations } from '~/api/utils/devices/deviceObservations';
import { observationResponse, observationHeaders } from '~/api/utils/devices/deviceObservationResponses';
export const createObservationCleanupLoader =
	(deps = { secret: () => scheduledJobSecret(), sweep: deviceObservations.sweep }) =>
	async ({ request }: { request: Request }) =>
		observationResponse(async () => {
			if (request.method !== 'GET') throw json({ ok: false, error: 'Method not allowed' }, { status: 405 });
			const secret = deps.secret();
			if (!secret) throw json({ ok: false, error: 'Observation cleanup is not configured' }, { status: 503 });
			const given = Buffer.from(request.headers.get('Authorization') || '');
			const expected = Buffer.from(`Bearer ${secret}`);
			if (given.length !== expected.length || !timingSafeEqual(given, expected))
				throw json({ ok: false, error: 'Unauthorized scheduler' }, { status: 401 });
      const result=await deps.sweep();recordScheduledPassResult('/api/v1/devices/observations/cleanup',result);return result;
		});
export const loader = createObservationCleanupLoader();
export const action = async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: observationHeaders });
