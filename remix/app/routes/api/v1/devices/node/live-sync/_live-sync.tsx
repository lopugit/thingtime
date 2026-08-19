import { json, readJsonBody } from '~/api/http';
import { resolveDeviceActor } from '~/api/utils/devices/deviceAuth';
import { syncDeviceLiveAi, type DeviceLiveConnectorContext } from '~/api/utils/devices/deviceLiveAi';
import { deviceLiveProviderForConnectorKind } from '~/api/utils/devices/deviceLiveAiCore';
import { DEVICE_CONNECTOR_FRESHNESS_MS, deviceConnectorIsFresh } from '~/api/utils/devices/devices';
import { getHomeThingsCollection } from '~/api/utils/mongodb/collections';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
	const actor = await resolveDeviceActor(request);
	if (!actor) return json({ ok: false, error: 'Unauthorized device credential' }, { status: 401 });
	if (request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
		return json({ ok: false, error: 'Content-Type must be application/json' }, { status: 415 });
	}
	const limit = await enforceRateLimit(request, 'devices.liveSync', `device:${actor.sessionId}`);
	if (!limit.allowed) return json({ ok: false, error: 'Device live sync is moving too quickly' }, rateLimitedResponseInit(limit));
	const body = await readJsonBody(request, 768 * 1024);
	const connectorId = typeof body?.connectorId === 'string' ? body.connectorId.trim().slice(0, 80) : '';
	if (!connectorId) return json({ ok: false, error: 'connectorId is required' }, { status: 400 });
	const things = await getHomeThingsCollection();
	const [connectorDoc, stateDoc] = await Promise.all([
		things.findOne({
			thingtime: 'device-connector',
			ownerId: actor.userId,
			targetId: actor.deviceId,
			'crystal.connector.id': connectorId,
			'crystal.connector.status': { $in: ['connected', 'degraded'] },
			updatedAt: { $gt: new Date(Date.now() - DEVICE_CONNECTOR_FRESHNESS_MS) }
		} as any),
		things.findOne(
			{
				thingtime: 'device-state',
				ownerId: actor.userId,
				targetId: actor.deviceId
			} as any,
			{ projection: { 'crystal.revision': 1 } }
		)
	]);
	const connectorValue = connectorDoc?.crystal?.connector;
	const provider = deviceLiveProviderForConnectorKind(connectorValue?.kind);
	if (
		!connectorDoc ||
		!provider ||
		!deviceConnectorIsFresh(connectorDoc) ||
		typeof connectorDoc.crystal?.connectorHash !== 'string' ||
		!Number.isSafeInteger(stateDoc?.crystal?.revision) ||
		stateDoc.crystal.revision !== connectorDoc.crystal?.revision
	) {
		return json({ ok: false, error: 'That supported AI connector is not active on this device' }, { status: 409 });
	}
	const connector: DeviceLiveConnectorContext = {
		connectorId,
		revision: Number(connectorDoc.crystal.revision),
		connectorHash: String(connectorDoc.crystal.connectorHash),
		provider,
		label: typeof connectorValue.label === 'string' ? connectorValue.label.trim().slice(0, 80) || 'AI desktop' : 'AI desktop',
		capabilities: Array.isArray(connectorValue.capabilities)
			? connectorValue.capabilities.filter((entry: unknown): entry is string => typeof entry === 'string').slice(0, 64)
			: []
	};
	const result = await syncDeviceLiveAi(actor.userId, actor.deviceId, connector, body);
	if (result.ok === false) return json(result, { status: result.status });
	return json(result);
};
