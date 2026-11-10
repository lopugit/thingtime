import { getHomeThingsCollection, getSessionsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { revokedSessionPipeline } from '../auth/sessions';
import { deviceFail, type DeviceFail } from './deviceCore';

/** Disconnect only this owner's paired credential family; keep Things and files. */
export const disconnectDevice = async (ownerId: string, input: unknown): Promise<DeviceFail | { ok: true; deviceId: string; disconnected: true }> => {
	if (
		!input ||
		typeof input !== 'object' ||
		Array.isArray(input) ||
		Object.keys(input).length !== 1 ||
		!Object.prototype.hasOwnProperty.call(input, 'deviceId')
	) {
		return deviceFail(400, 'An exact deviceId request is required');
	}
	const deviceId = (input as { deviceId: unknown }).deviceId;
	if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 160 || deviceId !== deviceId.trim())
		return deviceFail(400, 'deviceId is required');
	return withHomeMongoTransaction(async (session) => {
		const things = await getHomeThingsCollection();
		const device = await things.findOne({ shareId: deviceId, ownerId, thingtime: 'device' } as any, { session, projection: { _id: 1 } });
		if (!device) return deviceFail(404, 'Device not found');
		await (
			await getSessionsCollection()
		).updateMany({ userId: ownerId, purpose: 'device', 'meta.deviceId': deviceId, revokedAt: null }, revokedSessionPipeline(new Date()), { session });
		return { ok: true, deviceId, disconnected: true } as const;
	});
};
