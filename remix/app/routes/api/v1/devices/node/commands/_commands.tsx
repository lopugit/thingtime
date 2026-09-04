import { json, readJsonBody } from '~/api/http';
import { resolveDeviceActor } from '~/api/utils/devices/deviceAuth';
import {
	claimNextDeviceCommand,
	heartbeatDeviceCommand,
	listNodeApprovalDecisions,
	reportDeviceCommand,
	requestDeviceApproval
} from '~/api/utils/devices/deviceCommands';
import { updateDeviceScreenSession } from '~/api/utils/devices/deviceScreens';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
	const actor = await resolveDeviceActor(request);
	if (!actor) return json({ ok: false, error: 'Unauthorized device credential' }, { status: 401 });
	const limit = await enforceRateLimit(request, 'devices.node.commands', `device:${actor.sessionId}`);
	if (!limit.allowed) return json({ ok: false, error: 'Device command polling is moving too quickly' }, rateLimitedResponseInit(limit));
	const body = await readJsonBody(request, 96 * 1024);
	let result;
	switch (body?.op) {
		case 'claim':
			result = await claimNextDeviceCommand(actor.userId, actor.deviceId, body.waitMs);
			break;
		case 'heartbeat':
			result = await heartbeatDeviceCommand(actor.userId, actor.deviceId, body);
			break;
		case 'report':
			result = await reportDeviceCommand(actor.userId, actor.deviceId, body);
			break;
		case 'approval-request':
			result = await requestDeviceApproval(actor.userId, actor.deviceId, body);
			break;
		case 'approvals':
			result = await listNodeApprovalDecisions(actor.userId, actor.deviceId);
			break;
		case 'screen-status':
			result = await updateDeviceScreenSession(actor.userId, actor.deviceId, body);
			break;
		default:
			return json({ ok: false, error: 'Unknown node command operation' }, { status: 400 });
	}
	return result.ok ? json(result) : json(result, { status: result.status });
};
