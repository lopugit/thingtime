import { getHomeThingsCollection, getSessionsCollection } from '../mongodb/collections';
import { PERSONAL_RECORDING_CAPABILITY } from './personalRecordingCore';

export type PersonalRecordingDevice = { id: string; name: string; online: boolean; lastSeenAt: string | null };

// Two bounded, owner-scoped reads; never enumerate credentials or hydrate the
// full device dashboard (connectors, commands, chat imports, etc.) for this menu.
export const listPersonalRecordingDevices = async (ownerId: string): Promise<PersonalRecordingDevice[]> => {
	const things = await getHomeThingsCollection();
	const devices = await things.find({ ownerId, thingtime: 'device', deletedAt: null }, {
		projection: { shareId: 1, 'crystal.name': 1 }
	}).sort({ updatedAt: -1, shareId: 1 }).limit(100).toArray();
	if (!devices.length) return [];
	const now = new Date();
	const sessions = await getSessionsCollection();
	const live = await sessions.aggregate([
		{ $match: {
			purpose: 'device', userId: ownerId, revokedAt: null,
			'meta.deviceId': { $in: devices.map((device: any) => device.shareId) },
			'meta.capabilities': PERSONAL_RECORDING_CAPABILITY,
			$or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
		} },
		{ $group: { _id: '$meta.deviceId', lastSeenAt: { $max: '$meta.lastSeenAt' } } },
		{ $limit: 100 }
	]).toArray();
	const byId = new Map(live.map((row: any) => [row._id, row.lastSeenAt]));
	return devices.flatMap((device: any) => {
		if (!byId.has(device.shareId)) return [];
		const lastSeen = byId.get(device.shareId);
		const seen = lastSeen == null ? NaN : new Date(lastSeen as string).getTime();
		const validSeen = Number.isFinite(seen) && seen <= now.getTime();
		return [{ id: String(device.shareId), name: String(device.crystal?.name || 'Personal recording device').slice(0, 120),
			online: validSeen && now.getTime() - seen < 120_000, lastSeenAt: validSeen ? new Date(seen).toISOString() : null }];
	});
};

export const validatePersonalRecordingDevice = async (ownerId: string, deviceId: string | null | undefined) => {
	if (deviceId && !(await listPersonalRecordingDevices(ownerId)).some((device) => device.id === deviceId))
		throw new TypeError('Choose one of your paired personal recording workers.');
};
