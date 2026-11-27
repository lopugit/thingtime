import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { resolveDeviceActor } from '~/api/utils/devices/deviceAuth';
import { recordDevicePreparedSound } from '~/api/utils/devices/deviceAlerts';
import { observationResponse, observationHeaders } from '~/api/utils/devices/deviceObservationResponses';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
export const action = async ({ request }: { request: Request }) =>
	observationResponse(async () => {
		if (request.method !== 'POST') throw json({ ok: false, error: 'Method not allowed' }, { status: 405 });
		const actor = await resolveDeviceActor(request);
		if (!actor) throw json({ ok: false, error: 'Unauthorized device credential' }, { status: 401 });
		const unsupported = requireJsonContentType(request);
		if (unsupported) throw unsupported;
		const limit = await enforceRateLimit(request, 'devices.commands', `device:${actor.sessionId}`, { failClosed: true });
		if (!limit.allowed) throw json({ ok: false, error: 'Device actions are moving too quickly' }, rateLimitedResponseInit(limit));
		return recordDevicePreparedSound(actor, await readJsonBody(request, 16 * 1024));
	});
export const loader = async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: observationHeaders });
