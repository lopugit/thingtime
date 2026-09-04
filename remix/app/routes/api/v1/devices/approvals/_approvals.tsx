import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { decideDeviceApproval, listDeviceApprovals } from '~/api/utils/devices/deviceCommands';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

export const loader = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	const params = new URL(request.url).searchParams;
	const result = await listDeviceApprovals(user.id, params.get('deviceId'), params.get('status'));
	if (result.ok === false) return json(result, { status: result.status });
	return json(result);
};

export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	const limit = await enforceRateLimit(request, 'devices.approvals', `user:${user.id}`);
	if (!limit.allowed) return json({ ok: false, error: 'Approval decisions are moving too quickly' }, rateLimitedResponseInit(limit));
	const result = await decideDeviceApproval(user.id, await readJsonBody(request, 16 * 1024));
	if (result.ok === false) return json(result, { status: result.status });
	return json(result);
};
