import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { disconnectDevice } from '~/api/utils/devices/disconnectDevice';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' };
export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers });
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers });
	if (user.accountKind !== 'user') return json({ ok: false, error: 'Device connections require a full Thingtime account' }, { status: 403, headers });
	const limit = await enforceRateLimit(request, 'devices.permissions', `user:${user.id}`, { failClosed: true });
	if (!limit.allowed) {
		const init = rateLimitedResponseInit(limit),
			responseHeaders = new Headers(init.headers);
		for (const [name, value] of Object.entries(headers)) responseHeaders.set(name, value);
		return json({ ok: false, error: 'Device connection changes are moving too quickly' }, { ...init, headers: responseHeaders });
	}
	const result = await disconnectDevice(user.id, await readJsonBody(request, 4 * 1024));
	return json(result, { status: result.ok === false ? result.status : 200, headers });
};
