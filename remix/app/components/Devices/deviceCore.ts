import type {
	DeviceActionKind,
	DeviceActionPolicy,
	DeviceAgentSession,
	DeviceApproval,
	DeviceCapability,
	DeviceCommand,
	DeviceCommandStatus,
	DeviceDesiredReconciliation,
	DeviceDesiredState,
	DeviceEvent,
	DeviceHealthError,
	DeviceObservedState,
	DevicePermissionKind,
	DeviceRuntimeState,
	DeviceScreenSession,
	DeviceSnapshot,
	DeviceSummary
} from './deviceTypes';

export const DEVICE_STALE_AFTER_MS = 30_000;
export const DEVICE_OFFLINE_AFTER_MS = 120_000;

export const MAX_RUNTIME_COMMANDS = 100;
export const MAX_CACHED_COMMANDS = 20;
export const MAX_CACHED_RUNNING_APPS = 20;
export const MAX_CACHED_CONNECTORS = 16;
export const MAX_CACHED_CONNECTOR_PROJECTS = 128;
export const MAX_CACHED_CAPABILITIES = 64;
export const MAX_CACHED_AGENT_SESSIONS = 20;
export const MAX_CACHED_SCREEN_SESSIONS = 4;

const TERMINAL_COMMAND_STATUSES = new Set<DeviceCommandStatus>(['succeeded', 'failed', 'cancelled', 'expired', 'needs-review']);

const LOCAL_ONLY_ACTIONS = new Set<DeviceActionKind>([
	'register-service',
	'unregister-service',
	'begin-pairing',
	'complete-pairing',
	'unpair',
	'request-permission',
	'open-permission-settings'
]);

const ACTION_CAPABILITY: Partial<Record<DeviceActionKind, string>> = {
	'set-volume': 'system.volume.write',
	'set-muted': 'system.audio.mute.write',
	'set-input-volume': 'system.audio.input.volume.write',
	'set-input-muted': 'system.audio.input.mute.write',
	'set-audio-output': 'system.audio.output.write',
	'set-audio-input': 'system.audio.input.write',
	'set-sound-effects-volume': 'system.audio.sound-effects.volume.write',
	'set-sound-effects-muted': 'system.audio.sound-effects.mute.write',
	'set-sound-effects-output': 'system.audio.sound-effects-output.write',
	'set-brightness': 'system.brightness.write',
	'set-display-brightness': 'system.display.brightness.write',
	'set-display-mode': 'system.display.mode.write',
	'set-display-origin': 'system.display.layout.write',
	'set-display-mirroring': 'system.display.mirroring.write',
	'set-default-printer': 'system.printer.default.write',
	'set-preferred-camera': 'system.camera.preferred.write',
	'set-bluetooth-device-connected': 'system.bluetooth.device.connection.write',
	'set-vpn-connected': 'system.vpn.connection.write',
	'set-prevent-idle-sleep': 'system.power.idle-sleep-prevention.write',
	'set-power-idle-timer': 'system.power.idle-timer.write',
	'propose-airdrop-policy-profile': 'system.policy.airdrop.profile.write',
	'propose-camera-policy-profile': 'system.policy.camera.profile.write',
	'set-apple-music-playback': 'system.media.apple-music.playback.write',
	'set-apple-music-volume': 'system.media.apple-music.volume.write',
	'set-spotify-playback': 'system.media.spotify.playback.write',
	'set-spotify-volume': 'system.media.spotify.volume.write',
	'set-chrome-youtube-volume': 'system.media.chrome-youtube.volume.write',
	'move-pointer': 'input.pointer.write',
	'click-pointer': 'input.pointer.write',
	'scroll-pointer': 'input.pointer.write',
	'type-text': 'input.keyboard.write',
	'send-shortcut': 'input.keyboard.write',
	'launch-app': 'apps.launch',
	'quit-app': 'apps.quit',
	'hide-app': 'apps.visibility',
	'unhide-app': 'apps.visibility',
	lock: 'system.lock',
	'sleep': 'system.power.sleep',
	restart: 'system.power.restart',
	shutdown: 'system.power.shutdown',
	logout: 'system.session.logout',
	'connect-wifi': 'system.wifi.connect',
	'disconnect-wifi': 'system.wifi.disconnect',
	'set-wifi-power': 'system.wifi.power.write',
	'start-screen-session': 'screen.view',
	'control-screen-session': 'screen.control',
	'stop-screen-session': 'screen.view',
	'create-agent-session': 'ai.session.create',
	'send-agent-message': 'ai.session.message',
	'interrupt-agent-session': 'ai.session.interrupt',
	'respond-approval': 'approvals.respond'
};

const CONNECTOR_ACTIONS = new Set<DeviceActionKind>(['create-agent-session', 'send-agent-message', 'interrupt-agent-session']);

const timeOf = (value: string | null | undefined): number | null => {
	if (!value) return null;
	const parsed = new Date(value).getTime();
	return Number.isFinite(parsed) ? parsed : null;
};

const boundedInteger = (value: unknown, fallback = 0): number => (Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback);

const newerFirst = <T extends { updatedAt?: string; createdAt?: string; revision?: number }>(a: T, b: T): number => {
	const aTime = timeOf(a.updatedAt || a.createdAt) || 0;
	const bTime = timeOf(b.updatedAt || b.createdAt) || 0;
	return bTime - aTime || boundedInteger(b.revision) - boundedInteger(a.revision);
};

export const createDeviceRuntimeState = (deviceId: string): DeviceRuntimeState => ({
	deviceId,
	summary: null,
	snapshot: null,
	commands: [],
	approvals: [],
	agentSessions: [],
	screenSessions: [],
	lastEventSequence: 0
});

export const isTerminalDeviceCommand = (status: DeviceCommandStatus): boolean => TERMINAL_COMMAND_STATUSES.has(status);

export const deriveDevicePresence = (
	lastSeenAt: string | null | undefined,
	now = Date.now(),
	thresholds: { staleAfterMs?: number; offlineAfterMs?: number } = {}
): 'online' | 'stale' | 'offline' => {
	const seenAt = timeOf(lastSeenAt);
	if (seenAt === null) return 'offline';
	const staleAfterMs = Math.max(0, thresholds.staleAfterMs ?? DEVICE_STALE_AFTER_MS);
	const offlineAfterMs = Math.max(staleAfterMs, thresholds.offlineAfterMs ?? DEVICE_OFFLINE_AFTER_MS);
	const age = Math.max(0, now - seenAt);
	if (age <= staleAfterMs) return 'online';
	if (age <= offlineAfterMs) return 'stale';
	return 'offline';
};

// Reconcile a local optimistic command with the authoritative row. The stable
// idempotency key is as important as the id: a server response normally swaps
// a temporary client id for its canonical command id without creating a
// second command in the UI.
export const reconcileDeviceCommand = (commands: DeviceCommand[], incoming: DeviceCommand, limit = MAX_RUNTIME_COMMANDS): DeviceCommand[] => {
	const sameStableRequest = (left: DeviceCommand, right: DeviceCommand): boolean =>
		Boolean(
			(left.requestId && right.requestId && left.requestId === right.requestId) ||
				(left.idempotencyKey && right.idempotencyKey && left.idempotencyKey === right.idempotencyKey)
		);
	const matchingIndexes: number[] = [];
	commands.forEach((command, index) => {
		if (command.id === incoming.id || sameStableRequest(command, incoming)) matchingIndexes.push(index);
	});

	if (!matchingIndexes.length) return [incoming, ...commands].sort(newerFirst).slice(0, Math.max(1, limit));

	const existing = matchingIndexes.map((index) => commands[index]).sort((a, b) => b.revision - a.revision)[0];

	// Event replay and delayed workers must never regress a command. Terminal
	// states are immutable even if a buggy later event carries a larger number.
	const replacesOptimisticId = incoming.id !== existing.id && sameStableRequest(existing, incoming);
	if (incoming.revision < existing.revision) return commands;
	if (incoming.revision === existing.revision && !replacesOptimisticId) return commands;
	if (isTerminalDeviceCommand(existing.status) && incoming.status !== existing.status) return commands;

	const reconciled: DeviceCommand = {
		...existing,
		...incoming,
		// A canonical incoming id replaces a pending/local id while the stable
		// request/idempotency key remains the duplicate guard.
		id: incoming.id || existing.id,
		requestId: incoming.requestId || existing.requestId,
		idempotencyKey: incoming.idempotencyKey || existing.idempotencyKey
	};
	const matched = new Set(matchingIndexes);
	const next = commands.filter((_command, index) => !matched.has(index));
	next.unshift(reconciled);
	return next.sort(newerFirst).slice(0, Math.max(1, limit));
};

const upsertRevisioned = <T extends { id: string; revision: number }>(values: T[], incoming: T, limit: number): T[] => {
	const existing = values.find((value) => value.id === incoming.id);
	if (existing && incoming.revision <= existing.revision) return values;
	return [incoming, ...values.filter((value) => value.id !== incoming.id)].slice(0, limit);
};

const eventBelongsToState = (state: DeviceRuntimeState, event: DeviceEvent): boolean => {
	if (event.deviceId !== state.deviceId) return false;
	if (event.type === 'summary') return event.summary.id === state.deviceId;
	if (event.type === 'snapshot') return event.snapshot.deviceId === state.deviceId;
	if (event.type === 'command') return event.command.deviceId === state.deviceId;
	if (event.type === 'approval') return event.approval.deviceId === state.deviceId;
	if (event.type === 'agent-session') return event.session.deviceId === state.deviceId;
	if (event.type === 'screen-session') return event.session.deviceId === state.deviceId;
	return true;
};

// The event cursor is global to one device stream, while summary/snapshot rows
// also carry their own monotonic revisions. A fresh event carrying a stale
// snapshot advances the cursor (so reconnect does not replay it forever) but
// cannot replace newer observed state.
export const reduceDeviceEvent = (state: DeviceRuntimeState, event: DeviceEvent): DeviceRuntimeState => {
	if (!eventBelongsToState(state, event)) return state;
	if (!Number.isSafeInteger(event.sequence) || event.sequence <= state.lastEventSequence) return state;

	let next: DeviceRuntimeState = { ...state, lastEventSequence: event.sequence };
	switch (event.type) {
		case 'summary':
			if (!state.summary || event.summary.revision > state.summary.revision) next.summary = event.summary;
			break;
		case 'snapshot':
			if (!state.snapshot || event.snapshot.revision > state.snapshot.revision) next.snapshot = event.snapshot;
			break;
		case 'command':
			next.commands = reconcileDeviceCommand(state.commands, event.command);
			break;
		case 'command-removed':
			next.commands = state.commands.filter((command) => command.id !== event.commandId);
			break;
		case 'approval':
			next.approvals = upsertRevisioned(state.approvals, event.approval, 50);
			break;
		case 'approval-removed':
			next.approvals = state.approvals.filter((approval) => approval.id !== event.approvalId);
			break;
		case 'agent-session':
			next.agentSessions = upsertRevisioned(state.agentSessions, event.session, 100);
			break;
		case 'agent-session-removed':
			next.agentSessions = state.agentSessions.filter((session) => session.id !== event.sessionId);
			break;
		case 'screen-session':
			next.screenSessions = upsertRevisioned(state.screenSessions, event.session, 20);
			break;
		case 'screen-session-removed':
			next.screenSessions = state.screenSessions.filter((session) => session.id !== event.sessionId);
			break;
	}
	return next;
};

const desiredEntries = (desired: DeviceDesiredState | null | undefined) =>
	Object.entries(desired || {}).filter(
		(entry): entry is [keyof DeviceDesiredState, DeviceDesiredState[keyof DeviceDesiredState]] => entry[1] !== undefined
	);

const observedMatches = (observed: DeviceObservedState, field: keyof DeviceDesiredState, expected: unknown): boolean => {
	const actual = observed[field];
	if (typeof actual === 'number' && typeof expected === 'number') return Math.abs(actual - expected) <= 0.005;
	return Object.is(actual, expected);
};

const expiredAt = (command: DeviceCommand, now: number): boolean => {
	const expiresAt = timeOf(command.expiresAt);
	return expiresAt !== null && expiresAt <= now;
};

// Produces the value the UI paints without confusing it for an observation.
// A succeeded command stays optimistic only until a snapshot newer than its
// base revision arrives. That newer snapshot either confirms the desired
// fields or authoritatively reverts them.
export const reconcileDesiredState = (snapshot: DeviceSnapshot | null, commands: DeviceCommand[], now = Date.now()): DeviceDesiredReconciliation => {
	const observed = snapshot?.observed || null;
	if (!observed) {
		return {
			observed: null,
			effective: null,
			pendingFields: [],
			pendingCommandIds: [],
			confirmedCommandIds: [],
			revertedCommandIds: []
		};
	}

	const effective: DeviceObservedState = { ...observed, runningApps: observed.runningApps };
	const pendingFields = new Set<keyof DeviceDesiredState>();
	const pendingCommandIds: string[] = [];
	const confirmedCommandIds: string[] = [];
	const revertedCommandIds: string[] = [];

	// Oldest first so a newer command wins when two pending commands claim the
	// same field.
	const ordered = [...commands].sort((a, b) => -newerFirst(a, b));
	for (const command of ordered) {
		const entries = desiredEntries(command.desired);
		if (!entries.length) continue;

		if (
			command.status === 'failed' ||
			command.status === 'cancelled' ||
			command.status === 'expired' ||
			command.status === 'needs-review' ||
			expiredAt(command, now)
		) {
			revertedCommandIds.push(command.id);
			continue;
		}

		if (command.status === 'succeeded') {
			const baseRevision = command.baseObservationRevision;
			const newerObservation = baseRevision === null || baseRevision === undefined || snapshot.revision > baseRevision;
			if (newerObservation) {
				if (entries.every(([field, value]) => observedMatches(observed, field, value))) confirmedCommandIds.push(command.id);
				else revertedCommandIds.push(command.id);
				continue;
			}
		}

		pendingCommandIds.push(command.id);
		for (const [field, value] of entries) {
			(effective as Record<string, unknown>)[field] = value;
			pendingFields.add(field);
		}
	}

	return {
		observed,
		effective,
		pendingFields: [...pendingFields],
		pendingCommandIds,
		confirmedCommandIds,
		revertedCommandIds
	};
};

const blockedPolicy = (
	reason: DeviceActionPolicy['reason'],
	message: string,
	capabilityId: string | null = null,
	requiredPermissions: DevicePermissionKind[] = []
): DeviceActionPolicy => ({
	allowed: false,
	delivery: 'blocked',
	reason,
	message,
	capabilityId,
	requiredPermissions,
	approvalRequired: false
});

export type DeviceActionPolicyContext = {
	isLocal?: boolean;
	connectorId?: string | null;
	capabilityId?: string | null;
	now?: number;
};

export const deviceActionPolicy = (
	state: DeviceRuntimeState,
	action: DeviceActionKind,
	context: DeviceActionPolicyContext = {}
): DeviceActionPolicy => {
	if (LOCAL_ONLY_ACTIONS.has(action)) {
		if (!context.isLocal) return blockedPolicy('local-only', 'Complete this action on the device.');
		return {
			allowed: true,
			delivery: 'local',
			reason: 'ready',
			message: null,
			capabilityId: null,
			requiredPermissions: [],
			approvalRequired: false
		};
	}

	const summary = state.summary;
	if (!summary || !['running', 'degraded'].includes(summary.serviceStatus)) {
		return blockedPolicy('service-unavailable', 'The Thingtime node is not running.');
	}
	if (summary.pairingStatus !== 'paired') return blockedPolicy('not-paired', 'Pair this device before controlling it.');
	if (summary.permissionMode === 'deny') {
		return blockedPolicy('capability-disabled', 'Remote actions are denied for this account and computer.');
	}

	const capabilityId = context.capabilityId || ACTION_CAPABILITY[action] || String(action);
	const connector = CONNECTOR_ACTIONS.has(action) ? state.snapshot?.connectors.find((entry) => entry.id === context.connectorId) : null;
	if (CONNECTOR_ACTIONS.has(action) && (!connector || connector.status !== 'ready')) {
		return blockedPolicy('connector-unavailable', 'The selected connector is not ready.', capabilityId);
	}

	// A selected connector is the authority for connector-scoped actions. A
	// device-wide union can only describe non-connector actions; using it here
	// would let one application connector borrow another connector's powers.
	const capability = connector
		? connector.capabilities.find((entry) => entry.id === capabilityId) || null
		: summary.capabilities.find((entry) => entry.id === capabilityId) ||
		  state.snapshot?.connectors.flatMap((entry) => entry.capabilities).find((entry) => entry.id === capabilityId) ||
		  null;
	if (!capability?.supported) {
		return blockedPolicy('capability-unsupported', capability?.unavailableReason || 'This device does not support that action.', capabilityId);
	}
	if (!capability.enabled) {
		return blockedPolicy('capability-disabled', capability.unavailableReason || 'Enable this capability first.', capabilityId);
	}

	const requiredPermissions = capability.requiredPermissions || [];
	const permissionByKind = new Map((state.snapshot?.permissions || []).map((permission) => [permission.kind, permission.status]));
	const missingPermissions = requiredPermissions.filter((kind) => permissionByKind.get(kind) !== 'authorized');
	if (missingPermissions.length) {
		return blockedPolicy('permission-required', 'This action needs permission on the device.', capabilityId, missingPermissions);
	}

	if (state.snapshot?.observed.locked && !capability.allowedWhileLocked) {
		return blockedPolicy('device-locked', 'Unlock the device before using this capability.', capabilityId);
	}

	const presence = deriveDevicePresence(summary.lastSeenAt, context.now);
	const transportReady = summary.transportStatus === 'online' && presence === 'online';
	if (!transportReady) {
		if (!capability.queueWhenOffline) {
			return blockedPolicy('device-offline', 'The device must be online for this action.', capabilityId);
		}
		return {
			allowed: true,
			delivery: 'queued',
			reason: 'device-offline',
			message: 'This action will run when the device reconnects.',
			capabilityId,
			requiredPermissions,
			approvalRequired: summary.permissionMode === 'ask-every-time'
		};
	}

	return {
		allowed: true,
		delivery: 'immediate',
		reason: 'ready',
		message: null,
		capabilityId,
		requiredPermissions,
		approvalRequired: summary.permissionMode === 'ask-every-time'
	};
};

const text = (value: unknown, max = 160): string => {
	if (typeof value !== 'string') return '';
	const printable = Array.from(value, (character) => {
		const codePoint = character.codePointAt(0) || 0;
		return codePoint <= 31 || codePoint === 127 ? ' ' : character;
	}).join('');
	return printable.replace(/\s+/g, ' ').trim().slice(0, max);
};

const cacheError = (error: DeviceHealthError | null | undefined): DeviceHealthError | null => {
	if (!error) return null;
	const code = text(error.code, 80);
	if (!code) return null;
	// Messages can contain paths, provider output, or authorization context.
	// The durable API remains the source for full error detail.
	return { code, at: text(error.at, 40) || null };
};

const cacheCapability = (capability: DeviceCapability): DeviceCapability => ({
	id: text(capability.id, 120),
	...(capability.label ? { label: text(capability.label, 120) } : {}),
	supported: capability.supported === true,
	enabled: capability.enabled === true,
	...(capability.requiresUnlocked ? { requiresUnlocked: true } : {}),
	...(capability.allowedWhileLocked ? { allowedWhileLocked: true } : {}),
	...(capability.queueWhenOffline ? { queueWhenOffline: true } : {}),
	...(capability.approval ? { approval: capability.approval } : {}),
	...(capability.requiredPermissions?.length
		? {
				requiredPermissions: capability.requiredPermissions
					.map((kind) => text(kind, 80) as DevicePermissionKind)
					.filter(Boolean)
					.slice(0, 16)
		  }
		: {}),
	...(capability.unavailableReason ? { unavailableReason: text(capability.unavailableReason, 160) } : {})
});

const unitValue = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null);

const cacheSummary = (summary: DeviceSummary | null): DeviceSummary | null => {
	if (!summary) return null;
	return {
		id: text(summary.id, 160),
		name: text(summary.name, 160) || 'Device',
		platform: text(summary.platform, 80),
		serviceStatus: summary.serviceStatus,
		pairingStatus: summary.pairingStatus,
		transportStatus: summary.transportStatus,
		permissionMode: summary.permissionMode === 'ask-every-time' || summary.permissionMode === 'deny' ? summary.permissionMode : 'always-allow',
		revision: boundedInteger(summary.revision),
		lastSeenAt: text(summary.lastSeenAt, 40) || null,
		appVersion: text(summary.appVersion, 80) || null,
		nodeVersion: text(summary.nodeVersion, 80) || null,
		system: summary.system
			? {
					model: text(summary.system.model, 120) || null,
					osName: text(summary.system.osName, 80) || null,
					osVersion: text(summary.system.osVersion, 80) || null,
					architecture: text(summary.system.architecture, 40) || null,
					cpuModel: text(summary.system.cpuModel, 160) || null,
					memoryBytes:
						typeof summary.system.memoryBytes === 'number' && Number.isSafeInteger(summary.system.memoryBytes)
							? Math.max(0, summary.system.memoryBytes)
							: null,
					batteryPercent: unitValue(
						typeof summary.system.batteryPercent === 'number' && summary.system.batteryPercent > 1
							? summary.system.batteryPercent / 100
							: summary.system.batteryPercent
					),
					charging: typeof summary.system.charging === 'boolean' ? summary.system.charging : null
			  }
			: undefined,
		capabilities: summary.capabilities.slice(0, MAX_CACHED_CAPABILITIES).map(cacheCapability),
		connectorCount: boundedInteger(summary.connectorCount),
		lastError: cacheError(summary.lastError)
	};
};

const cacheSnapshot = (snapshot: DeviceSnapshot | null): DeviceSnapshot | null => {
	if (!snapshot) return null;
	const audioDevices = Array.isArray(snapshot.observed.audioDevices) ? snapshot.observed.audioDevices : [];
	return {
		deviceId: text(snapshot.deviceId, 160),
		revision: boundedInteger(snapshot.revision),
		capturedAt: text(snapshot.capturedAt, 40),
		observed: {
			volume: unitValue(snapshot.observed.volume),
			muted: typeof snapshot.observed.muted === 'boolean' ? snapshot.observed.muted : null,
			inputVolume: unitValue(snapshot.observed.inputVolume),
			inputMuted: typeof snapshot.observed.inputMuted === 'boolean' ? snapshot.observed.inputMuted : null,
			soundEffectsVolume: unitValue(snapshot.observed.soundEffectsVolume),
			soundEffectsMuted: typeof snapshot.observed.soundEffectsMuted === 'boolean' ? snapshot.observed.soundEffectsMuted : null,
			brightness: unitValue(snapshot.observed.brightness),
			locked: typeof snapshot.observed.locked === 'boolean' ? snapshot.observed.locked : null,
			sleeping: typeof snapshot.observed.sleeping === 'boolean' ? snapshot.observed.sleeping : null,
			activeAppBundleId: text(snapshot.observed.activeAppBundleId, 180) || null,
			observedAt: text(snapshot.observed.observedAt, 40),
			runningApps: snapshot.observed.runningApps.slice(0, MAX_CACHED_RUNNING_APPS).map((app) => ({
				bundleId: text(app.bundleId, 180),
				name: text(app.name, 120),
				isActive: app.isActive === true,
				isHidden: app.isHidden === true,
				windowCount: typeof app.windowCount === 'number' && Number.isSafeInteger(app.windowCount) ? Math.max(0, app.windowCount) : null
				// pid, icon data, window titles and arbitrary metadata are intentionally
				// not persisted in localStorage.
			})),
			audioDevices: audioDevices.slice(0, 32).map((device) => ({
				id: text(device.id, 512),
				name: text(device.name, 120),
				hasInput: device.hasInput === true,
				hasOutput: device.hasOutput === true,
				isDefaultInput: device.isDefaultInput === true,
				isDefaultOutput: device.isDefaultOutput === true,
				isDefaultSoundEffectsOutput: device.isDefaultSoundEffectsOutput === true
			})),
			wifi: snapshot.observed.wifi
				? {
					powerOn: typeof snapshot.observed.wifi.powerOn === 'boolean' ? snapshot.observed.wifi.powerOn : null,
					// Network names can be location-sensitive; render live data but do not
					// persist them in the browser's cache.
					ssid: null
				  }
				: null
		},
		permissions: snapshot.permissions.slice(0, 24).map((permission) => ({
			kind: text(permission.kind, 80) as DevicePermissionKind,
			status: permission.status,
			updatedAt: text(permission.updatedAt, 40) || null
		})),
		connectors: snapshot.connectors.slice(0, MAX_CACHED_CONNECTORS).map((connector) => ({
			id: text(connector.id, 160),
			kind: text(connector.kind, 80),
			label: text(connector.label, 120),
			enabled: connector.enabled === true,
			status: connector.status,
			capabilities: connector.capabilities.slice(0, MAX_CACHED_CAPABILITIES).map(cacheCapability),
			projects: connector.projects.slice(0, MAX_CACHED_CONNECTOR_PROJECTS).map((project) => ({
				projectId: text(project.projectId, 160),
				projectLabel: text(project.projectLabel, 160)
			})),
			version: text(connector.version, 80) || null,
			lastSeenAt: text(connector.lastSeenAt, 40) || null,
			lastError: cacheError(connector.lastError)
		}))
	};
};

const cacheDesired = (desired: DeviceDesiredState | null | undefined): DeviceDesiredState | null => {
	if (!desired) return null;
	const projected: DeviceDesiredState = {};
	if (desired.volume !== undefined) projected.volume = unitValue(desired.volume);
	if (desired.brightness !== undefined) projected.brightness = unitValue(desired.brightness);
	if (typeof desired.muted === 'boolean') projected.muted = desired.muted;
	if (typeof desired.locked === 'boolean') projected.locked = desired.locked;
	if (desired.activeAppBundleId !== undefined) projected.activeAppBundleId = text(desired.activeAppBundleId, 180) || null;
	return projected;
};

const cacheCommand = (command: DeviceCommand): DeviceCommand => ({
	id: text(command.id, 160),
	deviceId: text(command.deviceId, 160),
	requestId: text(command.requestId, 180) || null,
	idempotencyKey: text(command.idempotencyKey, 180) || null,
	action: text(command.action, 120) as DeviceActionKind,
	...(command.kind ? { kind: text(command.kind, 120) as DeviceActionKind } : {}),
	status: command.status,
	revision: boundedInteger(command.revision),
	createdAt: text(command.createdAt, 40),
	updatedAt: text(command.updatedAt, 40),
	expiresAt: text(command.expiresAt, 40) || null,
	baseObservationRevision:
		command.baseObservationRevision === null || command.baseObservationRevision === undefined
			? null
			: boundedInteger(command.baseObservationRevision),
	desired: cacheDesired(command.desired),
	error: cacheError(command.error)
	// args and result are deliberately omitted: they may contain message text,
	// paths, application data or tool output.
});

const cacheAgentSession = (session: DeviceAgentSession): DeviceAgentSession => ({
	id: text(session.id, 160),
	deviceId: text(session.deviceId, 160),
	connectorId: text(session.connectorId, 160),
	chatId: text(session.chatId, 160) || null,
	// title/project may include private prompts or local paths; the Messenger
	// cache owns user-visible chat names independently.
	title: null,
	project: null,
	status: session.status,
	activeTurnId: text(session.activeTurnId, 180) || null,
	queueDepth: boundedInteger(session.queueDepth),
	revision: boundedInteger(session.revision),
	updatedAt: text(session.updatedAt, 40),
	lastError: cacheError(session.lastError)
});

const cacheScreenSession = (session: DeviceScreenSession): DeviceScreenSession => ({
	id: text(session.id, 160),
	deviceId: text(session.deviceId, 160),
	status: session.status,
	controlEnabled: session.controlEnabled === true,
	// Display/window ids can reveal private window inventory and are not needed
	// for optimistic first paint.
	displayId: null,
	windowId: null,
	revision: boundedInteger(session.revision),
	createdAt: text(session.createdAt, 40),
	updatedAt: text(session.updatedAt, 40),
	lastError: cacheError(session.lastError)
});

// Safe, bounded localStorage projection. Re-running this on cache read also
// strips fields written by older clients before the current redaction rules.
export const projectDeviceStateForCache = (state: DeviceRuntimeState): DeviceRuntimeState => ({
	deviceId: text(state.deviceId, 160),
	summary: cacheSummary(state.summary),
	snapshot: cacheSnapshot(state.snapshot),
	commands: [...state.commands].sort(newerFirst).slice(0, MAX_CACHED_COMMANDS).map(cacheCommand),
	approvals: [],
	agentSessions: [...state.agentSessions].sort(newerFirst).slice(0, MAX_CACHED_AGENT_SESSIONS).map(cacheAgentSession),
	screenSessions: [...state.screenSessions].sort(newerFirst).slice(0, MAX_CACHED_SCREEN_SESSIONS).map(cacheScreenSession),
	lastEventSequence: boundedInteger(state.lastEventSequence)
});
