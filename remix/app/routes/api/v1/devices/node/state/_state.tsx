import { json, readJsonBody } from '~/api/http';
import { resolveDeviceActor } from '~/api/utils/devices/deviceAuth';
import { updateDeviceState } from '~/api/utils/devices/devices';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
	const actor = await resolveDeviceActor(request);
	if (!actor) return json({ ok: false, error: 'Unauthorized device credential' }, { status: 401 });
	const limit = await enforceRateLimit(request, 'devices.state', `device:${actor.sessionId}`);
	if (!limit.allowed) return json({ ok: false, error: 'Device state is updating too quickly' }, rateLimitedResponseInit(limit));
	const result = await updateDeviceState(actor.userId, actor.deviceId, await readJsonBody(request, 256 * 1024));
	if (result.ok === false) return json(result, { status: result.status });
	return json(result);
};
