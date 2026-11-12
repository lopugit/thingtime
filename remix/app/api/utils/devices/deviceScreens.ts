import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { thingUniqueKeyFilter } from '../mongodb/uniqueKeys';
import { insertAccountedThing, updateAccountedThing } from '../storage/accountedThings';
import {
	DEVICE_SCREEN_STATUSES,
	deviceFail,
	deviceHash,
	devicePayloadHash,
	normalizeRequestId,
	type DeviceFail,
	type DeviceScreenStatus
} from './deviceCore';
import { createDeviceCommand, type PublicDeviceCommand } from './deviceCommands';
import { appendDeviceEvent, deviceExistsForOwner, newDeviceThing } from './devices';

const HOME_ACCOUNTING = { accountedPlane: 'home' as const };
const MAX_SCREEN_SESSIONS = 100;

const bounded = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const iso = (value: unknown): string | null => {
	if (!value) return null;
	const date = new Date(value as any);
	return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

export type PublicDeviceScreenSession = {
	id: string;
	deviceId: string;
	requestId: string;
	status: DeviceScreenStatus;
	viewOnly: boolean;
	createdAt: string;
	updatedAt: string;
	startedAt: string | null;
	endedAt: string | null;
	error: string | null;
};

const publicScreen = (doc: any): PublicDeviceScreenSession => ({
	id: String(doc.shareId),
	deviceId: String(doc.targetId),
	requestId: String(doc.crystal?.requestId || ''),
	status: (DEVICE_SCREEN_STATUSES as readonly string[]).includes(doc.crystal?.status) ? doc.crystal.status : 'failed',
	viewOnly: doc.crystal?.viewOnly !== false,
	createdAt: new Date(doc.createdAt).toISOString(),
	updatedAt: new Date(doc.updatedAt).toISOString(),
	startedAt: iso(doc.crystal?.startedAt),
	endedAt: iso(doc.crystal?.endedAt),
	error: typeof doc.crystal?.error === 'string' ? doc.crystal.error : null
});

export const listDeviceScreenSessions = async (
	ownerId: string,
	deviceIdValue: unknown
): Promise<DeviceFail | { ok: true; sessions: PublicDeviceScreenSession[] }> => {
	const deviceId = bounded(deviceIdValue, 160);
	if (!deviceId) return deviceFail(400, 'deviceId is required');
	if (!(await deviceExistsForOwner(ownerId, deviceId))) return deviceFail(404, 'Device not found');
	const docs = await (
		await getHomeThingsCollection()
	)
		.find({ thingtime: 'device-screen-session', ownerId, targetId: deviceId } as any)
		.sort({ createdAt: -1, shareId: 1 })
		.limit(MAX_SCREEN_SESSIONS)
		.toArray();
	return { ok: true, sessions: docs.map(publicScreen) };
};

export const startDeviceScreenSession = async (
	ownerId: string,
	input: { deviceId?: unknown; requestId?: unknown; viewOnly?: unknown }
): Promise<DeviceFail | { ok: true; session: PublicDeviceScreenSession; command: PublicDeviceCommand; idempotent: boolean }> => {
	const deviceId = bounded(input?.deviceId, 160);
	const requestId = normalizeRequestId(input?.requestId);
	if (!deviceId || !requestId) return deviceFail(400, 'deviceId and a stable requestId are required');
	if (!(await deviceExistsForOwner(ownerId, deviceId))) return deviceFail(404, 'Device not found');
	const viewOnly = input?.viewOnly !== false;
	const key = deviceHash('screen', ownerId, deviceId, requestId);
	const payloadHash = devicePayloadHash({ action: 'start', viewOnly });
	const things = await getHomeThingsCollection();
	let doc = await things.findOne(thingUniqueKeyFilter('deviceUniqueKey', key) as any);
	let idempotent = !!doc;
	if (doc && doc.crystal?.payloadHash !== payloadHash) {
		return deviceFail(409, 'requestId was already used for different screen-session content');
	}
	if (!doc) {
		doc = newDeviceThing('device-screen-session', {
			ownerId,
			targetId: deviceId,
			crystal: {
				deviceScreenKey: key,
				payloadHash,
				requestId,
				status: 'requested',
				viewOnly,
				startedAt: null,
				endedAt: null,
				error: null,
				lastEventKey: null,
				lastEventHash: null
			}
		});
		try {
			await withHomeMongoTransaction(async (session) => {
				await insertAccountedThing(things, doc, { ...HOME_ACCOUNTING, session });
				await appendDeviceEvent(
					{
						ownerId,
						deviceId,
						eventType: 'screen.requested',
						resourceId: String(doc.shareId),
						payload: { status: 'requested', viewOnly },
						idempotencyKey: `screen:${key}:requested`
					},
					session
				);
			});
		} catch (error: any) {
			if (error?.code !== 11000) throw error;
			doc = await things.findOne(thingUniqueKeyFilter('deviceUniqueKey', key) as any);
			if (!doc || doc.crystal?.payloadHash !== payloadHash) {
				return deviceFail(409, 'Screen-session creation raced; retry');
			}
			idempotent = true;
		}
	}
	const command = await createDeviceCommand(ownerId, {
		deviceId,
		requestId: `screen-start:${requestId}`,
		kind: 'screen.start',
		input: { screenSessionId: String(doc.shareId), viewOnly },
		requiresApproval: false
	});
	if (command.ok === false) return command;
	return { ok: true, session: publicScreen(doc), command: command.command, idempotent: idempotent && command.idempotent };
};

export const stopDeviceScreenSession = async (
	ownerId: string,
	input: { sessionId?: unknown; requestId?: unknown }
): Promise<DeviceFail | { ok: true; session: PublicDeviceScreenSession; command: PublicDeviceCommand; idempotent: boolean }> => {
	const sessionId = bounded(input?.sessionId, 160);
	const requestId = normalizeRequestId(input?.requestId);
	if (!sessionId || !requestId) return deviceFail(400, 'sessionId and a stable requestId are required');
	const things = await getHomeThingsCollection();
	const screen = await things.findOne({ shareId: sessionId, thingtime: 'device-screen-session', ownerId } as any);
	if (!screen) return deviceFail(404, 'Screen session not found');
	const deviceId = String(screen.targetId);
	const command = await createDeviceCommand(ownerId, {
		deviceId,
		requestId: `screen-stop:${requestId}`,
		kind: 'screen.stop',
		input: { screenSessionId: sessionId },
		requiresApproval: false
	});
	if (command.ok === false) return command;
	if (screen.crystal?.status === 'ended') {
		return { ok: true, session: publicScreen(screen), command: command.command, idempotent: true };
	}
	const now = new Date();
	await withHomeMongoTransaction(async (mongoSession) => {
		await updateAccountedThing(
			things,
			{ _id: screen._id, 'crystal.status': { $ne: 'ended' } } as any,
			{ $set: { 'crystal.status': 'ended', 'crystal.endedAt': now, updatedAt: now } },
			{ ...HOME_ACCOUNTING, session: mongoSession }
		);
		await appendDeviceEvent(
			{
				ownerId,
				deviceId,
				eventType: 'screen.ended',
				resourceId: sessionId,
				payload: { status: 'ended', reason: 'user-requested' },
				idempotencyKey: `screen:${sessionId}:stop:${requestId}`
			},
			mongoSession
		);
	});
	const updated = await things.findOne({ _id: screen._id } as any);
	return { ok: true, session: publicScreen(updated || screen), command: command.command, idempotent: false };
};

export const updateDeviceScreenSession = async (
	ownerId: string,
	deviceId: string,
	input: { sessionId?: unknown; eventId?: unknown; status?: unknown; error?: unknown }
): Promise<DeviceFail | { ok: true; session: PublicDeviceScreenSession; idempotent: boolean }> => {
	const sessionId = bounded(input?.sessionId, 160);
	const eventId = normalizeRequestId(input?.eventId);
	const status =
		typeof input?.status === 'string' && (DEVICE_SCREEN_STATUSES as readonly string[]).includes(input.status) && input.status !== 'requested'
			? (input.status as DeviceScreenStatus)
			: null;
	const error = bounded(input?.error, 1000) || null;
	if (!sessionId || !eventId || !status) return deviceFail(400, 'sessionId, eventId and a reportable status are required');
	const things = await getHomeThingsCollection();
	const screen = await things.findOne({ shareId: sessionId, thingtime: 'device-screen-session', ownerId, targetId: deviceId } as any);
	if (!screen) return deviceFail(404, 'Screen session not found');
	const eventKey = deviceHash('screen-event', ownerId, deviceId, sessionId, eventId);
	const eventHash = devicePayloadHash({ status, error });
	if (screen.crystal?.lastEventKey === eventKey) {
		return screen.crystal?.lastEventHash === eventHash
			? { ok: true, session: publicScreen(screen), idempotent: true }
			: deviceFail(409, 'eventId was already used for different screen status content');
	}
	if (screen.crystal?.status === 'ended' || screen.crystal?.status === 'failed') {
		return deviceFail(409, 'Screen session is already terminal');
	}
	const now = new Date();
	const terminal = status === 'ended' || status === 'failed';
	let updated: any = null;
	await withHomeMongoTransaction(async (mongoSession) => {
		await updateAccountedThing(
			things,
			{ _id: screen._id, 'crystal.lastEventKey': screen.crystal?.lastEventKey ?? null } as any,
			{
				$set: {
					'crystal.status': status,
					'crystal.error': error,
					'crystal.lastEventKey': eventKey,
					'crystal.lastEventHash': eventHash,
					...(status === 'active' && !screen.crystal?.startedAt ? { 'crystal.startedAt': now } : {}),
					...(terminal ? { 'crystal.endedAt': now } : {}),
					updatedAt: now
				}
			},
			{ ...HOME_ACCOUNTING, session: mongoSession }
		);
		updated = await things.findOne({ _id: screen._id } as any, { session: mongoSession });
		if (!updated || updated.crystal?.lastEventKey !== eventKey) throw Object.assign(new Error('screen_event_race'), { status: 409 });
		await appendDeviceEvent(
			{
				ownerId,
				deviceId,
				eventType: `screen.${status}`,
				resourceId: sessionId,
				payload: { status, error },
				idempotencyKey: `screen-event:${eventKey}:${eventHash}`
			},
			mongoSession
		);
	});
	return { ok: true, session: publicScreen(updated), idempotent: false };
};
