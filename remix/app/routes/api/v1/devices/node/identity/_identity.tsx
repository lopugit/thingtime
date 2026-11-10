import { json } from '~/api/http';
import { resolveDeviceActor } from '~/api/utils/devices/deviceAuth';
import { readDeviceIdentity } from '~/api/utils/devices/devices';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' };
export const loader = async ({ request }: { request: Request }) => {
	if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers });
	const actor = await resolveDeviceActor(request);
	if (!actor) return json({ ok: false, error: 'Unauthorized device credential' }, { status: 401, headers });
	const limit = await enforceRateLimit(request, 'devices.read', `device:${actor.sessionId}`);
	if (!limit.allowed) {
		const init = rateLimitedResponseInit(limit);
		const responseHeaders = new Headers(init.headers);
		for (const [name, value] of Object.entries(headers)) responseHeaders.set(name, value);
		return json({ ok: false, error: 'Device reads are moving too quickly' }, { ...init, headers: responseHeaders });
	}
	const result = await readDeviceIdentity(actor.userId, actor.deviceId);
	return json(result, { status: result.ok === false ? result.status : 200, headers });
};
