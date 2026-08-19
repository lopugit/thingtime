import assert from 'node:assert/strict';
import test from 'node:test';

import { publicExternalAiSource } from '../messenger/externalAi.ts';
import {
	advanceDeviceLiveDeltaGuardTails,
	DEVICE_LIVE_MAX_DELTA_GUARD_TAILS,
	deviceLiveExternalNamespace,
	deviceLiveMaterializedMessages,
	deviceLiveProviderForConnectorKind,
	decideDeviceLiveReplay,
	decideLiveTranscriptActivityRevision,
	decideLiveTranscriptRevision,
	liveTranscriptActivityRevisionHash,
	liveTranscriptRevisionHash,
	nextDeviceLiveDeltaGuardTail,
	normalizeDeviceLiveDeltaGuardTails,
	normalizeDeviceNodeLiveSyncRequest,
	splitLiveMessageText,
	staleLiveSegmentIndexes
} from './deviceLiveAiCore.ts';

test('live connector provider allowlist includes the native Claude AX kind', () => {
	assert.equal(deviceLiveProviderForConnectorKind('claude-thingtime'), 'claude');
	assert.equal(deviceLiveProviderForConnectorKind('codex'), 'chatgpt');
	assert.equal(deviceLiveProviderForConnectorKind('arbitrary-shell'), null);
});

test('live external namespaces include device, connector and session identity', () => {
	const base = deviceLiveExternalNamespace('owner', 'device-a', 'chatgpt', 'session-a');
	assert.notEqual(base, deviceLiveExternalNamespace('owner', 'device-b', 'chatgpt', 'session-a'));
	assert.notEqual(base, deviceLiveExternalNamespace('owner', 'device-a', 'claude', 'session-a'));
	assert.notEqual(base, deviceLiveExternalNamespace('owner', 'device-a', 'chatgpt', 'session-b'));
});

test('session summaries accept opaque project identity but reject every unknown path field', () => {
	const accepted = normalizeDeviceNodeLiveSyncRequest({
		op: 'sessions.upsert',
		connectorId: 'chatgpt-desktop',
		sessions: [
			{
				sessionId: 'session-1',
				revision: 2,
				title: 'Thingtime',
				projectId: 'project-1',
				projectLabel: 'Thingtime',
				state: 'running',
				updatedAt: '2026-08-18T01:00:00.000Z'
			}
		]
	});
	assert.equal(accepted.ok, true);
	const rejected = normalizeDeviceNodeLiveSyncRequest({
		op: 'sessions.upsert',
		connectorId: 'chatgpt-desktop',
		sessions: [{ sessionId: 'session-1', revision: 2, title: 'Thingtime', state: 'running', projectPath: '/Users/private' }]
	});
	assert.equal(rejected.ok, false);
});

test('transcript pages preserve visible message text and accept revisioned safe activity', () => {
	const accepted = normalizeDeviceNodeLiveSyncRequest({
		op: 'transcript.page',
		connectorId: 'chatgpt-desktop',
		sessionId: 'session-1',
		page: { cursor: null, nextCursor: 'opaque/page+2==', hasMore: true },
		entries: [
			{
				type: 'message',
				messageId: 'message-1',
				revision: 1,
				role: 'assistant',
				text: ' Review permissions. ',
				createdAt: null,
				completedAt: '2026-08-18T01:00:00.000Z'
			},
			{
				type: 'activity',
				activityId: 'activity-1',
				revision: 2,
				turnId: 'turn-1',
				activity: 'command',
				label: 'Command execution',
				status: 'completed',
				observedAt: '2026-08-18T01:00:01.000Z'
			}
		]
	});
	assert.equal(accepted.ok, true);
	assert.equal(
		accepted.ok && accepted.request.op === 'transcript.page'
			? accepted.request.entries[0]?.type === 'message' && accepted.request.entries[0].text
			: null,
		' Review permissions. '
	);
	const system = normalizeDeviceNodeLiveSyncRequest({
		op: 'transcript.page',
		connectorId: 'chatgpt-desktop',
		sessionId: 'session-1',
		page: { cursor: null, nextCursor: null, hasMore: false },
		entries: [{ type: 'message', messageId: 'message-1', revision: 1, role: 'system', text: 'hidden prompt', createdAt: null, completedAt: null }]
	});
	assert.equal(system.ok, false);
	const privateActivity = normalizeDeviceNodeLiveSyncRequest({
		op: 'transcript.page',
		connectorId: 'chatgpt-desktop',
		sessionId: 'session-1',
		page: { cursor: null, nextCursor: null, hasMore: false },
		entries: [
			{
				type: 'activity',
				activityId: 'activity-1',
				revision: 1,
				turnId: 'turn-1',
				activity: 'file-change',
				label: 'File change',
				status: 'completed',
				observedAt: null,
				path: '/Users/private'
			}
		]
	});
	assert.equal(privateActivity.ok, false);
	const internalContext = normalizeDeviceNodeLiveSyncRequest({
		op: 'transcript.page',
		connectorId: 'chatgpt-desktop',
		sessionId: 'session-1',
		page: { cursor: null, nextCursor: null, hasMore: false },
		entries: [
			{
				type: 'message',
				messageId: 'message-private',
				revision: 1,
				role: 'user',
				text: 'visible prefix <environment_context>private execution context</environment_context>',
				createdAt: null,
				completedAt: '2026-08-18T01:00:00.000Z'
			}
		]
	});
	assert.equal(internalContext.ok, false);
});

test('completed-message revisions replay exactly and identify refundable trailing segments', () => {
	const message = {
		messageId: 'message-1',
		revision: 2,
		role: 'assistant' as const,
		text: 'shorter',
		createdAt: null,
		completedAt: '2026-08-18T01:00:00.000Z'
	};
	const hash = liveTranscriptRevisionHash(message);
	assert.equal(decideLiveTranscriptRevision(2, hash, message), 'same');
	assert.equal(decideLiveTranscriptRevision(3, 'newer', message), 'stale');
	assert.equal(decideLiveTranscriptRevision(2, 'different', message), 'conflict');
	assert.equal(decideLiveTranscriptRevision(1, 'older', message), 'update');
	assert.deepEqual(staleLiveSegmentIndexes([0, 1, 2, 3], 2), [2, 3]);
	const activity = {
		type: 'activity' as const,
		activityId: 'activity-1',
		revision: 3,
		turnId: 'turn-1',
		activity: 'plan' as const,
		label: 'Plan updated',
		status: 'completed',
		observedAt: null
	};
	const activityHash = liveTranscriptActivityRevisionHash(activity);
	assert.equal(decideLiveTranscriptActivityRevision(3, activityHash, activity), 'same');
	assert.equal(decideLiveTranscriptActivityRevision(4, 'newer', activity), 'stale');
});

test('live message segmentation preserves every boundary space and code point', () => {
	const value = ' leading words  and trailing ';
	const parts = splitLiveMessageText(value, 9);
	assert.equal(parts.join(''), value);
	assert.ok(parts.every((part) => Array.from(part).length <= 9));
	assert.equal(splitLiveMessageText('🙂 🙂', 2).join(''), '🙂 🙂');
});

test('live events are contiguous and expose only visible deltas or safe activity', () => {
	const accepted = normalizeDeviceNodeLiveSyncRequest({
		op: 'events.append',
		connectorId: 'chatgpt-desktop',
		sessionId: 'session-1',
		events: [
			{
				eventId: 'event-1',
				sequence: 1,
				observedAt: '2026-08-18T01:00:00.000Z',
				turnId: 'turn-1',
				itemId: 'item-1',
				type: 'message.delta',
				payload: { delta: ' ' }
			},
			{
				eventId: 'event-2',
				sequence: 2,
				observedAt: '2026-08-18T01:00:01.000Z',
				turnId: 'turn-1',
				itemId: null,
				type: 'connector.warning',
				payload: { message: 'Connection is recovering' }
			}
		]
	});
	assert.equal(accepted.ok, true);
	const firstEvent = accepted.ok && accepted.request.op === 'events.append' ? accepted.request.events[0] : null;
	assert.equal(firstEvent?.type === 'message.delta' ? firstEvent.payload.delta : null, ' ');
	for (const payload of [
		{ delta: 'visible', reasoning: 'private chain' },
		{ delta: '\u0000' },
		{ toolInput: { path: '/Users/private' } },
		{ path: '/Users/private' }
	]) {
		const result = normalizeDeviceNodeLiveSyncRequest({
			op: 'events.append',
			connectorId: 'chatgpt-desktop',
			sessionId: 'session-1',
			events: [
				{
					eventId: 'event-1',
					sequence: 1,
					observedAt: '2026-08-18T01:00:00.000Z',
					turnId: 'turn-1',
					itemId: 'item-1',
					type: 'message.delta',
					payload
				}
			]
		});
		assert.equal(result.ok, false);
	}
	const gap = normalizeDeviceNodeLiveSyncRequest({
		op: 'events.append',
		connectorId: 'chatgpt-desktop',
		sessionId: 'session-1',
		events: [
			{
				eventId: 'event-1',
				sequence: 1,
				observedAt: '2026-08-18T01:00:00.000Z',
				turnId: 'turn-1',
				itemId: null,
				type: 'turn.started',
				payload: { turn: { id: 'turn-1', status: 'inProgress' } }
			},
			{
				eventId: 'event-3',
				sequence: 3,
				observedAt: '2026-08-18T01:00:02.000Z',
				turnId: 'turn-1',
				itemId: null,
				type: 'turn.completed',
				payload: { turn: { id: 'turn-1', status: 'completed' } }
			}
		]
	});
	assert.equal(gap.ok, false);
});

test('rejects complete and split internal context from live deltas and items', () => {
	const envelope = (events: unknown[]) => ({
		op: 'events.append',
		connectorId: 'chatgpt-desktop',
		sessionId: 'session-1',
		events
	});
	const delta = (sequence: number, value: string) => ({
		eventId: `event-${sequence}`,
		sequence,
		observedAt: `2026-08-18T01:00:0${sequence}.000Z`,
		turnId: 'turn-1',
		itemId: 'item-1',
		type: 'message.delta',
		payload: { delta: value }
	});
	assert.equal(normalizeDeviceNodeLiveSyncRequest(envelope([delta(1, '<environment_context>private')])).ok, false);
	assert.equal(normalizeDeviceNodeLiveSyncRequest(envelope([delta(1, '<environ'), delta(2, 'ment_context>private')])).ok, false);
	const firstTail = nextDeviceLiveDeltaGuardTail('', '<environ');
	assert.equal(typeof firstTail, 'string');
	assert.equal(nextDeviceLiveDeltaGuardTail(firstTail || '', 'ment_context>private'), null);
	assert.equal(
		normalizeDeviceNodeLiveSyncRequest(
			envelope([
				{
					eventId: 'event-1',
					sequence: 1,
					observedAt: '2026-08-18T01:00:01.000Z',
					turnId: 'turn-1',
					itemId: 'item-1',
					type: 'item.completed',
					payload: { item: { id: 'item-1', type: 'agentMessage', text: '<skills_instructions>private' } }
				}
			])
		).ok,
		false
	);
});

test('persists bounded per-item delta guard tails across requests and clears terminal streams', () => {
	const first = advanceDeviceLiveDeltaGuardTails([], {
		type: 'message.delta',
		itemId: 'item-1',
		turnId: 'turn-1',
		delta: '<environ'
	});
	assert.equal(first.ok, true);
	const persisted = normalizeDeviceLiveDeltaGuardTails(first.ok ? JSON.parse(JSON.stringify(first.tails)) : null);
	assert.ok(persisted);
	const blocked = advanceDeviceLiveDeltaGuardTails(persisted || [], {
		type: 'message.delta',
		itemId: 'item-1',
		turnId: 'turn-1',
		delta: 'ment_context>private'
	});
	assert.deepEqual(blocked, { ok: false, reason: 'internal-context' });

	const completed = advanceDeviceLiveDeltaGuardTails(first.ok ? first.tails : [], {
		type: 'item.completed',
		itemId: 'item-1',
		turnId: 'turn-1'
	});
	assert.deepEqual(completed, { ok: true, tails: [] });
	assert.equal(normalizeDeviceLiveDeltaGuardTails([{ itemId: 'item-1', turnId: 'turn-1', tail: '<skills_instructions>' }]), null);
});

test('delta guard state enforces a strict active-stream cap', () => {
	let tails: Array<{ itemId: string; turnId: string | null; tail: string }> = [];
	for (let index = 0; index < DEVICE_LIVE_MAX_DELTA_GUARD_TAILS; index += 1) {
		const next = advanceDeviceLiveDeltaGuardTails(tails, {
			type: 'message.delta',
			itemId: `item-${index}`,
			turnId: 'turn-1',
			delta: 'visible'
		});
		assert.equal(next.ok, true);
		if (next.ok) tails = next.tails;
	}
	assert.deepEqual(
		advanceDeviceLiveDeltaGuardTails(tails, {
			type: 'message.delta',
			itemId: 'overflow',
			turnId: 'turn-1',
			delta: 'visible'
		}),
		{ ok: false, reason: 'capacity' }
	);
	const cleared = advanceDeviceLiveDeltaGuardTails(tails, {
		type: 'turn.completed',
		itemId: null,
		turnId: 'turn-1'
	});
	assert.deepEqual(cleared, { ok: true, tails: [] });
});

test('approval expiry is a closed server-compatible cancellation event', () => {
	const event = (payload: Record<string, unknown>) =>
		normalizeDeviceNodeLiveSyncRequest({
			op: 'events.append',
			connectorId: 'codex-app-server',
			sessionId: 'session-1',
			events: [
				{
					eventId: 'event-1',
					sequence: 1,
					observedAt: '2026-08-18T01:00:00.000Z',
					turnId: 'turn-1',
					itemId: 'item-1',
					type: 'approval.responded',
					payload
				}
			]
		});
	const expired = event({ requestId: 'approval-1', decision: 'cancel', reason: 'expired' });
	assert.equal(expired.ok, true);
	assert.deepEqual(expired.ok && expired.request.op === 'events.append' ? expired.request.events[0]?.payload : null, {
		requestId: 'approval-1',
		decision: 'cancel',
		reason: 'expired'
	});
	assert.equal(event({ requestId: 'approval-1', decision: 'accept', reason: 'expired' }).ok, false);
	assert.equal(event({ requestId: 'approval-1', decision: 'cancel', reason: 'expired', commandId: 'unexpected' }).ok, false);
});

test('expired live receipts reconcile only behind the durable cursor and never reapply payloads', () => {
	assert.equal(decideDeviceLiveReplay(4, 3, 'missing'), 'new');
	assert.equal(decideDeviceLiveReplay(3, 3, 'matching'), 'replay');
	assert.equal(decideDeviceLiveReplay(2, 3, 'conflicting'), 'conflict');
	assert.equal(decideDeviceLiveReplay(1, 3, 'missing'), 'reconcile');
});

test('submitted and completed live events carry revisioned durable message envelopes', () => {
	const result = normalizeDeviceNodeLiveSyncRequest({
		op: 'events.append',
		connectorId: 'chatgpt-desktop',
		sessionId: 'session-1',
		events: [
			{
				eventId: 'event-1',
				sequence: 1,
				observedAt: '2026-08-18T01:00:00.000Z',
				turnId: 'turn-1',
				itemId: null,
				type: 'message.submitted',
				payload: { commandId: 'command-1', mode: 'queue', text: ' Please run it. ' },
				message: {
					messageId: 'command-1',
					revision: 1,
					role: 'user',
					text: ' Please run it. ',
					createdAt: '2026-08-18T01:00:00.000Z',
					completedAt: '2026-08-18T01:00:00.000Z'
				}
			},
			{
				eventId: 'event-2',
				sequence: 2,
				observedAt: '2026-08-18T01:00:01.000Z',
				turnId: 'turn-1',
				itemId: 'message-1',
				type: 'item.completed',
				payload: { item: { id: 'message-1', type: 'agentMessage', text: ' Complete. ' } },
				message: {
					messageId: 'message-1',
					revision: 3,
					role: 'assistant',
					text: ' Complete. ',
					createdAt: null,
					completedAt: '2026-08-18T01:00:01.000Z'
				}
			}
		]
	});
	assert.equal(result.ok, true);
	assert.deepEqual(
		result.ok && result.request.op === 'events.append'
			? deviceLiveMaterializedMessages(result.request.events).map((message) => [message.messageId, message.role, message.text])
			: [],
		[
			['command-1', 'user', ' Please run it. '],
			['message-1', 'assistant', ' Complete. ']
		]
	);
});

test('safe item activity is accepted but raw tool IO and paths are rejected', () => {
	const accepted = normalizeDeviceNodeLiveSyncRequest({
		op: 'events.append',
		connectorId: 'chatgpt-desktop',
		sessionId: 'session-1',
		events: [
			{
				eventId: 'event-1',
				sequence: 1,
				observedAt: '2026-08-18T01:00:00.000Z',
				turnId: 'turn-1',
				itemId: 'item-1',
				type: 'item.started',
				payload: { item: { id: 'item-1', type: 'activity', activity: 'commandExecution', label: 'Command execution', status: 'inProgress' } }
			}
		]
	});
	assert.equal(accepted.ok, true);
	const rejected = normalizeDeviceNodeLiveSyncRequest({
		op: 'events.append',
		connectorId: 'chatgpt-desktop',
		sessionId: 'session-1',
		events: [
			{
				eventId: 'event-1',
				sequence: 1,
				observedAt: '2026-08-18T01:00:00.000Z',
				turnId: 'turn-1',
				itemId: 'item-1',
				type: 'item.started',
				payload: {
					item: {
						id: 'item-1',
						type: 'activity',
						activity: 'commandExecution',
						label: 'Command execution',
						status: 'inProgress',
						toolInput: { path: '/Users/private' }
					}
				}
			}
		]
	});
	assert.equal(rejected.ok, false);
});

test('public external AI projection remains backward-compatible and discriminates live mirrors', () => {
	assert.deepEqual(publicExternalAiSource({ provider: 'chatgpt', sourceId: 'export', label: 'ChatGPT', connector: 'file', readOnly: true }), {
		access: 'imported',
		provider: 'chatgpt',
		sourceId: 'export',
		label: 'ChatGPT',
		connector: 'file',
		readOnly: true
	});
	const live = publicExternalAiSource({
		access: 'live',
		provider: 'chatgpt',
		sourceId: 'chatgpt-desktop',
		label: 'ChatGPT',
		connector: 'chatgpt-desktop',
		deviceId: 'device-1',
		connectorId: 'chatgpt-desktop',
		sessionId: 'session-1',
		capabilities: ['send-message', 'explicit-approval'],
		projectId: 'project-1',
		projectLabel: 'Thingtime',
		readOnly: false
	});
	assert.equal(live?.access, 'live');
	assert.equal(live?.readOnly, false);
	assert.equal(live && live.access === 'live' ? live.projectLabel : null, 'Thingtime');
	assert.deepEqual(live && live.access === 'live' ? live.capabilities : [], ['send-message', 'explicit-approval']);
	const noPath = publicExternalAiSource({
		access: 'live',
		provider: 'chatgpt',
		sourceId: 'chatgpt-desktop',
		label: 'ChatGPT',
		connector: 'chatgpt-desktop',
		deviceId: 'device-1',
		connectorId: 'chatgpt-desktop',
		sessionId: 'session-1',
		capabilities: [],
		projectPath: '/private'
	});
	assert.equal(noPath && noPath.access === 'live' ? noPath.projectId : null, undefined);
});
