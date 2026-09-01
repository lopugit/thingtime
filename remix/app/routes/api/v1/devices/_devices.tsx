import { json } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { listDevices } from '~/api/utils/devices/devices';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

export const loader = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	if (user.accountKind !== 'user') return json({ ok: false, error: 'Devices require a full Thingtime account' }, { status: 403 });
	const limit = await enforceRateLimit(request, 'devices.read', `user:${user.id}`);
	if (!limit.allowed) return json({ ok: false, error: 'Device reads are moving too quickly' }, rateLimitedResponseInit(limit));
	const deviceId = new URL(request.url).searchParams.get('id');
	const result = await listDevices(user.id, deviceId);
	if (result.ok === false) return json(result, { status: result.status });
	return json(result);
};
