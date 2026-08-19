import { json } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { createDevicePairingSession } from '~/api/utils/devices/deviceAuth';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	if (user.accountKind !== 'user') return json({ ok: false, error: 'Device pairing requires a full Thingtime account' }, { status: 403 });
	const limit = await enforceRateLimit(request, 'devices.pairing', `user:${user.id}`, { failClosed: true });
	if (!limit.allowed) return json({ ok: false, error: 'Pairing is temporarily unavailable or moving too quickly' }, rateLimitedResponseInit(limit));
	return json({ ok: true, pairing: await createDevicePairingSession(user.id) });
};
