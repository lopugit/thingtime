import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { listDeviceScreenSessions, startDeviceScreenSession, stopDeviceScreenSession } from '~/api/utils/devices/deviceScreens';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

export const loader = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	const result = await listDeviceScreenSessions(user.id, new URL(request.url).searchParams.get('deviceId'));
	if (result.ok === false) return json(result, { status: result.status });
	return json(result);
};

export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	const limit = await enforceRateLimit(request, 'devices.screen', `user:${user.id}`);
	if (!limit.allowed) return json({ ok: false, error: 'Screen-session actions are moving too quickly' }, rateLimitedResponseInit(limit));
	const body = await readJsonBody(request, 16 * 1024);
	const result =
		body?.action === 'start'
			? await startDeviceScreenSession(user.id, body)
			: body?.action === 'stop'
			? await stopDeviceScreenSession(user.id, body)
			: { ok: false as const, status: 400, error: 'action must be start or stop' };
	if (result.ok === false) return json(result, { status: result.status });
	return json(result);
};
