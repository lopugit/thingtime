import { getHomeThingsCollection } from '../mongodb/collections';
import { thingUniqueKey, thingUniqueKeyFilter, thingUniqueKeysFilter } from '../mongodb/uniqueKeys';
import { deleteMessengerThings, updateMessengerThing, withMessengerStorageTransaction } from '../messenger/storage';
import { chatMemberKey, fail, newThingDoc, type Fail } from '../messenger/shared';
import type { AiSourceProvider } from '../messenger/externalAi';
import { MAX_MESSAGE_CHARS } from '~/schemas/registry';
import { decideDeviceRevision, deviceControlEventLogicalBytes, deviceHash, devicePayloadHash, type DeviceFail } from './deviceCore';
import {
	advanceDeviceLiveDeltaGuardTails,
	deviceLiveExternalNamespace,
	deviceLiveMaterializedMessages,
	decideDeviceLiveReplay,
	decideLiveTranscriptActivityRevision,
	decideLiveTranscriptRevision,
	liveTranscriptActivityRevisionHash,
	liveTranscriptRevisionHash,
	normalizeDeviceLiveDeltaGuardTails,
	normalizeDeviceNodeLiveSyncRequest,
	splitLiveMessageText,
	staleLiveSegmentIndexes,
	type DeviceLiveConnectorEvent,
	type DeviceLiveDeltaGuardEvent,
	type DeviceLiveDeltaGuardTail,
	type DeviceLiveEventType,
	type DeviceLiveMessageEnvelope,
	type DeviceLiveSessionSummary,
	type DeviceLiveTranscriptActivity,
	type DeviceNodeLiveSyncResponse
} from './deviceLiveAiCore';
import {
	DEVICE_CONTROL_EVENT_MAX_BYTES,
	DEVICE_CONTROL_EVENT_MAX_COUNT,
	deviceControlEventScopeKey,
	deviceConnectorIsFresh,
	newDeviceThing,
	pruneDeviceControlEventScope
} from './devices';

export const DEVICE_LIVE_CONTROL_EVENT_RETENTION_MS = 30 * 60 * 1000;
export const DEVICE_LIVE_CONTROL_EVENT_MAX_COUNT = 256;
export const DEVICE_LIVE_CONTROL_EVENT_MAX_BYTES = 1024 * 1024;
const DEVICE_LIVE_EVENT_VISIBLE_TEXT_CHARS = 32_000;

export type DeviceLiveConnectorContext = {
	connectorId: string;
	revision: number;
	connectorHash: string;
	provider: AiSourceProvider;
	label: string;
	capabilities: string[];
};

class DeviceLiveSyncError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'DeviceLiveSyncError';
		this.status = status;
	}
}

const stableShareId = (prefix: string, key: string): string => `${prefix}-${key.slice(0, 32)}`;

const safeDate = (value: string | null | undefined, fallback = new Date()): Date => {
	if (!value) return fallback;
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date : fallback;
};

const liveScope = (ownerId: string, deviceId: string, connectorId: string, sessionId: string): string =>
	deviceLiveExternalNamespace(ownerId, deviceId, connectorId, sessionId);

const visibleControlText = (value: string): string => Array.from(value).slice(0, DEVICE_LIVE_EVENT_VISIBLE_TEXT_CHARS).join('');

const deltaGuardEvent = (event: DeviceLiveConnectorEvent): DeviceLiveDeltaGuardEvent => ({
	type: event.type,
	itemId: event.itemId,
	turnId: event.turnId,
	...(event.type === 'message.delta' ? { delta: event.payload.delta } : {})
});

const applyDeltaGuardEvent = (tails: DeviceLiveDeltaGuardTail[], event: DeviceLiveDeltaGuardEvent): DeviceLiveDeltaGuardTail[] => {
	const decision = advanceDeviceLiveDeltaGuardTails(tails, event);
	if (decision.ok) return decision.tails;
	if ('reason' in decision && decision.reason === 'capacity') {
		throw new DeviceLiveSyncError(429, 'Too many live message streams are active for this session');
	}
	throw new DeviceLiveSyncError(400, 'Live delta contains internal execution context');
};

const rebuildDeltaGuardTails = async (
	things: any,
	ownerId: string,
	deviceId: string,
	connectorId: string,
	sessionId: string,
	session: any
): Promise<DeviceLiveDeltaGuardTail[]> => {
	const rows = await things
		.find(
			{
				thingtime: 'device-command-event',
				ownerId,
				targetId: deviceId,
				'crystal.eventType': 'ai.session-event',
				'crystal.resourceId': sessionId,
				'crystal.payload.connectorId': connectorId,
				'crystal.payload.sessionId': sessionId,
				'crystal.payload.type': { $in: ['message.delta', 'item.started', 'item.completed', 'turn.completed', 'turn.interrupted'] }
			} as any,
			{ projection: { 'crystal.payload': 1, 'crystal.revision': 1 }, session }
		)
		.sort({ 'crystal.revision': -1 })
		.limit(DEVICE_LIVE_CONTROL_EVENT_MAX_COUNT)
		.toArray();
	let tails: DeviceLiveDeltaGuardTail[] = [];
	for (const row of [...(rows as any[])].reverse()) {
		const stored = row?.crystal?.payload;
		const type = stored?.type as DeviceLiveEventType | undefined;
		if (
			!type ||
			!['message.delta', 'item.started', 'item.completed', 'turn.completed', 'turn.interrupted'].includes(type) ||
			!(stored.itemId === null || typeof stored.itemId === 'string') ||
			!(stored.turnId === null || typeof stored.turnId === 'string')
		) {
			throw new DeviceLiveSyncError(409, 'The persisted live delta guard state is invalid');
		}
		const event: DeviceLiveDeltaGuardEvent = {
			type,
			itemId: stored.itemId,
			turnId: stored.turnId,
			...(type === 'message.delta' && typeof stored.payload?.delta === 'string' ? { delta: stored.payload.delta } : {})
		};
		tails = applyDeltaGuardEvent(tails, event);
	}
	return tails;
};

const liveControlRetainedBytes = (eventType: string, resourceId: string, revision: number, payload: Record<string, unknown>): number =>
	deviceControlEventLogicalBytes({ eventType, resourceId, revision, payload });

const pruneLiveControlEvents = async (
	things: any,
	ownerId: string,
	deviceId: string,
	connectorId: string,
	sessionId: string,
	session: any
): Promise<void> => {
	const scopeKey = liveScope(ownerId, deviceId, connectorId, sessionId);
	await pruneDeviceControlEventScope(
		things,
		ownerId,
		deviceId,
		'liveControlEventScopeKey',
		scopeKey,
		DEVICE_LIVE_CONTROL_EVENT_MAX_COUNT,
		DEVICE_LIVE_CONTROL_EVENT_MAX_BYTES,
		session
	);
	await pruneDeviceControlEventScope(
		things,
		ownerId,
		deviceId,
		'deviceControlEventScopeKey',
		deviceControlEventScopeKey(ownerId, deviceId),
		DEVICE_CONTROL_EVENT_MAX_COUNT,
		DEVICE_CONTROL_EVENT_MAX_BYTES,
		session
	);
};

const liveChatKey = (ownerId: string, deviceId: string, connectorId: string, sessionId: string): string =>
	deviceHash('ai-live-chat', ownerId, deviceId, connectorId, sessionId);

const liveConnectionKey = (ownerId: string, deviceId: string, connectorId: string): string =>
	deviceHash('ai-live-connection', ownerId, deviceId, connectorId);

const liveSourceProjection = (deviceId: string, connector: DeviceLiveConnectorContext, sessionId: string, extra: Record<string, unknown> = {}) => ({
	access: 'live',
	provider: connector.provider,
	sourceId: connector.connectorId.slice(0, 64),
	label: connector.label,
	connector: connector.connectorId,
	deviceId,
	connectorId: connector.connectorId,
	sessionId,
	capabilities: connector.capabilities,
	readOnly: false,
	...extra
});

const preservedHistoryProgress = (source: any): Record<string, unknown> => {
	if (!source || typeof source !== 'object' || typeof source.historyHasMore !== 'boolean') return {};
	const historyCursor = source.historyCursor === null || typeof source.historyCursor === 'string' ? source.historyCursor : undefined;
	const historyRequestCursor =
		source.historyRequestCursor === null || typeof source.historyRequestCursor === 'string' ? source.historyRequestCursor : undefined;
	const syncedAt = typeof source.historySyncedAt === 'string' ? new Date(source.historySyncedAt) : null;
	if (
		historyCursor === undefined ||
		historyRequestCursor === undefined ||
		!syncedAt ||
		!Number.isFinite(syncedAt.getTime()) ||
		source.historyHasMore !== (historyCursor !== null)
	)
		return {};
	return {
		historyCursor,
		historyRequestCursor,
		historyHasMore: source.historyHasMore,
		historySyncedAt: syncedAt.toISOString()
	};
};

const ensureLiveConnection = async (
	things: any,
	ownerId: string,
	deviceId: string,
	connector: DeviceLiveConnectorContext,
	session: any
): Promise<void> => {
	const key = liveConnectionKey(ownerId, deviceId, connector.connectorId);
	const base = newThingDoc('ai-connection', {
		shareId: stableShareId('ai-live-connection', key),
		ownerId,
		uniqueKeys: [thingUniqueKey('aiConnectionKey', key)],
		crystal: {}
	});
	// `uniqueKeys` stays inside `$setOnInsert`: the filter is an equality on that
	// field, so MongoDB seeds the upserted document with the scalar key and
	// `$addToSet` would fail with "Cannot apply $addToSet to non-array field".
	const { crystal: _crystal, updatedAt: _updatedAt, ...root } = base;
	const now = new Date();
	await updateMessengerThing(
		things,
		thingUniqueKeyFilter('aiConnectionKey', key) as any,
		{
			$setOnInsert: root,
			$set: {
				'crystal.aiConnectionKey': key,
				'crystal.sourceType': 'live',
				'crystal.provider': connector.provider,
				'crystal.sourceId': connector.connectorId.slice(0, 64),
				'crystal.deviceId': deviceId,
				'crystal.connectorId': connector.connectorId,
				'crystal.label': connector.label,
				'crystal.connectors': [connector.connectorId],
				'crystal.capabilities': connector.capabilities,
				'crystal.mode': 'live',
				'crystal.status': 'connected',
				'crystal.readOnly': false,
				'crystal.lastSyncAt': now,
				updatedAt: now
			}
		} as any,
		{ messengerPlane: 'home', upsert: true, session }
	);
};

const ensureLiveMembership = async (things: any, ownerId: string, chatId: string, session: any): Promise<void> => {
	const memberKey = chatMemberKey(chatId, ownerId);
	const base = newThingDoc('chat-member', {
		ownerId,
		targetId: chatId,
		crystal: {
			memberKey,
			role: 'owner',
			state: 'active',
			requestOrigin: null,
			nickname: null,
			lastReadMessageId: null,
			lastReadAt: null,
			muted: false
		}
	});
	const { crystal: _crystal, updatedAt: _updatedAt, ...root } = base;
	await updateMessengerThing(
		things,
		{ 'crystal.memberKey': memberKey } as any,
		{
			$setOnInsert: {
				...root,
				'crystal.memberKey': memberKey,
				'crystal.role': 'owner',
				'crystal.state': 'active',
				'crystal.requestOrigin': null,
				'crystal.nickname': null,
				'crystal.lastReadMessageId': null,
				'crystal.lastReadAt': null,
				'crystal.muted': false
			},
			$set: {
				updatedAt: new Date()
			}
		} as any,
		{ messengerPlane: 'home', upsert: true, session }
	);
};

const upsertLiveSessions = async (
	things: any,
	ownerId: string,
	deviceId: string,
	connector: DeviceLiveConnectorContext,
	summaries: DeviceLiveSessionSummary[],
	session: any
): Promise<Extract<DeviceNodeLiveSyncResponse, { op: 'sessions.upsert' }>> => {
	const keys = summaries.map((summary) => liveChatKey(ownerId, deviceId, connector.connectorId, summary.sessionId));
	const existing = await things.find(thingUniqueKeysFilter('externalConversationKey', keys) as any, { session }).toArray();
	const existingByKey = new Map(existing.map((doc: any) => [String(doc.crystal?.externalConversationKey), doc]));
	const decisions = summaries.map((summary, index) => {
		const key = keys[index];
		const doc: any = existingByKey.get(key);
		const hash = devicePayloadHash(summary);
		const currentRevision = Number.isSafeInteger(doc?.crystal?.externalSource?.revision) ? Number(doc.crystal.externalSource.revision) : null;
		const currentHash = typeof doc?.crystal?.externalSource?.revisionHash === 'string' ? doc.crystal.externalSource.revisionHash : null;
		const decision = decideDeviceRevision(currentRevision, currentHash, summary.revision, hash);
		if (decision === 'stale') throw new DeviceLiveSyncError(409, `Session ${summary.sessionId} has a newer revision`);
		if (decision === 'conflict') throw new DeviceLiveSyncError(409, `Session ${summary.sessionId} reused a revision with different content`);
		return { summary, key, hash, doc, decision };
	});
	let accepted = 0;
	let idempotent = 0;
	const projected: Array<{ sessionId: string; chatId: string; revision: number }> = [];
	for (const entry of decisions) {
		const { summary, key, hash, doc, decision } = entry;
		if (decision === 'same') {
			idempotent += 1;
			projected.push({ sessionId: summary.sessionId, chatId: String(doc.shareId), revision: summary.revision });
			continue;
		}
		const source = liveSourceProjection(deviceId, connector, summary.sessionId, {
			revision: summary.revision,
			revisionHash: hash,
			state: summary.state,
			projectId: summary.projectId,
			projectLabel: summary.projectLabel,
			...preservedHistoryProgress(doc?.crystal?.externalSource)
		});
		const createdAt = safeDate(summary.createdAt);
		const updatedAt = safeDate(summary.updatedAt, createdAt);
		const base = newThingDoc('chat', {
			shareId: stableShareId('ai-live-chat', key),
			ownerId,
			uniqueKeys: [thingUniqueKey('externalConversationKey', key)],
			crystal: {}
		});
		base.createdAt = createdAt;
		const { crystal: _crystal, targetId: _targetId, updatedAt: _updatedAt, ...root } = base;
		await updateMessengerThing(
			things,
			thingUniqueKeyFilter('externalConversationKey', key) as any,
			{
				$setOnInsert: root,
				$set: {
					targetId: null,
					'crystal.chatType': 'group',
					'crystal.name': summary.title,
					'crystal.topic': summary.projectLabel ? `Live ${connector.label} session in ${summary.projectLabel}` : `Live ${connector.label} session`,
					'crystal.communityId': null,
					'crystal.sectionId': null,
					'crystal.channelVisibility': null,
					'crystal.dmKey': null,
					'crystal.externalConversationKey': key,
					'crystal.externalSource': source,
					updatedAt
				}
			} as any,
			{ messengerPlane: 'home', upsert: true, session }
		);
		const chat = await things.findOne(thingUniqueKeyFilter('externalConversationKey', key) as any, { session });
		if (!chat) throw new DeviceLiveSyncError(500, 'Live session materialization failed');
		await ensureLiveMembership(things, ownerId, String(chat.shareId), session);
		accepted += 1;
		projected.push({ sessionId: summary.sessionId, chatId: String(chat.shareId), revision: summary.revision });
	}
	return { ok: true, op: 'sessions.upsert', accepted, idempotent, sessions: projected };
};

const liveMessageRootKey = (ownerId: string, deviceId: string, connectorId: string, sessionId: string, messageId: string): string =>
	deviceHash('ai-live-message', liveScope(ownerId, deviceId, connectorId, sessionId), messageId);

const reconcileLiveMessages = async (
	things: any,
	ownerId: string,
	deviceId: string,
	connector: DeviceLiveConnectorContext,
	sessionId: string,
	messages: DeviceLiveMessageEnvelope[],
	session: any
): Promise<{ accepted: number; idempotent: number; segments: number }> => {
	if (!messages.length) return { accepted: 0, idempotent: 0, segments: 0 };
	const chatKey = liveChatKey(ownerId, deviceId, connector.connectorId, sessionId);
	const chat = await things.findOne(thingUniqueKeyFilter('externalConversationKey', chatKey) as any, { session });
	if (!chat) throw new DeviceLiveSyncError(409, 'The live session summary must be synced before its transcript');
	const chatId = String(chat.shareId);
	let accepted = 0;
	let idempotent = 0;
	let segments = 0;
	let newest: { doc: any; at: Date } | null = null;
	for (const message of messages) {
		const rootKey = liveMessageRootKey(ownerId, deviceId, connector.connectorId, sessionId, message.messageId);
		const existing = await things
			.find({ 'crystal.externalLiveMessageRootKey': rootKey } as any, { session })
			.sort({ 'crystal.externalSource.segmentIndex': 1 })
			.toArray();
		const first = existing[0] as any;
		const hash = liveTranscriptRevisionHash(message);
		const currentRevision = Number.isSafeInteger(first?.crystal?.externalSource?.revision) ? Number(first.crystal.externalSource.revision) : null;
		const currentHash = typeof first?.crystal?.externalSource?.revisionHash === 'string' ? first.crystal.externalSource.revisionHash : null;
		const decision = decideLiveTranscriptRevision(currentRevision, currentHash, message);
		if (decision === 'stale') throw new DeviceLiveSyncError(409, `Message ${message.messageId} has a newer revision`);
		if (decision === 'conflict') throw new DeviceLiveSyncError(409, `Message ${message.messageId} reused a revision with different content`);
		if (decision === 'same') {
			idempotent += 1;
			continue;
		}
		const parts = splitLiveMessageText(message.text, MAX_MESSAGE_CHARS);
		const createdAt = safeDate(message.createdAt || message.completedAt);
		for (const [segmentIndex, text] of parts.entries()) {
			const segmentKey = deviceHash('ai-live-message-segment', rootKey, String(segmentIndex));
			const source = liveSourceProjection(deviceId, connector, sessionId, {
				role: message.role,
				authorName: message.role === 'assistant' ? connector.label : null,
				messageId: message.messageId,
				revision: message.revision,
				revisionHash: hash,
				segmentIndex,
				segmentCount: parts.length
			});
			const base = newThingDoc('chat-message', {
				shareId: stableShareId('ai-live-message', segmentKey),
				ownerId,
				targetId: chatId,
				uniqueKeys: [thingUniqueKey('externalMessageKey', segmentKey)],
				crystal: {}
			});
			base.createdAt = createdAt;
			base.updatedAt = safeDate(message.completedAt, createdAt);
			const { crystal: _crystal, targetId: _targetId, updatedAt: _updatedAt, ...root } = base;
			await updateMessengerThing(
				things,
				thingUniqueKeyFilter('externalMessageKey', segmentKey) as any,
				{
					$setOnInsert: root,
					$set: {
						targetId: chatId,
						'crystal.text': text,
						'crystal.threadRootId': null,
						'crystal.replyToId': null,
						'crystal.editedAt': message.revision > 1 ? safeDate(message.completedAt) : null,
						'crystal.deletedAt': null,
						'crystal.systemType': null,
						'crystal.systemMeta': null,
						'crystal.externalMessageKey': segmentKey,
						'crystal.externalLiveMessageRootKey': rootKey,
						'crystal.externalSource': source,
						updatedAt: safeDate(message.completedAt, createdAt)
					}
				} as any,
				{ messengerPlane: 'home', upsert: true, session }
			);
			if (!newest || createdAt.getTime() >= newest.at.getTime()) {
				newest = {
					doc: { shareId: stableShareId('ai-live-message', segmentKey), crystal: { text, externalSource: source }, createdAt },
					at: createdAt
				};
			}
		}
		const staleIndexes = new Set(
			staleLiveSegmentIndexes(
				existing.map((doc: any) => Number(doc.crystal?.externalSource?.segmentIndex)),
				parts.length
			)
		);
		const staleKeys = existing
			.filter((doc: any) => staleIndexes.has(Number(doc.crystal?.externalSource?.segmentIndex)))
			.map((doc: any) => String(doc.crystal?.externalMessageKey || ''))
			.filter(Boolean);
		if (staleKeys.length) {
			await deleteMessengerThings(things, thingUniqueKeysFilter('externalMessageKey', staleKeys) as any, { messengerPlane: 'home', session });
		}
		accepted += 1;
		segments += parts.length;
	}
	if (newest) {
		const priorAt = chat.crystal?.lastMessage?.createdAt ? new Date(chat.crystal.lastMessage.createdAt).getTime() : Number.NEGATIVE_INFINITY;
		if (!Number.isFinite(priorAt) || newest.at.getTime() >= priorAt) {
			await updateMessengerThing(
				things,
				{ shareId: chatId, thingtime: 'chat' } as any,
				{
					$set: {
						'crystal.lastMessage': {
							id: newest.doc.shareId,
							authorId: ownerId,
							text: String(newest.doc.crystal.text).slice(0, 140),
							deleted: false,
							systemType: null,
							attachmentCount: 0,
							externalSource: newest.doc.crystal.externalSource,
							createdAt: newest.at.toISOString()
						},
						updatedAt: new Date()
					}
				},
				{ messengerPlane: 'home', session }
			);
		}
	}
	return { accepted, idempotent, segments };
};

const recordLiveTranscriptProgress = async (
	things: any,
	ownerId: string,
	deviceId: string,
	connectorId: string,
	sessionId: string,
	page: { cursor: string | null; nextCursor: string | null; hasMore: boolean },
	session: any
): Promise<void> => {
	const key = liveChatKey(ownerId, deviceId, connectorId, sessionId);
	const chat = await things.findOne(thingUniqueKeyFilter('externalConversationKey', key) as any, { session });
	if (!chat) throw new DeviceLiveSyncError(409, 'The live session summary must be synced before its transcript');
	const source = chat.crystal?.externalSource;
	const prior = preservedHistoryProgress(source);
	if (Object.keys(prior).length) {
		const priorRequestCursor = prior.historyRequestCursor as string | null;
		const priorNextCursor = prior.historyCursor as string | null;
		const priorHasMore = prior.historyHasMore === true;
		if (page.cursor === priorRequestCursor && page.nextCursor === priorNextCursor && page.hasMore === priorHasMore) return;
		if (!priorHasMore || page.cursor !== priorNextCursor) {
			throw new DeviceLiveSyncError(409, 'The transcript page does not continue the accepted history cursor');
		}
	} else if (page.cursor !== null) {
		throw new DeviceLiveSyncError(409, 'The first transcript page must start without a cursor');
	}
	const now = new Date();
	const result = await updateMessengerThing(
		things,
		{
			_id: chat._id,
			...(Object.keys(prior).length
				? {
						'crystal.externalSource.historyCursor': prior.historyCursor,
						'crystal.externalSource.historyRequestCursor': prior.historyRequestCursor,
						'crystal.externalSource.historyHasMore': prior.historyHasMore,
						'crystal.externalSource.historySyncedAt': prior.historySyncedAt
				  }
				: { 'crystal.externalSource.historySyncedAt': { $exists: false } })
		} as any,
		{
			$set: {
				'crystal.externalSource.historyCursor': page.nextCursor,
				'crystal.externalSource.historyRequestCursor': page.cursor,
				'crystal.externalSource.historyHasMore': page.hasMore,
				'crystal.externalSource.historySyncedAt': now.toISOString(),
				updatedAt: now
			}
		} as any,
		{ messengerPlane: 'home', session }
	);
	if (!result?.modifiedCount) throw new DeviceLiveSyncError(409, 'The transcript history cursor changed concurrently; retry');
};

const reconcileLiveActivities = async (
	things: any,
	ownerId: string,
	deviceId: string,
	connectorId: string,
	sessionId: string,
	activities: DeviceLiveTranscriptActivity[],
	session: any
): Promise<{ accepted: number; idempotent: number }> => {
	if (!activities.length) return { accepted: 0, idempotent: 0 };
	const chatKey = liveChatKey(ownerId, deviceId, connectorId, sessionId);
	const chat = await things.findOne(thingUniqueKeyFilter('externalConversationKey', chatKey) as any, { session });
	if (!chat) throw new DeviceLiveSyncError(409, 'The live session summary must be synced before its activity');
	let accepted = 0;
	let idempotent = 0;
	const controlScopeKey = deviceControlEventScopeKey(ownerId, deviceId);
	const liveControlScopeKey = liveScope(ownerId, deviceId, connectorId, sessionId);
	for (const activity of activities) {
		const eventKey = deviceHash(
			'ai-live-history-activity',
			liveScope(ownerId, deviceId, connectorId, sessionId),
			activity.turnId,
			activity.activityId
		);
		const hash = liveTranscriptActivityRevisionHash(activity);
		const existing = await things.findOne(thingUniqueKeyFilter('deviceUniqueKey', eventKey) as any, { session });
		const currentRevision = Number.isSafeInteger(existing?.crystal?.revision) ? Number(existing.crystal.revision) : null;
		const currentHash = typeof existing?.crystal?.liveActivityHash === 'string' ? existing.crystal.liveActivityHash : null;
		const decision = decideLiveTranscriptActivityRevision(currentRevision, currentHash, activity);
		if (decision === 'stale') throw new DeviceLiveSyncError(409, `Activity ${activity.activityId} has a newer revision`);
		if (decision === 'conflict') throw new DeviceLiveSyncError(409, `Activity ${activity.activityId} reused a revision with different content`);
		if (decision === 'same') {
			idempotent += 1;
			continue;
		}
		const payload = {
			connectorId,
			sessionId,
			activityId: activity.activityId,
			revision: activity.revision,
			turnId: activity.turnId,
			activity: activity.activity,
			label: activity.label,
			status: activity.status,
			observedAt: activity.observedAt
		};
		const retainedBytes = liveControlRetainedBytes('ai.session-activity', sessionId, activity.revision, payload);
		if (retainedBytes > DEVICE_LIVE_CONTROL_EVENT_MAX_BYTES) {
			throw new DeviceLiveSyncError(413, 'One live activity exceeds the strict control-plane byte budget');
		}
		const expiresAt = new Date(Date.now() + DEVICE_LIVE_CONTROL_EVENT_RETENTION_MS);
		if (existing) {
			const changed = await things.updateOne(
				{
					_id: existing._id,
					'crystal.revision': currentRevision,
					'crystal.liveActivityHash': currentHash
				} as any,
				{
					$set: {
						'crystal.liveActivityHash': hash,
						'crystal.revision': activity.revision,
						'crystal.payload': payload,
						'crystal.deviceControlEventScopeKey': controlScopeKey,
						'crystal.liveControlEventScopeKey': liveControlScopeKey,
						'crystal.retainedBytes': retainedBytes,
						'crystal.expiresAt': expiresAt,
						'crystal.deviceTtlAt': expiresAt,
						updatedAt: new Date()
					}
				},
				{ session }
			);
			if (!changed.modifiedCount) throw new DeviceLiveSyncError(409, 'Live activity changed concurrently; retry');
		} else {
			await things.insertOne(
				newDeviceThing('device-command-event', {
					ownerId,
					targetId: deviceId,
					control: true,
					crystal: {
						deviceEventKey: eventKey,
						deviceControlEventScopeKey: controlScopeKey,
						liveControlEventScopeKey: liveControlScopeKey,
						retainedBytes,
						liveActivityHash: hash,
						eventType: 'ai.session-activity',
						resourceId: sessionId,
						revision: activity.revision,
						payload,
						expiresAt,
						deviceTtlAt: expiresAt
					}
				}),
				{ session }
			);
		}
		accepted += 1;
	}
	await pruneLiveControlEvents(things, ownerId, deviceId, connectorId, sessionId, session);
	return { accepted, idempotent };
};

const liveEventPayload = (connectorId: string, sessionId: string, event: DeviceLiveConnectorEvent) => {
	let payload: Record<string, unknown> = event.payload;
	if (event.type === 'message.queued' || event.type === 'message.submitted') {
		payload = { ...event.payload, text: visibleControlText(event.payload.text) };
	} else if (event.type === 'item.started' || event.type === 'item.completed') {
		payload = {
			item: event.payload.item.type === 'activity' ? event.payload.item : { ...event.payload.item, text: visibleControlText(event.payload.item.text) }
		};
	}
	return {
		connectorId,
		sessionId,
		sequence: event.sequence,
		observedAt: event.observedAt,
		turnId: event.turnId,
		itemId: event.itemId,
		type: event.type,
		payload
	};
};

const appendLiveEvents = async (
	things: any,
	ownerId: string,
	deviceId: string,
	connectorId: string,
	sessionId: string,
	events: DeviceLiveConnectorEvent[],
	session: any
): Promise<{
	accepted: number;
	replayed: number;
	reconciled: number;
	lastSequence: number;
	materializableEvents: DeviceLiveConnectorEvent[];
}> => {
	const stateKey = deviceHash('ai-live-state', ownerId, deviceId, connectorId, sessionId);
	const state = await things.findOne(thingUniqueKeyFilter('deviceUniqueKey', stateKey) as any, { session });
	const initialLast = Number.isSafeInteger(state?.crystal?.lastSequence) ? Number(state.crystal.lastSequence) : 0;
	let deltaGuardTails: DeviceLiveDeltaGuardTail[];
	if (state && Object.prototype.hasOwnProperty.call(state.crystal ?? {}, 'deltaGuardTails')) {
		const persisted = normalizeDeviceLiveDeltaGuardTails(state.crystal.deltaGuardTails);
		if (!persisted) throw new DeviceLiveSyncError(409, 'The persisted live delta guard state is invalid');
		deltaGuardTails = persisted;
	} else {
		deltaGuardTails = state ? await rebuildDeltaGuardTails(things, ownerId, deviceId, connectorId, sessionId, session) : [];
	}
	let expected = initialLast + 1;
	let accepted = 0;
	let replayed = 0;
	let reconciled = 0;
	const materializableEvents: DeviceLiveConnectorEvent[] = [];
	const controlScopeKey = deviceControlEventScopeKey(ownerId, deviceId);
	const liveControlScopeKey = liveScope(ownerId, deviceId, connectorId, sessionId);
	for (const event of events) {
		const payload = liveEventPayload(connectorId, sessionId, event);
		const eventHash = devicePayloadHash({ connectorId, sessionId, event });
		const eventKey = deviceHash('event', ownerId, deviceId, `ai:${connectorId}:${sessionId}:${event.eventId}`);
		const sequenceKey = deviceHash('ai-live-sequence', ownerId, deviceId, connectorId, sessionId, String(event.sequence));
		if (event.sequence <= initialLast) {
			const prior = await things.findOne(thingUniqueKeysFilter('deviceUniqueKey', [eventKey, sequenceKey]) as any, {
				session
			});
			const receipt = !prior
				? 'missing'
				: prior.crystal?.deviceEventKey === eventKey &&
				  prior.crystal?.liveEventSequenceKey === sequenceKey &&
				  prior.crystal?.liveEventHash === eventHash
				? 'matching'
				: 'conflicting';
			const replayDecision = decideDeviceLiveReplay(event.sequence, initialLast, receipt);
			if (replayDecision === 'conflict') {
				throw new DeviceLiveSyncError(409, `Live event sequence ${event.sequence} is stale or conflicts with accepted history`);
			}
			if (replayDecision === 'replay') {
				replayed += 1;
				materializableEvents.push(event);
			} else {
				reconciled += 1;
			}
			continue;
		}
		if (event.sequence !== expected) {
			throw new DeviceLiveSyncError(409, `Live event sequence ${expected} is required before ${event.sequence}`);
		}
		const conflict = await things.findOne(thingUniqueKeysFilter('deviceUniqueKey', [eventKey, sequenceKey]) as any, {
			session
		});
		if (conflict) throw new DeviceLiveSyncError(409, `Live event ${event.eventId} conflicts with accepted history`);
		deltaGuardTails = applyDeltaGuardEvent(deltaGuardTails, deltaGuardEvent(event));
		const retainedBytes = liveControlRetainedBytes('ai.session-event', sessionId, event.sequence, payload);
		if (retainedBytes > DEVICE_LIVE_CONTROL_EVENT_MAX_BYTES) {
			throw new DeviceLiveSyncError(413, 'One live event exceeds the strict control-plane byte budget');
		}
		const expiresAt = new Date(Date.now() + DEVICE_LIVE_CONTROL_EVENT_RETENTION_MS);
		const row = newDeviceThing('device-command-event', {
			ownerId,
			targetId: deviceId,
			control: true,
			crystal: {
				deviceEventKey: eventKey,
				deviceControlEventScopeKey: controlScopeKey,
				liveControlEventScopeKey: liveControlScopeKey,
				liveEventSequenceKey: sequenceKey,
				liveEventHash: eventHash,
				eventType: 'ai.session-event',
				resourceId: sessionId,
				revision: event.sequence,
				payload,
				retainedBytes,
				expiresAt,
				deviceTtlAt: expiresAt
			}
		});
		await things.insertOne(row, { session });
		accepted += 1;
		materializableEvents.push(event);
		expected += 1;
	}
	const lastSequence = Math.max(initialLast, expected - 1);
	if (accepted) {
		if (state) {
			const changed = await things.updateOne(
				{ _id: state._id, 'crystal.lastSequence': initialLast } as any,
				{
					$set: {
						'crystal.lastSequence': lastSequence,
						'crystal.lastObservedAt': events[events.length - 1]!.observedAt,
						'crystal.deltaGuardTails': deltaGuardTails,
						updatedAt: new Date()
					}
				},
				{ session }
			);
			if (!changed.modifiedCount) throw new DeviceLiveSyncError(409, 'Live event cursor changed concurrently; retry');
		} else {
			await things.insertOne(
				newDeviceThing('device-ai-live-state', {
					ownerId,
					targetId: deviceId,
					control: true,
					crystal: {
						deviceAiLiveStateKey: stateKey,
						connectorId,
						sessionId,
						lastSequence,
						lastObservedAt: events[events.length - 1]!.observedAt,
						deltaGuardTails
					}
				}),
				{ session }
			);
		}
	}
	await pruneLiveControlEvents(things, ownerId, deviceId, connectorId, sessionId, session);
	return { accepted, replayed, reconciled, lastSequence, materializableEvents };
};

const redactSubmittedCommandInputs = async (
	things: any,
	ownerId: string,
	deviceId: string,
	connectorId: string,
	sessionId: string,
	events: DeviceLiveConnectorEvent[],
	session: any
): Promise<void> => {
	const submitted = new Map(
		events
			.filter((event) => event.type === 'message.submitted')
			.map((event) => [event.type === 'message.submitted' ? event.payload.commandId : '', event])
	);
	for (const [commandId, event] of submitted) {
		if (!commandId || event.type !== 'message.submitted') continue;
		const command = await things.findOne(
			{
				shareId: commandId,
				thingtime: 'device-command',
				ownerId,
				targetId: deviceId,
				'crystal.kind': 'session.send',
				'crystal.input.connectorId': connectorId,
				'crystal.input.sessionId': sessionId
			} as any,
			{ session }
		);
		if (!command) continue;
		const currentText = typeof command.crystal?.input?.text === 'string' ? command.crystal.input.text : '';
		if (currentText && currentText !== event.message.text) {
			throw new DeviceLiveSyncError(409, `Submitted message ${commandId} does not match its dispatched command`);
		}
		if (!currentText) {
			if (typeof command.crystal?.inputTextHash === 'string' && command.crystal.inputTextHash !== devicePayloadHash(event.message.text)) {
				throw new DeviceLiveSyncError(409, `Submitted message ${commandId} conflicts with its redacted command`);
			}
			continue;
		}
		await things.updateOne(
			{ _id: command._id, 'crystal.input.text': currentText } as any,
			{
				$set: {
					'crystal.input.text': '',
					'crystal.inputTextHash': devicePayloadHash(currentText),
					'crystal.inputRedactedAt': new Date(),
					'crystal.controlBytes': deviceControlEventLogicalBytes({
						kind: 'session.send',
						input: { ...command.crystal.input, text: '' }
					}),
					updatedAt: new Date()
				}
			},
			{ session }
		);
	}
};

export const syncDeviceLiveAi = async (
	ownerId: string,
	deviceId: string,
	connector: DeviceLiveConnectorContext,
	input: unknown
): Promise<Fail | DeviceFail | DeviceNodeLiveSyncResponse> => {
	const normalized = normalizeDeviceNodeLiveSyncRequest(input);
	if (normalized.ok === false) return normalized;
	if (normalized.request.connectorId !== connector.connectorId)
		return fail(409, 'The live connector does not match the authenticated device connector');
	const things = await getHomeThingsCollection();
	try {
		return await withMessengerStorageTransaction(async (session) => {
			const [currentConnector, currentState] = await Promise.all([
				things.findOne(
					{
						thingtime: 'device-connector',
						ownerId,
						targetId: deviceId,
						'crystal.connector.id': connector.connectorId,
						'crystal.connector.status': { $in: ['connected', 'degraded'] }
					} as any,
					{ session }
				),
				things.findOne({ thingtime: 'device-state', ownerId, targetId: deviceId } as any, { projection: { 'crystal.revision': 1 }, session })
			]);
			if (
				!currentConnector ||
				!deviceConnectorIsFresh(currentConnector) ||
				currentConnector.crystal?.revision !== connector.revision ||
				currentConnector.crystal?.connectorHash !== connector.connectorHash ||
				currentState?.crystal?.revision !== connector.revision
			) {
				throw new DeviceLiveSyncError(409, 'The authenticated connector snapshot changed or became stale');
			}
			await ensureLiveConnection(things, ownerId, deviceId, connector, session);
			if (normalized.request.op === 'sessions.upsert') {
				return upsertLiveSessions(things, ownerId, deviceId, connector, normalized.request.sessions, session);
			}
			if (normalized.request.op === 'transcript.page') {
				const transcriptMessages = normalized.request.entries
					.filter((entry) => entry.type === 'message')
					.map(({ type: _type, ...message }) => message);
				const transcriptActivities = normalized.request.entries.filter((entry): entry is DeviceLiveTranscriptActivity => entry.type === 'activity');
				const result = await reconcileLiveMessages(things, ownerId, deviceId, connector, normalized.request.sessionId, transcriptMessages, session);
				const activityResult = await reconcileLiveActivities(
					things,
					ownerId,
					deviceId,
					connector.connectorId,
					normalized.request.sessionId,
					transcriptActivities,
					session
				);
				await recordLiveTranscriptProgress(
					things,
					ownerId,
					deviceId,
					connector.connectorId,
					normalized.request.sessionId,
					normalized.request.page,
					session
				);
				return {
					ok: true,
					op: 'transcript.page',
					accepted: result.accepted,
					idempotent: result.idempotent,
					messageSegments: result.segments,
					acceptedActivities: activityResult.accepted,
					idempotentActivities: activityResult.idempotent,
					nextCursor: normalized.request.page.nextCursor,
					hasMore: normalized.request.page.hasMore
				};
			}
			const events = await appendLiveEvents(
				things,
				ownerId,
				deviceId,
				connector.connectorId,
				normalized.request.sessionId,
				normalized.request.events,
				session
			);
			const materialized = deviceLiveMaterializedMessages(events.materializableEvents);
			const messages = await reconcileLiveMessages(things, ownerId, deviceId, connector, normalized.request.sessionId, materialized, session);
			await redactSubmittedCommandInputs(
				things,
				ownerId,
				deviceId,
				connector.connectorId,
				normalized.request.sessionId,
				events.materializableEvents,
				session
			);
			return {
				ok: true,
				op: 'events.append',
				acceptedEvents: events.accepted,
				replayedEvents: events.replayed,
				reconciledEvents: events.reconciled,
				materializedMessages: messages.accepted,
				idempotentMessages: messages.idempotent,
				messageSegments: messages.segments,
				lastSequence: events.lastSequence
			};
		}, 'home');
	} catch (error: any) {
		if (error instanceof DeviceLiveSyncError || Number.isInteger(error?.status)) {
			return fail(Number(error.status) || 409, String(error.message || 'Live sync conflict'));
		}
		if (error?.code === 11000) return fail(409, 'Live sync raced with another accepted revision; retry');
		throw error;
	}
};
