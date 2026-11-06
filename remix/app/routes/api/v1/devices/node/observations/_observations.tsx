import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { resolveDeviceActor } from '~/api/utils/devices/deviceAuth';
import { deviceObservations } from '~/api/utils/devices/deviceObservations';
import { observationResponse } from '~/api/utils/devices/deviceObservationResponses';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
const handle = async ({ request }: { request: Request }) =>
	observationResponse(async () => {
		if (!['GET', 'POST'].includes(request.method)) throw json({ ok: false, error: 'Method not allowed' }, { status: 405 });
		const actor = await resolveDeviceActor(request);
		if (!actor) throw json({ ok: false, error: 'Unauthorized device credential' }, { status: 401 });
		const limit = await enforceRateLimit(request, request.method === 'POST' ? 'devices.state' : 'devices.read', `device:${actor.sessionId}`, {
			failClosed: true
		});
		if (!limit.allowed) throw json({ ok: false, error: 'Device observations are moving too quickly' }, rateLimitedResponseInit(limit));
		if (request.method === 'GET') return deviceObservations.nodeSettings(actor);
		const unsupported = requireJsonContentType(request);
		if (unsupported) throw unsupported;
		return deviceObservations.record(actor, await readJsonBody(request, 64 * 1024));
	});
export const action = handle;
export const loader = handle;
