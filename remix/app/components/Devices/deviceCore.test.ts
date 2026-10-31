import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DEVICE_AGENT_SESSION_STATUSES,
	DEVICE_CONNECTOR_STATUSES,
	DEVICE_PAIRING_STATUSES,
	DEVICE_PERMISSION_STATUSES,
	DEVICE_SCREEN_SESSION_STATUSES,
	DEVICE_SERVICE_STATUSES,
	DEVICE_TRANSPORT_STATUSES
} from './deviceTypes';
import type {
	DeviceAgentSession,
	DeviceCapability,
	DeviceCommand,
	DeviceEvent,
	DeviceRuntimeState,
	DeviceScreenSession,
	DeviceSnapshot,
	DeviceSummary
} from './deviceTypes';
import {
	DEVICE_OFFLINE_AFTER_MS,
	DEVICE_STALE_AFTER_MS,
	MAX_CACHED_AGENT_SESSIONS,
	MAX_CACHED_CAPABILITIES,
	MAX_CACHED_COMMANDS,
	MAX_CACHED_CONNECTORS,
	MAX_CACHED_RUNNING_APPS,
	MAX_CACHED_SCREEN_SESSIONS,
	createDeviceRuntimeState,
	deriveDevicePresence,
	deviceActionPolicy,
	projectDeviceStateForCache,
	reconcileDesiredState,
	reconcileDeviceCommand,
	reduceDeviceEvent
} from './deviceCore';

const NOW = Date.parse('2026-08-18T04:00:00.000Z');
const iso = (offsetMs = 0): string => new Date(NOW + offsetMs).toISOString();

const makeCapability = (overrides: Partial<DeviceCapability> = {}): DeviceCapability => ({
	id: 'system.volume.write',
	label: 'Volume',
	supported: true,
	enabled: true,
	queueWhenOffline: false,
	approval: 'never',
	requiredPermissions: [],
	...overrides
});

const makeSummary = (overrides: Partial<DeviceSummary> = {}): DeviceSummary => ({
	id: 'device-1',
	name: 'MacBook Pro',
	platform: 'darwin',
	serviceStatus: 'running',
	pairingStatus: 'paired',
	transportStatus: 'online',
	revision: 1,
	lastSeenAt: iso(-1_000),
	capabilities: [makeCapability()],
	permissionMode: 'always-allow',
	...overrides
});

const makeSnapshot = (overrides: Partial<DeviceSnapshot> = {}): DeviceSnapshot => ({
	deviceId: 'device-1',
	revision: 1,
	capturedAt: iso(-1_000),
	observed: {
		volume: 0.25,
		muted: false,
		brightness: 0.5,
		locked: false,
		sleeping: false,
		activeAppBundleId: 'com.openai.chat',
		runningApps: [],
		observedAt: iso(-1_000)
	},
	permissions: [],
	connectors: [],
	...overrides
});

const makeCommand = (overrides: Partial<DeviceCommand> = {}): DeviceCommand => ({
	id: 'command-1',
	deviceId: 'device-1',
	requestId: 'request-1',
	idempotencyKey: 'idempotency-1',
	action: 'set-volume',
	status: 'queued',
	revision: 1,
	createdAt: iso(-2_000),
	updatedAt: iso(-2_000),
	baseObservationRevision: 1,
	desired: { volume: 0.8 },
	...overrides
});

const makeState = (overrides: Partial<DeviceRuntimeState> = {}): DeviceRuntimeState => ({
	...createDeviceRuntimeState('device-1'),
	summary: makeSummary(),
	snapshot: makeSnapshot(),
	...overrides
});

test('device health status vocabularies stay aligned with the desktop node bridge', () => {
	assert.deepEqual(DEVICE_SERVICE_STATUSES, ['absent', 'needs-approval', 'starting', 'running', 'degraded', 'stopped', 'version-mismatch']);
	assert.deepEqual(DEVICE_PAIRING_STATUSES, ['unpaired', 'pairing', 'paired', 'revoked']);
	assert.deepEqual(DEVICE_TRANSPORT_STATUSES, ['offline', 'connecting', 'online', 'backoff']);
	assert.deepEqual(DEVICE_PERMISSION_STATUSES, ['not-determined', 'denied', 'restricted', 'authorized']);
	assert.deepEqual(DEVICE_CONNECTOR_STATUSES, ['unavailable', 'disabled', 'connecting', 'ready', 'degraded', 'error', 'update-required']);
	assert.deepEqual(DEVICE_AGENT_SESSION_STATUSES, ['idle', 'queued', 'running', 'waiting-approval', 'completed', 'interrupted', 'failed']);
	assert.deepEqual(DEVICE_SCREEN_SESSION_STATUSES, ['inactive', 'starting', 'active', 'stopping', 'denied', 'failed']);
});

test('presence derives online, stale, and offline states at monotonic boundaries', () => {
	assert.equal(deriveDevicePresence(null, NOW), 'offline');
	assert.equal(deriveDevicePresence('not-a-date', NOW), 'offline');
	assert.equal(deriveDevicePresence(iso(1_000), NOW), 'online');
	assert.equal(deriveDevicePresence(iso(-DEVICE_STALE_AFTER_MS), NOW), 'online');
	assert.equal(deriveDevicePresence(iso(-DEVICE_STALE_AFTER_MS - 1), NOW), 'stale');
	assert.equal(deriveDevicePresence(iso(-DEVICE_OFFLINE_AFTER_MS), NOW), 'stale');
	assert.equal(deriveDevicePresence(iso(-DEVICE_OFFLINE_AFTER_MS - 1), NOW), 'offline');
});

test('event reducer rejects duplicate sequences and stale resource revisions', () => {
	const initial = makeState({
		summary: makeSummary({ revision: 5 }),
		snapshot: makeSnapshot({ revision: 7 }),
		lastEventSequence: 10
	});

	const duplicate = reduceDeviceEvent(initial, {
		type: 'summary',
		deviceId: 'device-1',
		sequence: 10,
		occurredAt: iso(),
		summary: makeSummary({ revision: 6 })
	});
	assert.equal(duplicate, initial);

	const wrongDevice = reduceDeviceEvent(initial, {
		type: 'snapshot',
		deviceId: 'device-2',
		sequence: 11,
		occurredAt: iso(),
		snapshot: makeSnapshot({ deviceId: 'device-2', revision: 8 })
	});
	assert.equal(wrongDevice, initial);

	const staleResource = reduceDeviceEvent(initial, {
		type: 'snapshot',
		deviceId: 'device-1',
		sequence: 11,
		occurredAt: iso(),
		snapshot: makeSnapshot({ revision: 6 })
	});
	assert.equal(staleResource.lastEventSequence, 11);
	assert.equal(staleResource.snapshot, initial.snapshot);

	const freshResource = reduceDeviceEvent(staleResource, {
		type: 'snapshot',
		deviceId: 'device-1',
		sequence: 12,
		occurredAt: iso(),
		snapshot: makeSnapshot({ revision: 8, capturedAt: iso() })
	});
	assert.equal(freshResource.lastEventSequence, 12);
	assert.equal(freshResource.snapshot?.revision, 8);

	const replay = reduceDeviceEvent(freshResource, {
		type: 'snapshot',
		deviceId: 'device-1',
		sequence: 12,
		occurredAt: iso(),
		snapshot: makeSnapshot({ revision: 9 })
	});
	assert.equal(replay, freshResource);
});

test('command reconciliation replaces optimistic ids and cannot regress revisions or terminal states', () => {
	const optimistic = makeCommand({ id: 'local:request-1' });
	const authoritative = makeCommand({ id: 'server-command-1' });
	const replaced = reconcileDeviceCommand([optimistic], authoritative);
	assert.equal(replaced.length, 1);
	assert.equal(replaced[0].id, 'server-command-1');

	const running = makeCommand({ id: 'server-command-1', status: 'running', revision: 2, updatedAt: iso(-1_000) });
	const advanced = reconcileDeviceCommand(replaced, running);
	assert.equal(advanced[0].status, 'running');
	assert.equal(advanced[0].revision, 2);

	assert.equal(reconcileDeviceCommand(advanced, running), advanced);
	assert.equal(reconcileDeviceCommand(advanced, makeCommand({ revision: 1 })), advanced);

	const succeeded = reconcileDeviceCommand(advanced, makeCommand({ id: 'server-command-1', status: 'succeeded', revision: 3, updatedAt: iso() }));
	const terminalRegression = reconcileDeviceCommand(
		succeeded,
		makeCommand({ id: 'server-command-1', status: 'running', revision: 4, updatedAt: iso(1_000) })
	);
	assert.equal(terminalRegression, succeeded);
	assert.equal(terminalRegression[0].status, 'succeeded');

	const duplicateRows = [optimistic, succeeded[0]];
	const deduplicated = reconcileDeviceCommand(
		duplicateRows,
		makeCommand({ id: 'server-command-1', status: 'succeeded', revision: 4, updatedAt: iso(1_000) })
	);
	assert.equal(deduplicated.length, 1);
	assert.equal(deduplicated[0].revision, 4);
});

test('desired state stays optimistic until a newer observation confirms or reverts it', () => {
	const snapshot = makeSnapshot({ revision: 10 });
	const olderVolume = makeCommand({ id: 'volume-old', requestId: 'volume-old', desired: { volume: 0.5 } });
	const newerVolume = makeCommand({
		id: 'volume-new',
		requestId: 'volume-new',
		status: 'running',
		revision: 2,
		createdAt: iso(-1_000),
		updatedAt: iso(-1_000),
		desired: { volume: 0.8 }
	});
	const awaitingObservation = makeCommand({
		id: 'brightness',
		requestId: 'brightness',
		action: 'set-brightness',
		status: 'succeeded',
		revision: 3,
		baseObservationRevision: 10,
		desired: { brightness: 0.7 }
	});
	const failed = makeCommand({
		id: 'mute-failed',
		requestId: 'mute-failed',
		status: 'failed',
		desired: { muted: true }
	});

	const pending = reconcileDesiredState(snapshot, [newerVolume, failed, awaitingObservation, olderVolume], NOW);
	assert.equal(pending.effective?.volume, 0.8);
	assert.equal(pending.effective?.brightness, 0.7);
	assert.equal(pending.effective?.muted, false);
	assert.deepEqual(new Set(pending.pendingFields), new Set(['volume', 'brightness']));
	assert.ok(pending.pendingCommandIds.includes('brightness'));
	assert.ok(pending.revertedCommandIds.includes('mute-failed'));

	const confirmedSnapshot = makeSnapshot({
		revision: 11,
		observed: { ...snapshot.observed, brightness: 0.7, observedAt: iso() }
	});
	const confirmed = reconcileDesiredState(confirmedSnapshot, [awaitingObservation], NOW);
	assert.deepEqual(confirmed.confirmedCommandIds, ['brightness']);
	assert.deepEqual(confirmed.pendingCommandIds, []);
	assert.equal(confirmed.effective?.brightness, 0.7);

	const revertedSnapshot = makeSnapshot({ revision: 11 });
	const reverted = reconcileDesiredState(revertedSnapshot, [awaitingObservation], NOW);
	assert.deepEqual(reverted.revertedCommandIds, ['brightness']);
	assert.equal(reverted.effective?.brightness, revertedSnapshot.observed.brightness);

	const expired = makeCommand({ id: 'expired', requestId: 'expired', expiresAt: iso(-1), desired: { volume: 0.9 } });
	assert.deepEqual(reconcileDesiredState(snapshot, [expired], NOW).revertedCommandIds, ['expired']);
	assert.equal(reconcileDesiredState(null, [newerVolume], NOW).effective, null);
});

test('capability policy accounts for locality, permissions, lock, presence, and connector health', () => {
	const volumeCapability = makeCapability({
		requiredPermissions: ['accessibility'],
		approval: 'always'
	});
	const base = makeState({
		summary: makeSummary({ capabilities: [volumeCapability] }),
		snapshot: makeSnapshot({
			permissions: [{ kind: 'accessibility', status: 'authorized', updatedAt: iso() }]
		})
	});

	const ready = deviceActionPolicy(base, 'set-volume', { now: NOW });
	assert.equal(ready.allowed, true);
	assert.equal(ready.delivery, 'immediate');
	assert.equal(ready.approvalRequired, false);
	const askEveryTime = deviceActionPolicy(
		makeState({ summary: makeSummary({ capabilities: [volumeCapability], permissionMode: 'ask-every-time' }), snapshot: base.snapshot }),
		'set-volume',
		{ now: NOW }
	);
	assert.equal(askEveryTime.approvalRequired, true);

	const missingPermission = deviceActionPolicy(makeState({ summary: base.summary, snapshot: makeSnapshot({ permissions: [] }) }), 'set-volume', {
		now: NOW
	});
	assert.equal(missingPermission.reason, 'permission-required');
	assert.deepEqual(missingPermission.requiredPermissions, ['accessibility']);

	const locked = deviceActionPolicy(
		makeState({
			summary: base.summary,
			snapshot: makeSnapshot({
				observed: { ...makeSnapshot().observed, locked: true },
				permissions: [{ kind: 'accessibility', status: 'authorized', updatedAt: iso() }]
			})
		}),
		'set-volume',
		{ now: NOW }
	);
	assert.equal(locked.reason, 'device-locked');

	const offlineState = makeState({
		summary: makeSummary({
			transportStatus: 'offline',
			lastSeenAt: iso(-DEVICE_OFFLINE_AFTER_MS - 1),
			capabilities: [makeCapability({ queueWhenOffline: true })]
		})
	});
	assert.equal(deviceActionPolicy(offlineState, 'set-volume', { now: NOW }).delivery, 'queued');
	const notQueueable = makeState({
		summary: makeSummary({ transportStatus: 'offline', capabilities: [makeCapability({ queueWhenOffline: false })] })
	});
	assert.equal(deviceActionPolicy(notQueueable, 'set-volume', { now: NOW }).reason, 'device-offline');

	assert.equal(deviceActionPolicy(base, 'request-permission').reason, 'local-only');
	assert.equal(deviceActionPolicy(base, 'request-permission', { isLocal: true }).delivery, 'local');

	const messageCapability = makeCapability({ id: 'ai.session.message' });
	const connectorState = makeState({
		summary: makeSummary({ capabilities: [] }),
		snapshot: makeSnapshot({
			connectors: [
				{
					id: 'codex',
					kind: 'chatgpt-desktop',
					label: 'Codex',
					enabled: true,
					status: 'ready',
					capabilities: [messageCapability],
					projects: []
				}
			]
		})
	});
	assert.equal(deviceActionPolicy(connectorState, 'send-agent-message', { connectorId: 'codex', now: NOW }).delivery, 'immediate');
	assert.equal(deviceActionPolicy(connectorState, 'send-agent-message', { connectorId: 'missing', now: NOW }).reason, 'connector-unavailable');

	const wrongConnectorCapability = makeState({
		summary: makeSummary({ capabilities: [] }),
		snapshot: makeSnapshot({
			connectors: [
				{ id: 'codex', kind: 'codex', label: 'Codex', enabled: true, status: 'ready', capabilities: [], projects: [] },
				{
					id: 'other',
					kind: 'other',
					label: 'Other',
					enabled: true,
					status: 'ready',
					capabilities: [messageCapability],
					projects: []
				}
			]
		})
	});
	assert.equal(
		deviceActionPolicy(wrongConnectorCapability, 'send-agent-message', { connectorId: 'codex', now: NOW }).reason,
		'capability-unsupported'
	);
});

test('cache projection is bounded, redacted, sanitized, and does not mutate live state', () => {
	const capabilities = Array.from({ length: MAX_CACHED_CAPABILITIES + 8 }, (_value, index) =>
		makeCapability({ id: `capability-${index}`, label: `Capability ${index}` })
	);
	const runningApps = Array.from({ length: MAX_CACHED_RUNNING_APPS + 8 }, (_value, index) => ({
		bundleId: `com.example.app-${index}`,
		name: index === 0 ? 'Private\u0000 App' : `App ${index}`,
		isActive: index === 0,
		pid: 1_000 + index,
		iconDataUrl: 'data:image/png;base64,secret-icon',
		windowCount: 2,
		windowTitles: ['Secret customer document'],
		metadata: { localPath: '/Users/private/customer' }
	}));
	const connectors = Array.from({ length: MAX_CACHED_CONNECTORS + 5 }, (_value, index) => ({
		id: `connector-${index}`,
		kind: 'chat',
		label: `Connector ${index}`,
		enabled: true,
		status: 'ready' as const,
		capabilities,
		projects: [{ projectId: `project-${index}`, projectLabel: `Project ${index}` }],
		lastError: { code: 'provider-error', message: '/Users/private/token', at: iso() }
	}));
	const commands = Array.from({ length: MAX_CACHED_COMMANDS + 8 }, (_value, index) =>
		makeCommand({
			id: `command-${index}`,
			requestId: `request-${index}`,
			idempotencyKey: `idempotency-${index}`,
			revision: index + 1,
			createdAt: iso(index * 1_000),
			updatedAt: iso(index * 1_000),
			args: { message: 'top secret prompt', path: '/Users/private/project' },
			result: { output: 'secret response' },
			error: { code: 'failed', message: '/Users/private/project', at: iso() }
		})
	);
	const agentSessions: DeviceAgentSession[] = Array.from({ length: MAX_CACHED_AGENT_SESSIONS + 4 }, (_value, index) => ({
		id: `agent-${index}`,
		deviceId: 'device-1',
		connectorId: 'connector-1',
		chatId: `chat-${index}`,
		title: 'Secret chat title',
		project: '/Users/private/project',
		status: 'running',
		activeTurnId: `turn-${index}`,
		queueDepth: index,
		revision: index + 1,
		updatedAt: iso(index * 1_000),
		lastError: { code: 'agent-error', message: 'secret provider output', at: iso() }
	}));
	const screenSessions: DeviceScreenSession[] = Array.from({ length: MAX_CACHED_SCREEN_SESSIONS + 4 }, (_value, index) => ({
		id: `screen-${index}`,
		deviceId: 'device-1',
		status: 'active',
		controlEnabled: true,
		displayId: `display-${index}`,
		windowId: `private-window-${index}`,
		revision: index + 1,
		createdAt: iso(index * 1_000),
		updatedAt: iso(index * 1_000)
	}));
	const state = makeState({
		summary: makeSummary({
			name: 'My\u0000 Mac',
			capabilities,
			system: { batteryPercent: 80 },
			lastError: { code: 'node-error', message: '/Users/private/node.log', at: iso() }
		}),
		snapshot: makeSnapshot({
		observed: {
			...makeSnapshot().observed,
			volume: 2,
			brightness: -1,
			runningApps,
			audioDevices: [
				{
					id: 'BuiltInOutputDevice',
					name: 'MacBook Speakers',
					hasInput: false,
					hasOutput: true,
					isDefaultInput: false,
					isDefaultOutput: true,
					isDefaultSoundEffectsOutput: true
				}
			],
			wifi: { powerOn: true, ssid: 'Secret office network' }
			},
			connectors
		}),
		commands,
		approvals: [
			{
				id: 'approval-1',
				deviceId: 'device-1',
				commandId: 'command-1',
				status: 'pending',
				prompt: 'Approve secret prompt?',
				scopes: ['once'],
				localOnly: true,
				revision: 1,
				createdAt: iso(),
				expiresAt: null
			}
		],
		agentSessions,
		screenSessions,
		lastEventSequence: 42
	});
	const originalCommandOrder = state.commands.map((command) => command.id);
	const originalAgentOrder = state.agentSessions.map((session) => session.id);

	const projected = projectDeviceStateForCache(state);

	assert.deepEqual(
		state.commands.map((command) => command.id),
		originalCommandOrder
	);
	assert.deepEqual(
		state.agentSessions.map((session) => session.id),
		originalAgentOrder
	);
	assert.equal(projected.summary?.name, 'My Mac');
	assert.equal(projected.summary?.system?.batteryPercent, 0.8);
	assert.equal(projected.summary?.capabilities.length, MAX_CACHED_CAPABILITIES);
	assert.equal(projected.summary?.lastError?.message, undefined);
	assert.equal(projected.snapshot?.observed.volume, 1);
	assert.equal(projected.snapshot?.observed.brightness, 0);
	assert.equal(projected.snapshot?.observed.runningApps.length, MAX_CACHED_RUNNING_APPS);
	assert.equal(projected.snapshot?.observed.audioDevices?.[0]?.name, 'MacBook Speakers');
	assert.equal(projected.snapshot?.observed.wifi?.powerOn, true);
	assert.equal(projected.snapshot?.observed.wifi?.ssid, null);
	assert.equal(projected.snapshot?.connectors.length, MAX_CACHED_CONNECTORS);
	assert.equal(projected.snapshot?.connectors[0].capabilities.length, MAX_CACHED_CAPABILITIES);
	assert.equal('pid' in (projected.snapshot?.observed.runningApps[0] || {}), false);
	assert.equal('iconDataUrl' in (projected.snapshot?.observed.runningApps[0] || {}), false);
	assert.equal('windowTitles' in (projected.snapshot?.observed.runningApps[0] || {}), false);
	assert.equal('metadata' in (projected.snapshot?.observed.runningApps[0] || {}), false);
	assert.equal(projected.commands.length, MAX_CACHED_COMMANDS);
	assert.equal(projected.commands[0].id, `command-${MAX_CACHED_COMMANDS + 7}`);
	assert.equal(projected.commands[0].args, undefined);
	assert.equal(projected.commands[0].result, undefined);
	assert.equal(projected.commands[0].error?.message, undefined);
	assert.deepEqual(projected.approvals, []);
	assert.equal(projected.agentSessions.length, MAX_CACHED_AGENT_SESSIONS);
	assert.equal(projected.agentSessions[0].title, null);
	assert.equal(projected.agentSessions[0].project, null);
	assert.equal(projected.screenSessions.length, MAX_CACHED_SCREEN_SESSIONS);
	assert.equal(projected.screenSessions[0].displayId, null);
	assert.equal(projected.screenSessions[0].windowId, null);
	assert.equal(projected.lastEventSequence, 42);

	const serialized = JSON.stringify(projected);
	assert.equal(serialized.includes('top secret prompt'), false);
	assert.equal(serialized.includes('/Users/private'), false);
	assert.equal(serialized.includes('Secret customer document'), false);
	assert.equal(serialized.includes('private-window'), false);
	assert.equal(serialized.includes('Secret office network'), false);
});
