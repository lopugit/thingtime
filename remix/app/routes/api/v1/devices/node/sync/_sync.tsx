import { json, readJsonBody } from '~/api/http';
import { resolveDeviceActor } from '~/api/utils/devices/deviceAuth';
import { syncAiConnections } from '~/api/utils/messenger/aiConnections';
import { getHomeThingsCollection } from '~/api/utils/mongodb/collections';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
	const actor = await resolveDeviceActor(request);
	if (!actor) return json({ ok: false, error: 'Unauthorized device credential' }, { status: 401 });
	if (request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
		return json({ ok: false, error: 'Content-Type must be application/json' }, { status: 415 });
	}
	const limit = await enforceRateLimit(request, 'devices.sync', `device:${actor.sessionId}`);
	if (!limit.allowed) return json({ ok: false, error: 'Device chat sync is moving too quickly' }, rateLimitedResponseInit(limit));
	const body = await readJsonBody(request, 768 * 1024);
	const connectorId = typeof body?.source?.connector === 'string' ? body.source.connector.trim().slice(0, 80) : '';
	if (!connectorId) return json({ ok: false, error: 'A source connector is required' }, { status: 400 });
	const connector = await (
		await getHomeThingsCollection()
	).findOne({
		thingtime: 'device-connector',
		ownerId: actor.userId,
		targetId: actor.deviceId,
		'crystal.connector.id': connectorId,
		'crystal.connector.status': { $in: ['connected', 'degraded'] }
	} as any);
	if (!connector) return json({ ok: false, error: 'That connector is not active on this device' }, { status: 409 });
	const result = await syncAiConnections(actor.userId, body, { deviceId: actor.deviceId });
	if (result.ok === false) return json(result, { status: result.status });
	return json(result);
};
