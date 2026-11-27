import { randomUUID } from 'node:crypto';
import { getHomeThingsCollection, getSessionsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { insertAccountedThing, updateAccountedThing } from '../storage/accountedThings';
import { thingUniqueKeyFilter } from '../mongodb/uniqueKeys';
import { normalizePushDeviceInput, pushDeviceUpsert, getCanonicalDevicePush } from '../notifications/pushDevices';
import { sendCanonicalDeviceAlert } from '../notifications/apns';
import { createDeviceCommand, publicDeviceCommand, DEVICE_COMMAND_TERMINAL_RETENTION_MS } from './deviceCommands';
import { deviceHash, devicePayloadHash, deviceSupportsCommand, normalizeDevicePermissionMode, decideDeviceLease } from './deviceCore';
import { newDeviceThing } from './devices';
import { DeviceObservationFailure } from './deviceObservations';
import { downloadDeviceMedia, ownedAudio, preparedSoundFilename } from './deviceAlertMedia';
import { alertId, mediaVersion } from './deviceAlertCore';
import type { DeviceActor } from './deviceAuth';
const HOME = { accountedPlane: 'home' as const };
const fail = (status: number, code: string, message: string): never => {
	throw new DeviceObservationFailure(status, code, message);
};
export async function requireActiveAlertActor(actor: DeviceActor, session: any) {
	const now = new Date();
	const found = await (
		await getSessionsCollection()
	).updateOne(
		{
			jti: actor.sessionId,
			userId: actor.userId,
			purpose: 'device',
			'meta.deviceId': actor.deviceId,
			revokedAt: null,
			$or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
		},
		{ $set: { 'meta.alertCheckedAt': now } },
		{ session }
	);
	if (!found.matchedCount) fail(401, 'DEVICE_REVOKED', 'Unauthorized device credential');
	const device = await (
		await getHomeThingsCollection()
	).findOne({ thingtime: 'device', ownerId: actor.userId, shareId: actor.deviceId }, { session });
	if (!device) fail(404, 'DEVICE_NOT_FOUND', 'Device not found');
	return device;
}
export async function registerDeviceAlertPush(actor: DeviceActor, input: any) {
	if (
		!input ||
		Object.keys(input).some((k) => !['token', 'environment', 'topic', 'cacheGeneration', 'enabled'].includes(k)) ||
		!alertId(input.cacheGeneration) ||
		(input.enabled !== undefined && typeof input.enabled !== 'boolean')
	)
		fail(400, 'INVALID_PUSH', 'Invalid device push registration');
	return withHomeMongoTransaction(async (session) => {
		const device = await requireActiveAlertActor(actor, session);
		if (input.enabled === false) {
			if (Object.keys(input).some((k) => !['enabled', 'cacheGeneration'].includes(k)))
				fail(400, 'INVALID_PUSH', 'Deactivation accepts only the current cache identity');
			const things = await getHomeThingsCollection();
			await things.deleteMany(
				{
					thingtime: 'push-device',
					ownerId: actor.userId,
					'crystal.canonicalDeviceId': actor.deviceId,
					'crystal.cacheGeneration': input.cacheGeneration
				},
				{ session }
			);
			await updateAccountedThing(
				things,
				{ _id: device._id, ownerId: actor.userId, 'crystal.alertCacheGeneration': input.cacheGeneration },
				{ $unset: { 'crystal.alertCacheGeneration': '' }, $set: { updatedAt: new Date() } },
				{ ...HOME, session }
			);
			return { ok: true as const, deviceId: actor.deviceId, cacheGeneration: input.cacheGeneration, enabled: false };
		}
		const normalized = normalizePushDeviceInput({ ...input, platform: device.crystal?.platform });
		if (normalized.ok === false) return fail(400, 'INVALID_PUSH', 'Push platform does not match this installed device');
		if (input.topic !== normalized.topic) return fail(400, 'INVALID_PUSH', 'Push topic does not match this installed device');
		const things = await getHomeThingsCollection();
		await things.updateOne(
			thingUniqueKeyFilter('pushDevice', normalized.key) as any,
			pushDeviceUpsert(actor.userId, actor.sessionId, normalized, new Date(), {
				deviceId: actor.deviceId,
				cacheGeneration: input.cacheGeneration
			}) as any,
			{ upsert: true, session }
		);
		await updateAccountedThing(
			things,
			{ _id: device._id, ownerId: actor.userId },
			{ $set: { 'crystal.alertCacheGeneration': input.cacheGeneration, updatedAt: new Date() } },
			{ ...HOME, session }
		);
		return { ok: true as const, deviceId: actor.deviceId, cacheGeneration: input.cacheGeneration };
	});
}
async function commandFor(ownerId: string, deviceId: string, requestId: string) {
	if (!alertId(deviceId) || !alertId(requestId)) fail(400, 'INVALID_ALERT', 'Stable device and request identities are required');
	const things = await getHomeThingsCollection();
	if (!(await things.findOne({ thingtime: 'device', ownerId, shareId: deviceId }))) fail(404, 'DEVICE_NOT_FOUND', 'Device not found');
	return things.findOne({
		...thingUniqueKeyFilter('deviceUniqueKey', deviceHash('command', ownerId, deviceId, requestId)),
		thingtime: 'device-command',
		ownerId,
		targetId: deviceId
	} as any);
}
async function receipt(doc: any) {
	if (doc.crystal.pushDelivery?.status === 'dispatching' && Date.now() - new Date(doc.crystal.pushDelivery.at).getTime() > 30_000) {
		await (
			await getHomeThingsCollection()
		).updateOne(
			{
				shareId: doc.shareId,
				ownerId: doc.ownerId,
				'crystal.pushDelivery.dispatchId': doc.crystal.pushDelivery.dispatchId,
				'crystal.pushDelivery.status': 'dispatching'
			},
			{
				$set: {
					'crystal.status': 'needs-review',
					'crystal.pushDelivery.status': 'unconfirmed',
					'crystal.completedAt': new Date(),
					'crystal.expiresAt': new Date(Date.now() + DEVICE_COMMAND_TERMINAL_RETENTION_MS),
					'crystal.deviceTtlAt': new Date(Date.now() + DEVICE_COMMAND_TERMINAL_RETENTION_MS),
					updatedAt: new Date()
				}
			}
		);
		doc = { ...doc, crystal: { ...doc.crystal, status: 'needs-review', pushDelivery: { status: 'unconfirmed' } } };
	}
	const command = publicDeviceCommand(doc);
	let preparedSound: any;
	if (doc.crystal.kind === 'media.prepare') {
		const input = doc.crystal.input;
		const device = await (await getHomeThingsCollection()).findOne({ thingtime: 'device', ownerId: doc.ownerId, shareId: doc.targetId });
		const row = await (
			await getHomeThingsCollection()
		).findOne({ thingtime: 'device-alert-sound', ownerId: doc.ownerId, targetId: doc.targetId, 'crystal.soundId': input.soundId });
		const ready = row?.crystal.status === 'ready' && row.crystal.cacheGeneration === device?.crystal.alertCacheGeneration;
		preparedSound = {
			id: input.soundId,
			attachmentId: input.attachmentId,
			versionId: input.versionId,
			filename: preparedSoundFilename(input.soundId),
			status: ready ? 'ready' : row?.crystal.status === 'failed' || doc.crystal.status === 'failed' ? 'failed' : 'preparing'
		};
	}
	return {
		ok: true as const,
		command,
		...(preparedSound ? { preparedSound } : {}),
		delivery: {
			channel: doc.crystal.deliveryChannel === 'apns' ? ('apns' as const) : ('node' as const),
			status: doc.crystal.pushDelivery?.status || doc.crystal.status,
			played: 'not-observed' as const
		}
	};
}
export async function readDeviceAlert(ownerId: string, deviceId: string, requestId: string) {
	const doc = await commandFor(ownerId, deviceId, requestId);
	if (!doc) fail(404, 'ALERT_NOT_FOUND', 'Alert request not found');
	return receipt(doc);
}
export async function createDeviceAlert(ownerId: string, input: any) {
	if (
		!input ||
		Object.keys(input).some((k) => !['deviceId', 'requestId', 'kind', 'input'].includes(k)) ||
		!['notification.show', 'media.play', 'media.prepare'].includes(input.kind)
	)
		fail(400, 'INVALID_ALERT', 'Choose a typed device notification or uploaded media action');
	const existing = await commandFor(ownerId, input.deviceId, input.requestId);
	// Recover uncertain dispatch without sending another audible effect. Still validate immutable input through the command path below.
	const push = input.kind === 'notification.show' ? await getCanonicalDevicePush(ownerId, input.deviceId) : null;
	const channel = existing?.crystal.deliveryChannel === 'apns' || (!existing && push) ? 'apns' : undefined;
	const requestHash = devicePayloadHash(input);
	if (existing?.crystal?.alertRequestHash && existing.crystal.alertRequestHash !== requestHash)
		fail(409, 'ALERT_CONFLICT', 'requestId was already used for different alert content');
	if (!existing?.crystal?.alertRequestHash) {
		const result = await createDeviceCommand(ownerId, input, {
			...(channel ? { deliveryChannel: 'apns' as const } : {}),
			alertRequestHash: requestHash
		});
		if (result.ok === false) fail(result.status, 'ALERT_REFUSED', result.error);
	}
	const doc = await commandFor(ownerId, input.deviceId, input.requestId);
	if (channel) return dispatchDeviceAlertPush(ownerId, input.deviceId, doc.shareId);
	return receipt(doc);
}
/** Called after queue admission and after a dispatch approval commits. GET never dispatches. */
export async function dispatchDeviceAlertPush(ownerId: string, deviceId: string, commandId: string) {
	const things = await getHomeThingsCollection();
	let doc = await things.findOne({ thingtime: 'device-command', ownerId, targetId: deviceId, shareId: commandId });
	if (!doc) fail(404, 'ALERT_NOT_FOUND', 'Alert request not found');
	if (doc.crystal.deliveryChannel === 'apns' && doc.crystal.status === 'queued' && !doc.crystal.pushDelivery) {
		const dispatchId = randomUUID();
		const things = await getHomeThingsCollection();
		const claimed = await things.findOneAndUpdate(
			{
				shareId: doc.shareId,
				ownerId,
				targetId: deviceId,
				thingtime: 'device-command',
				'crystal.status': 'queued',
				$or: [{ 'crystal.requiresApproval': { $ne: true } }, { 'crystal.approvalState': 'approved' }],
				'crystal.pushDelivery': { $exists: false }
			},
			{ $set: { 'crystal.status': 'running', 'crystal.pushDelivery': { status: 'dispatching', dispatchId, at: new Date() }, updatedAt: new Date() } },
			{ returnDocument: 'after' }
		);
		if (claimed) {
			let status: 'provider-accepted' | 'rejected' | 'unconfirmed' = 'unconfirmed';
			try {
				const current = await getCanonicalDevicePush(ownerId, deviceId);
				const liveDevice = await things.findOne({ thingtime: 'device', ownerId, shareId: deviceId });
				if (
					!current ||
					!liveDevice ||
					normalizeDevicePermissionMode(liveDevice.crystal?.permissionMode) === 'deny' ||
					!deviceSupportsCommand('notification.show', liveDevice.crystal?.capabilities)
				)
					status = 'rejected';
				else {
					const sound = doc.crystal.input.sound;
					let filename: string | null = sound.kind === 'none' ? null : 'default';
					if (sound.kind === 'prepared') {
						const prepared = await (
							await getHomeThingsCollection()
						).findOne({
							thingtime: 'device-alert-sound',
							ownerId,
							targetId: deviceId,
							'crystal.soundId': sound.id,
							'crystal.status': 'ready',
							'crystal.cacheGeneration': current.cacheGeneration
						});
						if (!prepared) fail(409, 'SOUND_UNAVAILABLE', 'Prepared sound is no longer cached by this device');
						const audio = await ownedAudio(ownerId, prepared.crystal.attachmentId, prepared.crystal.versionId);
						if (audio.ok === false) fail(audio.status, 'AUDIO_UNAVAILABLE', audio.error);
						filename = preparedSoundFilename(sound.id);
					}
					const sent = await sendCanonicalDeviceAlert(current, {
						notificationId: doc.crystal.notificationId,
						title: doc.crystal.input.title,
						message: doc.crystal.input.message,
						sound: filename
					});
					status = sent.status === 'provider-accepted' ? 'provider-accepted' : 'rejected';
				}
			} catch {
				status = 'unconfirmed';
			}
			await things.updateOne(
				{ shareId: doc.shareId, ownerId, 'crystal.pushDelivery.dispatchId': dispatchId },
				{
					$set: {
						'crystal.status': status === 'provider-accepted' ? 'succeeded' : status === 'unconfirmed' ? 'needs-review' : 'failed',
						'crystal.pushDelivery': { status, at: new Date() },
						'crystal.completedAt': new Date(),
						'crystal.expiresAt': new Date(Date.now() + DEVICE_COMMAND_TERMINAL_RETENTION_MS),
						'crystal.deviceTtlAt': new Date(Date.now() + DEVICE_COMMAND_TERMINAL_RETENTION_MS),
						updatedAt: new Date()
					}
				}
			);
		}
	}
	doc = await things.findOne({ thingtime: 'device-command', ownerId, targetId: deviceId, shareId: commandId });
	return receipt(doc);
}

export async function deviceAlertLease(actor: DeviceActor, input: any) {
	if (!input || !alertId(input.commandId) || !alertId(input.leaseId)) fail(400, 'INVALID_LEASE', 'A command and current lease are required');
	return withHomeMongoTransaction(async (session) => {
		const device = await requireActiveAlertActor(actor, session);
		const row = await (
			await getHomeThingsCollection()
		).findOne({ thingtime: 'device-command', ownerId: actor.userId, targetId: actor.deviceId, shareId: input.commandId }, { session });
		if (device && normalizeDevicePermissionMode(device.crystal?.permissionMode) === 'deny')
			fail(403, 'DEVICE_PERMISSION_DENIED', 'This device has denied remote effects');
		if (row && !deviceSupportsCommand(row.crystal.kind, device.crystal?.capabilities))
			fail(409, 'CAPABILITY_CHANGED', 'This device no longer supports the approved effect');
		if (
			!row ||
			!['claimed', 'running'].includes(row.crystal.status) ||
			decideDeviceLease(row.crystal.leaseHash, deviceHash('lease', input.leaseId), row.crystal.leaseExpiresAt, new Date()) !== 'active'
		)
			fail(409, 'INVALID_LEASE', 'Command lease is invalid or expired');
		return row;
	});
}
export async function getDeviceAlertMedia(actor: DeviceActor, input: any) {
	if (Object.keys(input || {}).some((k) => !['commandId', 'leaseId'].includes(k)))
		fail(400, 'INVALID_LEASE', 'Media is fixed by the approved command');
	const command = await deviceAlertLease(actor, input);
	let media = command.crystal.input;
	if (command.crystal.kind === 'notification.show' && media.sound.kind === 'prepared') {
		const things = await getHomeThingsCollection();
		const device = await things.findOne({ thingtime: 'device', ownerId: actor.userId, shareId: actor.deviceId });
		const sound = await things.findOne({
			thingtime: 'device-alert-sound',
			ownerId: actor.userId,
			targetId: actor.deviceId,
			'crystal.soundId': media.sound.id,
			'crystal.status': 'ready',
			'crystal.cacheGeneration': device?.crystal?.alertCacheGeneration
		});
		if (!sound) fail(409, 'SOUND_UNAVAILABLE', 'The prepared sound is unavailable in this device installation');
		media = sound.crystal;
	} else if (!['media.play', 'media.prepare'].includes(command.crystal.kind))
		fail(403, 'MEDIA_NOT_APPROVED', 'This command does not authorize audio download');
	const result = await downloadDeviceMedia(actor.userId, media.attachmentId, media.versionId);
	if (result.ok === false) fail(result.status, 'MEDIA_UNAVAILABLE', result.error);
	await deviceAlertLease(actor, input);
	return result;
}
export async function recordDevicePreparedSound(actor: DeviceActor, input: any) {
	if (input?.op === 'cache') {
		if (Object.keys(input).some((k) => !['op', 'cacheGeneration'].includes(k)) || !alertId(input.cacheGeneration))
			fail(400, 'INVALID_CACHE', 'A cache generation is required');
		return withHomeMongoTransaction(async (session) => {
			const device = await requireActiveAlertActor(actor, session);
			await updateAccountedThing(
				await getHomeThingsCollection(),
				{ _id: device._id, ownerId: actor.userId },
				{ $set: { 'crystal.alertCacheGeneration': input.cacheGeneration, updatedAt: new Date() } },
				{ ...HOME, session }
			);
			return { ok: true as const, cacheGeneration: input.cacheGeneration };
		});
	}
	if (
		!input ||
		Object.keys(input).some((k) => !['commandId', 'leaseId', 'cacheGeneration', 'soundId', 'durationSeconds', 'format', 'status'].includes(k)) ||
		!mediaVersion(input.soundId) ||
		!alertId(input.cacheGeneration) ||
		input.format !== 'caf' ||
		!['ready', 'failed'].includes(input.status) ||
		(input.status === 'ready' &&
			(typeof input.durationSeconds !== 'number' ||
				!Number.isFinite(input.durationSeconds) ||
				input.durationSeconds <= 0 ||
				input.durationSeconds >= 30)) ||
		(input.status === 'failed' &&
			input.durationSeconds !== undefined &&
			input.durationSeconds !== null &&
			(typeof input.durationSeconds !== 'number' || !Number.isFinite(input.durationSeconds) || input.durationSeconds < 0))
	)
		fail(400, 'INVALID_SOUND', 'A verified CAF sound shorter than 30 seconds is required');
	await deviceAlertLease(actor, input);
	return withHomeMongoTransaction(async (session) => {
		const device = await requireActiveAlertActor(actor, session);
		if (device.crystal?.alertCacheGeneration !== input.cacheGeneration) fail(409, 'CACHE_CHANGED', 'Device installation cache changed');
		const things = await getHomeThingsCollection();
		const command = await things.findOne(
			{ thingtime: 'device-command', ownerId: actor.userId, targetId: actor.deviceId, shareId: input.commandId },
			{ session }
		);
		if (
			!command ||
			command.crystal.kind !== 'media.prepare' ||
			command.crystal.input.soundId !== input.soundId ||
			!['claimed', 'running'].includes(command.crystal.status) ||
			decideDeviceLease(command.crystal.leaseHash, deviceHash('lease', input.leaseId), command.crystal.leaseExpiresAt, new Date()) !== 'active'
		)
			fail(409, 'INVALID_LEASE', 'This lease does not authorize the prepared sound');
		const audio = await ownedAudio(actor.userId, command.crystal.input.attachmentId, command.crystal.input.versionId, session);
		if (audio.ok === false) fail(audio.status, 'AUDIO_UNAVAILABLE', audio.error);
		const key = deviceHash('alert-sound', actor.userId, actor.deviceId, input.soundId);
		const filter = {
			...thingUniqueKeyFilter('deviceUniqueKey', key),
			ownerId: actor.userId,
			thingtime: 'device-alert-sound',
			targetId: actor.deviceId
		};
		const previous = await things.findOne(filter as any, { session });
		const crystal = {
			deviceAlertSoundKey: key,
			soundId: input.soundId,
			attachmentId: audio.attachmentId,
			versionId: audio.versionId,
			cacheGeneration: input.cacheGeneration,
			status: input.status,
			format: 'caf',
			durationSeconds: input.durationSeconds ?? null
		};
		if (previous)
			await updateAccountedThing(
				things,
				{ _id: previous._id, ownerId: actor.userId },
				{ $set: { crystal, updatedAt: new Date() } },
				{ ...HOME, session }
			);
		else
			await insertAccountedThing(
				things,
				{ ...newDeviceThing('device-alert-sound', { ownerId: actor.userId, targetId: actor.deviceId, crystal }), parentId: actor.deviceId },
				{ ...HOME, session }
			);
		return {
			ok: true as const,
			sound: {
				id: input.soundId,
				filename: preparedSoundFilename(input.soundId),
				status: input.status,
				attachmentId: audio.attachmentId,
				versionId: audio.versionId
			}
		};
	});
}
