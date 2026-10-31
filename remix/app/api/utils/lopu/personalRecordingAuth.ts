import type { DeviceActor } from '../devices/deviceAuth';
import { getHomeThingsCollection, getSessionsCollection } from '../mongodb/collections';
import { PERSONAL_RECORDING_CAPABILITY, personalRecordingLeaseIsLive } from './personalRecordingCore';
import { RECORDING_JOB_KIND, RECORDING_SETTINGS_KIND } from './recordingsCore';
import { recordingId, recordingSource } from './recordingsStore';

export class PersonalRecordingUnavailable extends Error {
	constructor() { super('The selected recording device, consent or lease is no longer available.'); }
}

// Reads authenticate immediately before disclosure. Transactional writes touch
// every authority record to serialize against revocation, removal and opt-out.
// The session id is the already resolved paired-session id, never a body field.
export const createPersonalRecordingAuthority = (storage: {
	things: typeof getHomeThingsCollection; sessions: typeof getSessionsCollection;
}) => async (actor: DeviceActor, session?: any) => {
	if (![actor.userId, actor.deviceId, actor.sessionId].every((id) => typeof id === 'string' && id.length > 0) ||
		!Array.isArray(actor.capabilities) || !actor.capabilities.includes(PERSONAL_RECORDING_CAPABILITY))
		throw new PersonalRecordingUnavailable();
	const now = new Date();
	const things = await storage.things();
	const sessions = await storage.sessions();
	const authorities = [
		{ collection: sessions, filter: {
			jti: actor.sessionId, userId: actor.userId, purpose: 'device', revokedAt: null,
			'meta.deviceId': actor.deviceId, 'meta.capabilities': PERSONAL_RECORDING_CAPABILITY,
			$or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
		} },
		{ collection: things, filter: {
			shareId: actor.deviceId, ownerId: actor.userId, thingtime: 'device', deletedAt: null
		} },
		{ collection: things, filter: {
			shareId: recordingId('settings', actor.userId), ownerId: actor.userId, thingtime: RECORDING_SETTINGS_KIND,
			'crystal.enabled': true, 'crystal.runtimeDeviceId': actor.deviceId
		} }
	];
	// Sequential: Mongo transactions do not support concurrent driver operations.
	for (const { collection, filter } of authorities) {
		const allowed = session
			? (await collection.updateOne(filter, { $inc: { recordingWriteFence: 1 } }, { session })).matchedCount
			: await collection.findOne(filter, { projection: { _id: 1 } });
		if (!allowed) throw new PersonalRecordingUnavailable();
	}
};

export const assertPersonalRecordingAuthority = createPersonalRecordingAuthority({
	things: getHomeThingsCollection, sessions: getSessionsCollection
});

export const personalRecordingActorForJob = (job: any): DeviceActor => ({
	userId: job.ownerId, deviceId: job.runtimeDeviceId, sessionId: job.runtimeSessionId,
	capabilities: [PERSONAL_RECORDING_CAPABILITY]
});

export const assertPersonalRecordingJob = async (job: any, session?: any) => {
	if (!job.runtimeDeviceId) return;
	await assertPersonalRecordingAuthority(personalRecordingActorForJob(job), session);
	const current = await (await getHomeThingsCollection()).findOne({
		shareId: job.shareId, ownerId: job.ownerId, thingtime: RECORDING_JOB_KIND,
		runtimeDeviceId: job.runtimeDeviceId, runtimeSessionId: job.runtimeSessionId, lease: job.lease
	}, { session });
	if (!current || !personalRecordingLeaseIsLive(current, job.lease, new Date())) throw new PersonalRecordingUnavailable();
	const source = await recordingSource(current, session);
	if (!source) throw new PersonalRecordingUnavailable();
	if (session) {
		const things = await getHomeThingsCollection();
		for (const doc of [source.post, source.attachment])
			await things.updateOne({ _id: doc._id }, { $inc: { recordingWriteFence: 1 } }, { session });
	}
};
