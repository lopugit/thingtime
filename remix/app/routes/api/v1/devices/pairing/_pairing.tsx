import { json } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { createDevicePairingSession } from '~/api/utils/devices/deviceAuth';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

export const action = async ({ request }: { request: Request }) => {
	const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' };
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers });
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers });
	if (user.accountKind !== 'user') return json({ ok: false, error: 'Device pairing requires a full Thingtime account' }, { status: 403, headers });
	const limit = await enforceRateLimit(request, 'devices.pairing', `user:${user.id}`, { failClosed: true });
	if (!limit.allowed) {
		const init = rateLimitedResponseInit(limit);
		const limitedHeaders = new Headers(init.headers);
		for (const [key, value] of Object.entries(headers)) limitedHeaders.set(key, value);
		return json({ ok: false, error: 'Pairing is temporarily unavailable or moving too quickly' }, { ...init, headers: limitedHeaders });
	}
	return json({ ok: true, ownerId: user.id, pairing: await createDevicePairingSession(user.id) }, { headers });
};
