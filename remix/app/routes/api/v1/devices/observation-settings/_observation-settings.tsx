import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { deviceObservations } from '~/api/utils/devices/deviceObservations';
import { observationResponse, observationHeaders } from '~/api/utils/devices/deviceObservationResponses';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
export const action = async ({ request }: { request: Request }) =>
	observationResponse(async () => {
		if (request.method !== 'POST') throw json({ ok: false, error: 'Method not allowed' }, { status: 405 });
		const user = await getCurrentUser(request);
		if (!user) throw json({ ok: false, error: 'Unauthorized' }, { status: 401 });
		if (user.accountKind !== 'user' || user.temporary) throw json({ ok: false, error: 'A full owning account is required' }, { status: 403 });
		if (request.headers.get('X-Thingtime-Expected-Actor') !== user.id)
			throw json({ ok: false, error: 'The active account changed' }, { status: 409 });
		const origin = request.headers.get('Origin');
		if ((origin && origin !== resolvePublicOrigin(request).origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site')
			throw json({ ok: false, error: 'Use the same Thingtime origin to change these settings' }, { status: 403 });
		const unsupported = requireJsonContentType(request);
		if (unsupported) throw unsupported;
		const limit = await enforceRateLimit(request, 'devices.permissions', `user:${user.id}`, { failClosed: true });
		if (!limit.allowed) throw json({ ok: false, error: 'Device settings are moving too quickly' }, rateLimitedResponseInit(limit));
		return deviceObservations.settings(user.id, await readJsonBody(request, 16 * 1024));
	});
export const loader = async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: observationHeaders });
