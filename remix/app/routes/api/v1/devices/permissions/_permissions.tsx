import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { setDevicePermissionMode } from '~/api/utils/devices/devices';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	if (user.accountKind !== 'user') return json({ ok: false, error: 'Device permissions require a full Thingtime account' }, { status: 403 });
	const limit = await enforceRateLimit(request, 'devices.permissions', `user:${user.id}`);
	if (!limit.allowed) return json({ ok: false, error: 'Device permission changes are moving too quickly' }, rateLimitedResponseInit(limit));
	const result = await setDevicePermissionMode(user.id, await readJsonBody(request, 8 * 1024));
	if (result.ok === false) return json(result, { status: result.status });
	return json(result);
};
