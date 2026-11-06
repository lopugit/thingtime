import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { createDeviceAlert, readDeviceAlert } from '~/api/utils/devices/deviceAlerts';
import { observationResponse } from '~/api/utils/devices/deviceObservationResponses';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
const handle = async ({ request }: { request: Request }) =>
	observationResponse(async () => {
		if (!['GET', 'POST'].includes(request.method)) throw json({ ok: false, error: 'Method not allowed' }, { status: 405 });
		const user = await getCurrentUser(request);
		if (!user) throw json({ ok: false, error: 'Unauthorized' }, { status: 401 });
		if (user.accountKind !== 'user' || user.temporary) throw json({ ok: false, error: 'A full owning account is required' }, { status: 403 });
		const expected = request.headers.get('X-Thingtime-Expected-Actor');
		if ((request.method === 'POST' || expected) && expected !== user.id)
			throw json({ ok: false, error: 'The active account changed' }, { status: 409 });
		const limit = await enforceRateLimit(request, 'devices.commands', `user:${user.id}`, { failClosed: true });
		if (!limit.allowed) throw json({ ok: false, error: 'Device actions are moving too quickly' }, rateLimitedResponseInit(limit));
		if (request.method === 'GET') {
			const q = new URL(request.url).searchParams;
			return readDeviceAlert(user.id, q.get('deviceId') || '', q.get('requestId') || '');
		}
		const origin = request.headers.get('Origin');
		if ((origin && origin !== resolvePublicOrigin(request).origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site')
			throw json({ ok: false, error: 'Use the same Thingtime origin' }, { status: 403 });
		const unsupported = requireJsonContentType(request);
		if (unsupported) throw unsupported;
		return createDeviceAlert(user.id, await readJsonBody(request, 128 * 1024));
	});
export const loader = handle;
export const action = handle;
