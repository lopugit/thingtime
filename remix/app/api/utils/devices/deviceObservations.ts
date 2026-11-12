import { randomUUID } from 'node:crypto';
import { getHomeThingsCollection, getSessionsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { thingUniqueKeyFilter } from '../mongodb/uniqueKeys';
import { insertAccountedThing, updateAccountedThing, deleteAccountedThings } from '../storage/accountedThings';
import { deviceHash, devicePayloadHash } from './deviceCore';
import { newDeviceThing } from './devices';
import type { DeviceActor } from './deviceAuth';
import {
	normalizeDeviceObservation,
	observationSettings,
	isObservationType,
	observationId,
	observationDate,
	observationExpired,
	observationCutoff,
	observationCursor,
	parseObservationCursor,
	type DeviceObservation,
	type DeviceObservationInput
} from './deviceObservationCore';

const HOME = { accountedPlane: 'home' as const };
export class DeviceObservationFailure extends Error {
	constructor(readonly status: number, readonly code: string, message: string) {
		super(message);
	}
}
const failure = (status: number, code: string, message: string): never => {
	throw new DeviceObservationFailure(status, code, message);
};
const publicObservation = (row: any): DeviceObservation => ({
	id: row.crystal.observation.id,
	type: row.crystal.observation.type,
	observedAt: row.crystal.observation.observedAt,
	value: row.crystal.observation.value,
	deviceId: row.targetId,
	receivedAt: row.crystal.receivedAt.toISOString()
});
type Dependencies = {
	things(): Promise<any>;
	sessions(): Promise<any>;
	transaction<T>(work: (session: any) => Promise<T>): Promise<T>;
	insert: typeof insertAccountedThing;
	update: typeof updateAccountedThing;
	remove: typeof deleteAccountedThings;
	now(): Date;
	uuid(): string;
};
const defaults: Dependencies = {
	things: getHomeThingsCollection,
	sessions: getSessionsCollection,
	transaction: withHomeMongoTransaction,
	insert: insertAccountedThing,
	update: updateAccountedThing,
	remove: deleteAccountedThings,
	now: () => new Date(),
	uuid: randomUUID
};

export function createDeviceObservationService(overrides: Partial<Dependencies> = {}) {
	const deps = { ...defaults, ...overrides };
	const device = async (ownerId: string, deviceId: string, session: any) => {
		if (!observationId(deviceId)) failure(400, 'INVALID_DEVICE', 'A deviceId is required');
		const row = await (await deps.things()).findOne({ shareId: deviceId, ownerId, thingtime: 'device' }, { session });
		if (!row) failure(404, 'DEVICE_NOT_FOUND', 'Device not found');
		return row;
	};
	const activeActor = async (actor: DeviceActor, session: any) => {
		const now = deps.now();
		const filter = {
			jti: actor.sessionId,
			userId: actor.userId,
			purpose: 'device',
			'meta.deviceId': actor.deviceId,
			revokedAt: null,
			$or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
		};
		// A write on the same session row serializes with concurrent revocation.
		const result = await (await deps.sessions()).updateOne(filter, { $set: { 'meta.observationCheckedAt': now } }, { session });
		if (!result.matchedCount) failure(401, 'DEVICE_REVOKED', 'Unauthorized device credential');
	};
	const cleanupWithin = async (ownerId: string, row: any, type: 'location', session: any) => {
		const settings = observationSettings(row, type);
		if (settings.retentionMs === null) return { deleted: 0, hasMore: false };
		const things = await deps.things();
		const filter = {
			ownerId,
			thingtime: 'device-observation',
			parentId: row.shareId,
			targetId: row.shareId,
			'crystal.type': type,
			'crystal.observedAt': { $lte: observationCutoff(settings.retentionMs, deps.now().getTime()) }
		};
		const docs = await things.find(filter, { session }).sort({ 'crystal.observedAt': 1, shareId: 1 }).limit(101).toArray();
		const batch = docs.slice(0, 100);
		const expiredLatest =
			row.crystal?.latestObservations?.[type] &&
			observationExpired(row.crystal.latestObservations[type].observedAt, settings.retentionMs, deps.now().getTime());
		if (batch.length || expiredLatest)
			await deps.update(
				things,
				{ _id: row._id, ownerId },
				{
					$set: { 'crystal.observationCleanupCheckedAt': deps.now() },
					...(expiredLatest ? { $unset: { [`crystal.latestObservations.${type}`]: '' } } : {})
				},
				{ ...HOME, session }
			);
		if (batch.length)
			await deps.remove(things, { ownerId, thingtime: 'device-observation', _id: { $in: batch.map((d) => d._id) } }, { ...HOME, session });
		return { deleted: batch.length, hasMore: docs.length > batch.length };
	};
	const nodeSettings = (actor: DeviceActor) =>
		deps.transaction(async (session) => {
			await activeActor(actor, session);
			return { ok: true as const, settings: observationSettings(await device(actor.userId, actor.deviceId, session), 'location') };
		});
	const recordWithin = async (actor: DeviceActor, input: unknown, session: any) => {
		const now = deps.now();
		const observation = normalizeDeviceObservation(input, now.getTime());
		if (!observation) failure(400, 'INVALID_OBSERVATION', 'Invalid registered observation');
		await activeActor(actor, session);
		const row = await device(actor.userId, actor.deviceId, session);
		const settings = observationSettings(row, observation.type);
		if (!settings.enabled) failure(409, 'OBSERVATION_COLLECTION_DISABLED', 'Observation collection is disabled');
		if (settings.collectionId !== observation.collectionId)
			failure(409, 'OBSERVATION_COLLECTION_CHANGED', 'Observation collection changed; discard samples from the previous grant');
		const things = await deps.things();
		const key = deviceHash('observation', actor.userId, actor.deviceId, observation.type, observation.collectionId, observation.id);
		const hash = devicePayloadHash(observation);
		const filter = {
			...thingUniqueKeyFilter('deviceUniqueKey', key),
			ownerId: actor.userId,
			thingtime: 'device-observation',
			targetId: actor.deviceId
		};
		const existing = await things.findOne(filter, { session });
		if (existing) {
			if (existing.crystal.payloadHash !== hash)
				failure(409, 'OBSERVATION_CONFLICT', 'This observation identity was already used for different content');
			return {
				ok: true as const,
				observation: publicObservation(existing),
				duplicate: true,
				expired: observationExpired(observation.observedAt, settings.retentionMs, now.getTime())
			};
		}
		if (observationExpired(observation.observedAt, settings.retentionMs, now.getTime()))
			return { ok: true as const, observation: null, duplicate: false, expired: true };
		// Expire the detached previous snapshot before writing a fresh current pointer.
		await cleanupWithin(actor.userId, row, observation.type, session);
		const doc = {
			...newDeviceThing('device-observation', {
				ownerId: actor.userId,
				targetId: actor.deviceId,
				crystal: {
					deviceObservationKey: key,
					type: observation.type,
					payloadHash: hash,
					observation,
					observedAt: new Date(observation.observedAt),
					receivedAt: now
				}
			}),
			parentId: actor.deviceId
		};
		await deps.insert(things, doc, { ...HOME, session });
		const last = row.crystal?.latestObservations?.[observation.type];
		const latest =
			!last ||
			Date.parse(last.observedAt) < Date.parse(observation.observedAt) ||
			(last.observedAt === observation.observedAt && String(last.id) < observation.id);
		// This accounted parent write also fences collection-setting changes in the transaction.
		const result = await deps.update(
			things,
			{ _id: row._id, ownerId: actor.userId },
			{
				$set: {
					'crystal.observationReceivedAt': now,
					...(latest
						? { [`crystal.latestObservations.${observation.type}`]: { ...observation, deviceId: actor.deviceId, receivedAt: now.toISOString() } }
						: {}),
					updatedAt: now
				}
			},
			{ ...HOME, session }
		);
		if (!result.matchedCount) failure(409, 'DEVICE_CHANGED', 'Device changed while recording observation');
		return { ok: true as const, observation: publicObservation(doc), duplicate: false, expired: false };
	};
	const record = async (actor: DeviceActor, input: unknown) => {
		// Unique index races retry the same immutable sample, never a new identity.
		try {
			return await deps.transaction((session) => recordWithin(actor, input, session));
		} catch (error: any) {
			if (error?.code === 11000) return deps.transaction((session) => recordWithin(actor, input, session));
			throw error;
		}
	};
	const settings = (ownerId: string, input: any) =>
		deps.transaction(async (session) => {
			if (!input || Object.keys(input).some((k) => !['deviceId', 'type', 'enabled', 'retentionMs'].includes(k)) || !isObservationType(input.type))
				failure(400, 'INVALID_SETTINGS', 'A registered observation type is required');
			if (input.enabled !== undefined && typeof input.enabled !== 'boolean') failure(400, 'INVALID_SETTINGS', 'enabled must be boolean');
			if (input.retentionMs !== undefined && input.retentionMs !== null && (!Number.isSafeInteger(input.retentionMs) || input.retentionMs <= 0))
				failure(400, 'INVALID_SETTINGS', 'retentionMs must be null (Never) or a positive safe integer');
			const row = await device(ownerId, input.deviceId, session);
			const previous = observationSettings(row, input.type);
			const enabled = input.enabled ?? previous.enabled;
			const next = {
				enabled,
				retentionMs: input.retentionMs === undefined ? previous.retentionMs : input.retentionMs,
				collectionId: enabled !== previous.enabled ? deps.uuid() : previous.collectionId
			};
			await deps.update(
				await deps.things(),
				{ _id: row._id, ownerId },
				{ $set: { [`crystal.observationSettings.${input.type}`]: next, updatedAt: deps.now() } },
				{ ...HOME, session }
			);
			const updated = { ...row, crystal: { ...row.crystal, observationSettings: { ...row.crystal?.observationSettings, [input.type]: next } } };
			return { ok: true as const, settings: next, cleanup: await cleanupWithin(ownerId, updated, input.type, session) };
		});
	const read = async (ownerId: string, query: any) => {
		if (!isObservationType(query.type)) failure(400, 'INVALID_QUERY', 'A registered observation type is required');
		const limit = query.limit === undefined || query.limit === null ? 100 : Number(query.limit);
		if (!Number.isSafeInteger(limit) || limit < 1) failure(400, 'INVALID_QUERY', 'limit must be a positive integer');
		// Page processing is bounded; callers can continue through every record.
		const pageSize = Math.min(limit, 100);
		let cursor: ReturnType<typeof parseObservationCursor>;
		try {
			cursor = parseObservationCursor(query.cursor);
		} catch {
			failure(400, 'INVALID_CURSOR', 'Invalid observation cursor');
		}
		const from = query.from ? observationDate(query.from) : null;
		const to = query.to ? observationDate(query.to) : null;
		if ((query.from && !from) || (query.to && !to) || (from && to && from > to)) failure(400, 'INVALID_QUERY', 'Invalid observation time range');
		return deps.transaction(async (session) => {
			const row = await device(ownerId, query.deviceId, session);
			const saved = observationSettings(row, query.type);
			const cleanup = await cleanupWithin(ownerId, row, query.type, session);
			const filter: any = { ownerId, thingtime: 'device-observation', parentId: row.shareId, targetId: row.shareId, 'crystal.type': query.type };
			const times: any = { ...(from ? { $gte: new Date(from) } : {}), ...(to ? { $lte: new Date(to) } : {}) };
			if (saved.retentionMs !== null) times.$gt = observationCutoff(saved.retentionMs, deps.now().getTime());
			if (Object.keys(times).length) filter['crystal.observedAt'] = times;
			if (cursor)
				filter.$or = [
					{ 'crystal.observedAt': { $lt: new Date(cursor.observedAt) } },
					{ 'crystal.observedAt': new Date(cursor.observedAt), shareId: { $lt: cursor.id } }
				];
			const docs = await (
				await deps.things()
			)
				.find(filter, { session })
				.sort({ 'crystal.observedAt': -1, shareId: -1 })
				.limit(pageSize + 1)
				.toArray();
			const page = docs.slice(0, pageSize);
			const tail = page.at(-1);
			const latest = row.crystal?.latestObservations?.[query.type];
			return {
				ok: true as const,
				observations: page.map(publicObservation),
				latest:
					latest && !observationExpired(latest.observedAt, saved.retentionMs, deps.now().getTime())
						? (({ collectionId, ...value }) => value)(latest)
						: null,
				settings: saved,
				nextCursor: docs.length > pageSize && tail ? observationCursor({ observedAt: tail.crystal.observation.observedAt, id: tail.shareId }) : null,
				cleanup
			};
		});
	};
	const sweep = async () => {
		const key = deviceHash('observation-cleanup');
		const leaseId = deps.uuid();
		const now = deps.now();
		const claim = await deps
			.transaction(async (session) => {
				const things = await deps.things();
				const query = { ...thingUniqueKeyFilter('deviceUniqueKey', key), thingtime: 'device-observation-cleanup' };
				const state = await things.findOne(query, { session });
				if (state?.crystal?.leaseUntil > now) return null;
				const lease = { leaseId, leaseUntil: new Date(now.getTime() + 120_000) };
				if (state) {
					const result = await deps.update(
						things,
						{ _id: state._id, ...query },
						{ $set: { 'crystal.leaseId': leaseId, 'crystal.leaseUntil': lease.leaseUntil, updatedAt: now } },
						{ ...HOME, session }
					);
					if (!result.matchedCount) return null;
				} else
					await deps.insert(
						things,
						newDeviceThing('device-observation-cleanup', {
							ownerId: 'system',
							control: true,
							crystal: { deviceObservationCleanupKey: key, cursor: null, ...lease }
						}),
						{ ...HOME, session }
					);
				return { cursor: typeof state?.crystal?.cursor === 'string' ? state.crystal.cursor : null };
			})
			.catch((error) => {
				if (error?.code === 11000) return null;
				throw error;
			});
		if (!claim) return { ok: true as const, busy: true, deleted: 0, failed: 0, hasMore: true };
		let cursor = claim.cursor;
		let deleted = 0,
			failed = 0,
			hasMore = false;
		try {
			const rows = await deps.transaction(async (session) =>
				(
					await deps.things()
				)
					.find({ thingtime: 'device', ...(cursor ? { shareId: { $gt: cursor } } : {}) }, { session })
					.sort({ shareId: 1 })
					.limit(21)
					.toArray()
			);
			hasMore = rows.length > 20;
			for (const row of rows.slice(0, 20)) {
				try {
					const cleanup = await deps.transaction(async (session) =>
						cleanupWithin(row.ownerId, await device(row.ownerId, row.shareId, session), 'location', session)
					);
					deleted += cleanup.deleted;
					if (cleanup.hasMore) {
						hasMore = true;
						break;
					}
				} catch {
					failed++;
				}
				cursor = row.shareId;
			}
			if (!hasMore) cursor = null;
		} finally {
			await deps.transaction(async (session) =>
				deps.update(
					await deps.things(),
					{ ...thingUniqueKeyFilter('deviceUniqueKey', key), thingtime: 'device-observation-cleanup', 'crystal.leaseId': leaseId },
					{ $set: { 'crystal.cursor': cursor, 'crystal.leaseUntil': deps.now(), 'crystal.leaseId': null, updatedAt: deps.now() } },
					{ ...HOME, session }
				)
			);
		}
		return { ok: true as const, busy: false, deleted, failed, hasMore };
	};
	return { record, recordWithin, nodeSettings, settings, read, sweep };
}
export const deviceObservations = createDeviceObservationService();
