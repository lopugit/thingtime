import { json } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { deviceObservations } from '~/api/utils/devices/deviceObservations';
import { observationResponse, observationHeaders } from '~/api/utils/devices/deviceObservationResponses';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
export const loader = async ({ request }: { request: Request }) =>
	observationResponse(async () => {
		if (request.method !== 'GET') throw json({ ok: false, error: 'Method not allowed' }, { status: 405 });
		const user = await getCurrentUser(request);
		if (!user) throw json({ ok: false, error: 'Unauthorized' }, { status: 401 });
		if (user.accountKind !== 'user' || user.temporary) throw json({ ok: false, error: 'A full owning account is required' }, { status: 403 });
		const expected = request.headers.get('X-Thingtime-Expected-Actor');
		if (expected && expected !== user.id) throw json({ ok: false, error: 'The active account changed' }, { status: 409 });
		const limit = await enforceRateLimit(request, 'devices.read', `user:${user.id}`, { failClosed: true });
		if (!limit.allowed) throw json({ ok: false, error: 'Device reads are moving too quickly' }, rateLimitedResponseInit(limit));
		const q = new URL(request.url).searchParams;
		return deviceObservations.read(user.id, {
			deviceId: q.get('deviceId'),
			type: q.get('type'),
			from: q.get('from'),
			to: q.get('to'),
			limit: q.get('limit'),
			cursor: q.get('cursor')
		});
	});
export const action = async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: observationHeaders });
