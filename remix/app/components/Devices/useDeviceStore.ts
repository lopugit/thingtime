import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLopu } from '~/components/Lopu/useLopu';
import { clearLocalCache, readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { apiErrorMessage, hasUnknownMutationOutcome } from '~/hooks/apiFailure';

import { readDeviceDetailCache, readDeviceListCache, writeDeviceDetailCache, writeDeviceListCache } from './deviceCache';
import { createDeviceRuntimeState, deviceActionPolicy, reconcileDeviceCommand } from './deviceCore';
import type { DeviceActionControl, DeviceActionIntent, DeviceControlResolver } from './DeviceStateGrid';
import type {
	DeviceActionKind,
	DeviceActionPolicy,
	DeviceApproval,
	DeviceCapability,
	DeviceCommand,
	DeviceConnector,
	DeviceDesiredState,
	DeviceExecutionPermissionMode,
	DeviceRuntimeState,
	DeviceScreenSession,
	DeviceSnapshot,
	DeviceSummary
} from './deviceTypes';
import type {
	CreateDeviceCommandInput,
	PublicDevice,
	PublicDeviceApproval,
	PublicDeviceCommand,
	PublicDeviceCommandKind,
	PublicDeviceConnector,
	PublicDeviceScreenSession
} from './useDeviceApi';
import { useDeviceApi } from './useDeviceApi';

const LIST_REFRESH_MS = 30_000;
const EVENT_WAIT_MS = 15_000;
const EVENT_PAGE_SIZE = 100;
const EVENT_CURSOR_VERSION = 1;

const CAPABILITY_ALIASES: Record<string, string[]> = {
	'connector.start': ['set-connector-enabled'],
	'connector.stop': ['set-connector-enabled'],
	'read-history': ['ai.session.read'],
	'session.list': ['ai.session.read'],
	'session.read': ['ai.session.read'],
	'create-session': ['ai.session.create'],
	'session.create': ['ai.session.create'],
	'send-message': ['ai.session.message'],
	'session.send': ['ai.session.message'],
	'steer-turn': ['ai.session.steer'],
	'session.steer': ['ai.session.steer'],
	'interrupt-turn': ['ai.session.interrupt'],
	'session.interrupt': ['ai.session.interrupt'],
	'review-approval': ['approvals.respond'],
	'approval.respond': ['approvals.respond'],
	'app.focus': ['apps.launch'],
	'app.launch': ['apps.launch'],
	'app.quit': ['apps.quit'],
	'app.force-quit': ['apps.force-quit'],
	'app.hide': ['apps.visibility'],
	'app.unhide': ['apps.visibility'],
	'app.hide-others': ['apps.visibility'],
	'system.volume.set': ['system.volume.write'],
	'system.audio.mute.set': ['system.audio.mute.write'],
	'system.audio.input.volume.set': ['system.audio.input.volume.write'],
	'system.audio.input.mute.set': ['system.audio.input.mute.write'],
	'system.audio.output.set': ['system.audio.output.write'],
	'system.audio.input.set': ['system.audio.input.write'],
	'system.audio.sound-effects.volume.set': ['system.audio.sound-effects.volume.write'],
	'system.audio.sound-effects.mute.set': ['system.audio.sound-effects.mute.write'],
	'system.audio.sound-effects-output.set': ['system.audio.sound-effects-output.write'],
	'system.brightness.set': ['system.brightness.write'],
	'system.display.brightness.set': ['system.display.brightness.write'],
	'system.display.mode.set': ['system.display.mode.write'],
	'system.display.origin.set': ['system.display.layout.write'],
	'system.display.mirroring.set': ['system.display.mirroring.write'],
	'system.printer.default.set': ['system.printer.default.write'],
	'system.camera.preferred.set': ['system.camera.preferred.write'],
	'system.bluetooth.device.connection.set': ['system.bluetooth.device.connection.write'],
	'system.vpn.connection.set': ['system.vpn.connection.write'],
	'system.power.idle-sleep-prevention.set': ['system.power.idle-sleep-prevention.write'],
	'system.power.idle-timer.set': ['system.power.idle-timer.write'],
	'system.policy.airdrop.profile.propose': ['system.policy.airdrop.profile.write'],
	'system.policy.camera.profile.propose': ['system.policy.camera.profile.write'],
	'system.lock': ['system.lock'],
	'system.sleep': ['system.power.sleep'],
	'system.restart': ['system.power.restart'],
	'system.shutdown': ['system.power.shutdown'],
	'system.logout': ['system.session.logout'],
	'system.wifi.connect': ['system.wifi.connect'],
	'system.wifi.disconnect': ['system.wifi.disconnect'],
	'system.wifi.power.set': ['system.wifi.power.write'],
	'input.pointer.move': ['input.pointer.write'],
	'input.pointer.click': ['input.pointer.write'],
	'input.pointer.scroll': ['input.pointer.write'],
	'input.keyboard.type': ['input.keyboard.write'],
	'input.keyboard.shortcut': ['input.keyboard.write'],
	'screen.start': ['screen.view'],
	'screen.stop': ['screen.view'],
	'screen.control': ['screen.control']
};

const QUEUEABLE_CAPABILITIES = new Set([
	'connector.start',
	'connector.stop',
	'set-connector-enabled',
	'session.create',
	'session.send',
	'ai.session.create',
	'ai.session.message',
	'approval.respond',
	'approvals.respond'
]);

const LOCKED_CAPABILITIES = new Set([
	'session.create',
	'session.send',
	'ai.session.create',
	'ai.session.message',
	'approval.respond',
	'approvals.respond',
	'connector.start',
	'connector.stop',
	'set-connector-enabled'
]);

const SCREEN_ACTIONS = new Set<DeviceActionKind>(['start-screen-session', 'control-screen-session', 'stop-screen-session']);

const LOCAL_ACTIONS = new Set<DeviceActionKind>([
	'register-service',
	'unregister-service',
	'begin-pairing',
	'complete-pairing',
	'unpair',
	'request-permission',
	'open-permission-settings'
]);

export type DevicePendingCounts = { commands: number; approvals: number };

type StoreState = {
	ownerId: string | null;
	states: Record<string, DeviceRuntimeState>;
	counts: Record<string, DevicePendingCounts>;
	listLoaded: boolean;
	listRefreshing: boolean;
	loadingDeviceIds: Set<string>;
};

const safeRevisionFromTime = (value: string | null | undefined, rank = 0): number => {
	const time = value ? Date.parse(value) : NaN;
	return Number.isFinite(time) ? Math.max(1, time * 16 + Math.max(0, Math.min(15, rank))) : Math.max(1, rank);
};

const unit = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null);

const containsUnsafeInputControl = (value: string): boolean => Array.from(value).some((character) => {
	const code = character.codePointAt(0) || 0;
	return !(code === 0x09 || code === 0x0a || code === 0x0d || (code > 0x1f && !(code >= 0x7f && code <= 0x9f)));
});

const actionFromCommandKind = (kind: string): DeviceActionKind => {
	switch (kind) {
		case 'connector.start':
		case 'connector.stop':
			return 'set-connector-enabled';
		case 'session.create':
			return 'create-agent-session';
		case 'session.send':
			return 'send-agent-message';
		case 'session.interrupt':
			return 'interrupt-agent-session';
		case 'approval.respond':
			return 'respond-approval';
		case 'app.focus':
		case 'app.launch':
			return 'launch-app';
		case 'app.quit':
			return 'quit-app';
		case 'app.force-quit':
			return 'force-quit-app';
		case 'app.hide-others':
			return 'hide-other-apps';
		case 'system.audio.mute.set':
			return 'set-muted';
		case 'system.audio.input.volume.set':
			return 'set-input-volume';
		case 'system.audio.input.mute.set':
			return 'set-input-muted';
		case 'system.audio.output.set':
			return 'set-audio-output';
		case 'system.audio.input.set':
			return 'set-audio-input';
		case 'system.audio.sound-effects-output.set':
			return 'set-sound-effects-output';
		case 'system.audio.sound-effects.volume.set':
			return 'set-sound-effects-volume';
		case 'system.audio.sound-effects.mute.set':
			return 'set-sound-effects-muted';
		case 'system.volume.set':
			return 'set-volume';
		case 'system.brightness.set':
			return 'set-brightness';
		case 'system.display.brightness.set': return 'set-display-brightness';
		case 'system.display.mode.set': return 'set-display-mode';
		case 'system.display.origin.set': return 'set-display-origin';
		case 'system.display.mirroring.set': return 'set-display-mirroring';
		case 'system.printer.default.set': return 'set-default-printer';
		case 'system.camera.preferred.set': return 'set-preferred-camera';
		case 'system.bluetooth.device.connection.set': return 'set-bluetooth-device-connected';
		case 'system.vpn.connection.set': return 'set-vpn-connected';
		case 'system.power.idle-sleep-prevention.set': return 'set-prevent-idle-sleep';
		case 'system.power.idle-timer.set': return 'set-power-idle-timer';
		case 'system.policy.airdrop.profile.propose': return 'propose-airdrop-policy-profile';
		case 'system.policy.camera.profile.propose': return 'propose-camera-policy-profile';
		case 'system.media.apple-music.playback.set': return 'set-apple-music-playback';
		case 'system.media.apple-music.volume.set': return 'set-apple-music-volume';
		case 'system.media.spotify.playback.set': return 'set-spotify-playback';
		case 'system.media.spotify.volume.set': return 'set-spotify-volume';
		case 'system.media.chrome-youtube.volume.set': return 'set-chrome-youtube-volume';
		case 'input.pointer.move': return 'move-pointer';
		case 'input.pointer.click': return 'click-pointer';
		case 'input.pointer.scroll': return 'scroll-pointer';
		case 'input.keyboard.type': return 'type-text';
		case 'input.keyboard.shortcut': return 'send-shortcut';
		case 'system.lock':
			return 'lock';
		case 'system.sleep':
			return 'sleep';
		case 'system.restart': return 'restart';
		case 'system.shutdown': return 'shutdown';
		case 'system.logout': return 'logout';
		case 'system.wifi.connect':
			return 'connect-wifi';
		case 'system.wifi.disconnect':
			return 'disconnect-wifi';
		case 'system.wifi.power.set':
			return 'set-wifi-power';
		case 'app.hide':
			return 'hide-app';
		case 'app.unhide':
			return 'unhide-app';
		case 'screen.start':
			return 'start-screen-session';
		case 'screen.stop':
			return 'stop-screen-session';
		default:
			return kind as DeviceActionKind;
	}
};

const desiredFromCommand = (command: PublicDeviceCommand): DeviceDesiredState | null => {
	if (command.kind === 'system.volume.set') return { volume: unit(command.input.level) };
	if (command.kind === 'system.audio.mute.set') return typeof command.input.muted === 'boolean' ? { muted: command.input.muted } : null;
	if (command.kind === 'system.brightness.set') return { brightness: unit(command.input.level) };
	if (command.kind === 'system.lock') return { locked: true };
	if (command.kind === 'app.focus' || command.kind === 'app.launch') {
		return typeof command.input.appId === 'string' ? { activeAppBundleId: command.input.appId } : null;
	}
	return null;
};

const commandStatusRank: Record<PublicDeviceCommand['status'], number> = {
	queued: 1,
	claimed: 2,
	running: 3,
	'needs-approval': 4,
	succeeded: 8,
	failed: 9,
	cancelled: 10,
	'needs-review': 11
};

export const publicDeviceCommandToRuntime = (command: PublicDeviceCommand, previous?: DeviceCommand | null): DeviceCommand => ({
	id: command.id,
	deviceId: command.deviceId,
	requestId: command.requestId,
	idempotencyKey: command.requestId,
	action: actionFromCommandKind(command.kind),
	kind: command.kind as DeviceActionKind,
	status: command.status,
	revision: safeRevisionFromTime(command.updatedAt, commandStatusRank[command.status]),
	createdAt: command.createdAt,
	updatedAt: command.updatedAt,
	expiresAt: command.leaseExpiresAt,
	baseObservationRevision: previous?.baseObservationRevision ?? null,
	desired: desiredFromCommand(command) || previous?.desired || null,
	args: command.input,
	result: command.outputRef ? { outputRef: command.outputRef } : null,
	error: command.error ? { code: 'command-failed', message: command.error, at: command.completedAt } : null
});

const approvalStatusRank: Record<PublicDeviceApproval['status'], number> = {
	pending: 1,
	approved: 2,
	denied: 3,
	expired: 4
};

export const publicDeviceApprovalToRuntime = (approval: PublicDeviceApproval): DeviceApproval => ({
	id: approval.id,
	deviceId: approval.deviceId,
	commandId: approval.commandId || null,
	status: approval.status,
	kind: approval.kind,
	prompt: approval.prompt,
	scopes: ['once'],
	localOnly: false,
	revision: safeRevisionFromTime(approval.decidedAt || approval.createdAt, approvalStatusRank[approval.status]),
	createdAt: approval.createdAt,
	expiresAt: approval.expiresAt,
	decidedAt: approval.decidedAt
});

const screenStatusRank: Record<PublicDeviceScreenSession['status'], number> = {
	requested: 1,
	'awaiting-local-approval': 2,
	connecting: 3,
	active: 4,
	ended: 8,
	failed: 9
};

export const publicDeviceScreenToRuntime = (session: PublicDeviceScreenSession): DeviceScreenSession => ({
	id: session.id,
	deviceId: session.deviceId,
	status: session.status === 'active' ? 'active' : session.status === 'ended' ? 'inactive' : session.status === 'failed' ? 'failed' : 'starting',
	controlEnabled: false,
	revision: safeRevisionFromTime(session.updatedAt, screenStatusRank[session.status]),
	createdAt: session.createdAt,
	updatedAt: session.updatedAt,
	lastError: session.error ? { code: 'screen-session-failed', message: session.error, at: session.updatedAt } : null
});

const capabilityMeta = (id: string): Omit<DeviceCapability, 'id'> => ({
	supported: true,
	enabled: true,
	allowedWhileLocked: LOCKED_CAPABILITIES.has(id),
	requiresUnlocked: !LOCKED_CAPABILITIES.has(id),
	queueWhenOffline: QUEUEABLE_CAPABILITIES.has(id),
	approval: id === 'screen.view' || id.startsWith('screen.') ? 'always' : 'never'
});

const runtimeCapabilities = (capabilities: string[]): DeviceCapability[] => {
	const ids = new Set<string>();
	for (const raw of capabilities) {
		if (!raw) continue;
		ids.add(raw);
		for (const alias of CAPABILITY_ALIASES[raw] || []) ids.add(alias);
	}
	return [...ids].slice(0, 64).map((id) => ({ id, ...capabilityMeta(id) }));
};

const connectorStatus = (connector: PublicDeviceConnector): DeviceConnector['status'] => {
	if (connector.status === 'connected') return 'ready';
	if (connector.status === 'disconnected') return 'disabled';
	return 'degraded';
};

const runtimeConnector = (connector: PublicDeviceConnector, lastSeenAt: string | null): DeviceConnector => ({
	id: connector.id,
	kind: connector.kind,
	label: connector.label,
	enabled: connector.status !== 'disconnected',
	status: connectorStatus(connector),
	capabilities: runtimeCapabilities(connector.capabilities),
	projects: (connector.projects || []).map((project) => ({ ...project })),
	lastSeenAt,
	lastError:
		connector.status === 'needs-permission'
			? { code: 'permission-required', at: connector.updatedAt }
			: connector.status === 'degraded'
			? { code: 'connector-degraded', at: connector.updatedAt }
			: null
});

export const publicDeviceToSummary = (device: PublicDevice): DeviceSummary => {
	const revision = Math.max(1, device.state?.revision || 0, ...device.connectors.map((connector) => connector.revision || 0));
	const allCapabilities = [...device.capabilities, ...device.connectors.flatMap((connector) => connector.capabilities)];
	return {
		id: device.id,
		name: device.name || 'Computer',
		platform: device.platform,
		// The cloud projection proves the paired node exists, but does not expose
		// the launch-agent lifecycle. "degraded" keeps queueable server commands
		// honest while the transport is offline.
		serviceStatus: device.online ? 'running' : 'degraded',
		pairingStatus: 'paired',
		transportStatus: device.online ? 'online' : 'offline',
		revision,
		lastSeenAt: device.lastSeenAt,
		appVersion: device.appVersion,
		system: {
			model: device.model,
			osName: device.platform,
			osVersion: device.osVersion,
			batteryPercent: device.battery?.level ?? null,
			charging: device.battery?.charging ?? null
		},
		capabilities: runtimeCapabilities(allCapabilities),
		connectorCount: device.connectors.length,
		permissionMode: device.permissionMode
	};
};

const publicDeviceToSnapshot = (device: PublicDevice): DeviceSnapshot | null => {
	if (!device.state && !device.connectors.length) return null;
	const openApps = device.state?.openApps || device.openApps || [];
	const activeApp = openApps.find((app) => app.frontmost) || null;
	const observedAt = device.state?.observedAt || device.lastSeenAt || device.pairedAt;
	return {
		deviceId: device.id,
		revision: device.state?.revision || Math.max(1, ...device.connectors.map((connector) => connector.revision || 0)),
		capturedAt: observedAt,
		observed: {
			volume: unit(device.state?.volume ?? device.volume),
			muted: device.state?.muted ?? null,
			inputVolume: unit(device.state?.inputVolume),
			inputMuted: device.state?.inputMuted ?? null,
			soundEffectsVolume: unit(device.state?.soundEffectsVolume),
			soundEffectsMuted: device.state?.soundEffectsMuted ?? null,
			brightness: unit(device.state?.brightness ?? device.brightness),
			locked: device.state?.locked ?? device.locked,
			sleeping: null,
			activeAppBundleId: activeApp?.id || null,
			runningApps: openApps.map((app) => ({
				bundleId: app.id,
				name: app.name,
				isActive: app.frontmost,
				isHidden: app.hidden
			})),
			audioDevices: device.state?.audioDevices || [],
			wifi: device.state?.wifi || null,
			displays: device.state?.displays || [],
			printers: device.state?.printers || [],
			cameras: device.state?.cameras || [],
			bluetoothDevices: device.state?.bluetoothDevices || [],
			vpnServices: device.state?.vpnServices || [],
			appleMusic: device.state?.appleMusic,
			spotify: device.state?.spotify,
			chromeYouTube: device.state?.chromeYouTube,
			powerTimers: device.state?.powerTimers,
			battery: device.state?.battery
				? {
					...device.state.battery,
					isExternalPower: device.state.battery.isExternalPower ?? null,
					isPreventingIdleSleep: device.state.battery.isPreventingIdleSleep ?? false,
					isLowPowerModeEnabled: device.state.battery.isLowPowerModeEnabled ?? false
				}
				: null,
			observedAt
		},
		permissions: [],
		connectors: device.connectors.map((connector) => runtimeConnector(connector, device.lastSeenAt))
	};
};

export const publicDeviceToRuntime = (device: PublicDevice, previous: DeviceRuntimeState | null = null): DeviceRuntimeState => ({
	...(previous || createDeviceRuntimeState(device.id)),
	deviceId: device.id,
	summary: publicDeviceToSummary(device),
	snapshot: publicDeviceToSnapshot(device)
});

const runtimeCommands = (commands: PublicDeviceCommand[], previous: DeviceCommand[]): DeviceCommand[] => {
	const previousByRequest = new Map(
		previous
			.filter((command) => command.requestId || command.idempotencyKey)
			.map((command) => [command.requestId || command.idempotencyKey || '', command])
	);
	return commands
		.map((command) => publicDeviceCommandToRuntime(command, previousByRequest.get(command.requestId)))
		.sort((left, right) => right.revision - left.revision);
};

const seedStore = (ownerId: string | null, selectedDeviceId?: string | null): StoreState => {
	const states: Record<string, DeviceRuntimeState> = {};
	if (ownerId) {
		for (const summary of readDeviceListCache(ownerId)) {
			states[summary.id] = { ...createDeviceRuntimeState(summary.id), summary };
		}
		if (selectedDeviceId) {
			const detail = readDeviceDetailCache(ownerId, selectedDeviceId);
			if (detail) states[selectedDeviceId] = detail;
		}
	}
	return {
		ownerId,
		states,
		counts: {},
		listLoaded: false,
		listRefreshing: false,
		loadingDeviceIds: new Set()
	};
};

const blockedPolicy = (message: string, reason: DeviceActionPolicy['reason'] = 'capability-unsupported'): DeviceActionPolicy => ({
	allowed: false,
	delivery: 'blocked',
	reason,
	message,
	capabilityId: null,
	requiredPermissions: [],
	approvalRequired: false
});

const approvalPolicy = (): DeviceActionPolicy => ({
	allowed: true,
	delivery: 'immediate',
	reason: 'ready',
	message: null,
	capabilityId: 'approvals.respond',
	requiredPermissions: [],
	approvalRequired: false
});

const eventCursorKey = (ownerId: string, deviceId: string): string =>
	`tt-device-events:${encodeURIComponent(ownerId.slice(0, 180))}:${encodeURIComponent(deviceId.slice(0, 180))}`;

const readEventCursor = (ownerId: string, deviceId: string): string | null => {
	const value = readLocalCache<unknown>(eventCursorKey(ownerId, deviceId));
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	return record.version === EVENT_CURSOR_VERSION && typeof record.cursor === 'string' && record.cursor.length <= 1024 ? record.cursor : null;
};

const writeEventCursor = (ownerId: string, deviceId: string, cursor: string | null): void => {
	if (!cursor) return;
	writeLocalCache(eventCursorKey(ownerId, deviceId), {
		version: EVENT_CURSOR_VERSION,
		cursor,
		writtenAt: new Date().toISOString()
	});
};

const randomRequestId = (): string => {
	const suffix =
		typeof globalThis.crypto?.randomUUID === 'function'
			? globalThis.crypto.randomUUID()
			: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	return `web-${suffix}`;
};

const inputString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const commandInputForIntent = (intent: DeviceActionIntent): CreateDeviceCommandInput | null => {
	const input = intent.input || {};
	const base = { deviceId: intent.deviceId, requestId: intent.idempotencyKey };
	switch (intent.action) {
		case 'set-connector-enabled': {
			const connectorId = inputString(input.connectorId || intent.targetId);
			if (!connectorId) return null;
			return { ...base, kind: input.enabled === false ? 'connector.stop' : 'connector.start', input: { connectorId } };
		}
		case 'create-agent-session': {
			const connectorId = inputString(input.connectorId || intent.targetId);
			if (!connectorId) return null;
			const projectId = inputString(input.projectId);
			const title = inputString(input.title);
			return {
				...base,
				kind: 'session.create',
				input: { connectorId, ...(projectId ? { projectId } : {}), ...(title ? { title } : {}) }
			};
		}
		case 'send-agent-message': {
			const connectorId = inputString(input.connectorId);
			const sessionId = inputString(input.sessionId || intent.targetId);
			const text = inputString(input.text);
			const delivery = input.delivery === 'steer' || input.mode === 'steer' ? 'steer' : 'queue';
			const expectedTurnId = inputString(input.expectedTurnId);
			if (!connectorId || !sessionId || !text || (delivery === 'steer' && !expectedTurnId)) return null;
			return {
				...base,
				kind: 'session.send',
				input: {
					connectorId,
					sessionId,
					text,
					delivery,
					...(delivery === 'steer' ? { expectedTurnId } : {})
				}
			};
		}
		case 'interrupt-agent-session': {
			const connectorId = inputString(input.connectorId);
			const sessionId = inputString(input.sessionId || intent.targetId);
			const turnId = inputString(input.turnId);
			if (!connectorId || !sessionId || !turnId) return null;
			return { ...base, kind: 'session.interrupt', input: { connectorId, sessionId, turnId } };
		}
		case 'launch-app': {
			const appId = inputString(input.appId || input.bundleId || intent.targetId);
			return appId ? { ...base, kind: 'app.focus', input: { appId } } : null;
		}
		case 'quit-app': {
			const appId = inputString(input.appId || input.bundleId || intent.targetId);
			return appId ? { ...base, kind: 'app.quit', input: { appId } } : null;
		}
		case 'force-quit-app': {
			const appId = inputString(input.appId || input.bundleId || intent.targetId);
			return appId ? { ...base, kind: 'app.force-quit', input: { appId } } : null;
		}
		case 'set-volume': {
			const level = unit(intent.desired?.volume ?? input.level);
			return level === null ? null : { ...base, kind: 'system.volume.set', input: { level } };
		}
		case 'set-muted': {
			const muted = typeof intent.desired?.muted === 'boolean' ? intent.desired.muted : input.muted;
			return typeof muted === 'boolean' ? { ...base, kind: 'system.audio.mute.set', input: { muted } } : null;
		}
		case 'set-input-volume': {
			const level = unit(input.level);
			return level === null ? null : { ...base, kind: 'system.audio.input.volume.set', input: { level } };
		}
		case 'set-input-muted': {
			const muted = input.muted;
			return typeof muted === 'boolean' ? { ...base, kind: 'system.audio.input.mute.set', input: { muted } } : null;
		}
		case 'set-audio-output': {
			const deviceId = inputString(input.deviceId || intent.targetId);
			return deviceId ? { ...base, kind: 'system.audio.output.set', input: { deviceId } } : null;
		}
		case 'set-audio-input': {
			const deviceId = inputString(input.deviceId || intent.targetId);
			return deviceId ? { ...base, kind: 'system.audio.input.set', input: { deviceId } } : null;
		}
		case 'set-sound-effects-output': {
			const deviceId = inputString(input.deviceId || intent.targetId);
			return deviceId ? { ...base, kind: 'system.audio.sound-effects-output.set', input: { deviceId } } : null;
		}
		case 'set-sound-effects-volume': {
			const level = unit(input.level);
			return level === null ? null : { ...base, kind: 'system.audio.sound-effects.volume.set', input: { level } };
		}
		case 'set-sound-effects-muted': {
			const muted = input.muted;
			return typeof muted === 'boolean' ? { ...base, kind: 'system.audio.sound-effects.mute.set', input: { muted } } : null;
		}
		case 'set-brightness': {
			const level = unit(intent.desired?.brightness ?? input.level);
			return level === null ? null : { ...base, kind: 'system.brightness.set', input: { level } };
		}
		case 'set-display-brightness': {
			const displayId = Number(input.displayId ?? intent.targetId), level = unit(input.level);
			return Number.isSafeInteger(displayId) && displayId > 0 && level !== null ? { ...base, kind: 'system.display.brightness.set', input: { displayId, level } } : null;
		}
		case 'set-display-mode': {
			const displayId = Number(input.displayId ?? intent.targetId), modeId = inputString(input.modeId);
			return Number.isSafeInteger(displayId) && displayId > 0 && modeId ? { ...base, kind: 'system.display.mode.set', input: { displayId, modeId } } : null;
		}
		case 'set-display-origin': {
			const displayId = Number(input.displayId ?? intent.targetId), x = Number(input.x), y = Number(input.y);
			return Number.isSafeInteger(displayId) && displayId > 0 && Number.isSafeInteger(x) && Number.isSafeInteger(y) ? { ...base, kind: 'system.display.origin.set', input: { displayId, x, y } } : null;
		}
		case 'set-display-mirroring': {
			const displayId = Number(input.displayId ?? intent.targetId), sourceDisplayId = input.sourceDisplayId === null ? null : Number(input.sourceDisplayId);
			return Number.isSafeInteger(displayId) && displayId > 0 && (sourceDisplayId === null || (Number.isSafeInteger(sourceDisplayId) && sourceDisplayId > 0)) ? { ...base, kind: 'system.display.mirroring.set', input: { displayId, sourceDisplayId } } : null;
		}
		case 'set-default-printer': {
			const id = inputString(input.id || intent.targetId); return id ? { ...base, kind: 'system.printer.default.set', input: { id } } : null;
		}
		case 'set-preferred-camera': {
			const id = inputString(input.id || intent.targetId); return id ? { ...base, kind: 'system.camera.preferred.set', input: { id } } : null;
		}
		case 'set-bluetooth-device-connected': {
			const id = inputString(input.id || intent.targetId); return id && typeof input.connected === 'boolean' ? { ...base, kind: 'system.bluetooth.device.connection.set', input: { id, connected: input.connected } } : null;
		}
		case 'set-vpn-connected': {
			const id = inputString(input.id || intent.targetId); return id && typeof input.connected === 'boolean' ? { ...base, kind: 'system.vpn.connection.set', input: { id, connected: input.connected } } : null;
		}
		case 'set-prevent-idle-sleep':
			return typeof input.enabled === 'boolean' ? { ...base, kind: 'system.power.idle-sleep-prevention.set', input: { enabled: input.enabled } } : null;
		case 'set-power-idle-timer': {
			const scope = input.scope;
			const minutes = typeof input.minutes === 'number' && Number.isSafeInteger(input.minutes) && input.minutes >= 0 && input.minutes <= 180 ? input.minutes : null;
			return (scope === 'display' || scope === 'system' || scope === 'disk') && minutes !== null
				? { ...base, kind: 'system.power.idle-timer.set', input: { scope, minutes } }
				: null;
		}
		case 'propose-airdrop-policy-profile':
			return typeof input.enabled === 'boolean' ? { ...base, kind: 'system.policy.airdrop.profile.propose', input: { enabled: input.enabled } } : null;
		case 'propose-camera-policy-profile':
			return typeof input.enabled === 'boolean' ? { ...base, kind: 'system.policy.camera.profile.propose', input: { enabled: input.enabled } } : null;
		case 'set-apple-music-playback': {
			const operation = input.operation;
			return operation === 'play' || operation === 'pause' || operation === 'next' || operation === 'previous'
				? { ...base, kind: 'system.media.apple-music.playback.set', input: { operation } }
				: null;
		}
		case 'set-apple-music-volume': {
			const level = input.level;
			return typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 1
				? { ...base, kind: 'system.media.apple-music.volume.set', input: { level } }
				: null;
		}
		case 'set-spotify-playback': {
			const operation = input.operation;
			return operation === 'play' || operation === 'pause' || operation === 'next' || operation === 'previous'
				? { ...base, kind: 'system.media.spotify.playback.set', input: { operation } }
				: null;
		}
		case 'set-spotify-volume': {
			const level = input.level;
			return typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 1
				? { ...base, kind: 'system.media.spotify.volume.set', input: { level } }
				: null;
		}
		case 'set-chrome-youtube-volume': {
			const level = input.level;
			return typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 1
				? { ...base, kind: 'system.media.chrome-youtube.volume.set', input: { level } }
				: null;
		}
		case 'move-pointer': {
			const displayId = Number(input.displayId ?? intent.targetId), x = Number(input.x), y = Number(input.y);
			return Number.isSafeInteger(displayId) && displayId > 0 && Number.isSafeInteger(x) && x >= 0 && x <= 32_768 && Number.isSafeInteger(y) && y >= 0 && y <= 32_768
				? { ...base, kind: 'input.pointer.move', input: { displayId, x, y } }
				: null;
		}
		case 'click-pointer': {
			const displayId = Number(input.displayId ?? intent.targetId), x = Number(input.x), y = Number(input.y), button = input.button;
			return Number.isSafeInteger(displayId) && displayId > 0 && Number.isSafeInteger(x) && x >= 0 && x <= 32_768 && Number.isSafeInteger(y) && y >= 0 && y <= 32_768 && (button === 'left' || button === 'right' || button === 'middle')
				? { ...base, kind: 'input.pointer.click', input: { displayId, x, y, button } }
				: null;
		}
		case 'scroll-pointer': {
			const deltaX = Number(input.deltaX), deltaY = Number(input.deltaY);
			return Number.isSafeInteger(deltaX) && deltaX >= -5_000 && deltaX <= 5_000 && Number.isSafeInteger(deltaY) && deltaY >= -5_000 && deltaY <= 5_000 && (deltaX !== 0 || deltaY !== 0)
				? { ...base, kind: 'input.pointer.scroll', input: { deltaX, deltaY } }
				: null;
		}
		case 'type-text': {
			const text = typeof input.text === 'string' ? input.text : '';
			return text.length > 0 && new TextEncoder().encode(text).length <= 4_096 && !containsUnsafeInputControl(text)
				? { ...base, kind: 'input.keyboard.type', input: { text } }
				: null;
		}
		case 'send-shortcut': {
			const key = typeof input.key === 'string' ? input.key : '', modifiers = Array.isArray(input.modifiers) ? input.modifiers : [];
			return /^(?:[a-z0-9]|return|tab|space|delete|escape|left|right|up|down|home|end|pageup|pagedown|f(?:[1-9]|1[0-2]))$/u.test(key) && modifiers.length <= 5 && modifiers.every((modifier) => modifier === 'command' || modifier === 'control' || modifier === 'option' || modifier === 'shift' || modifier === 'function') && new Set(modifiers).size === modifiers.length
				? { ...base, kind: 'input.keyboard.shortcut', input: { key, modifiers } }
				: null;
		}
		case 'lock':
			return { ...base, kind: 'system.lock', input: {} };
		case 'connect-wifi': {
			const ssid = inputString(input.ssid || intent.targetId);
			return ssid ? { ...base, kind: 'system.wifi.connect', input: { ssid } } : null;
		}
		case 'disconnect-wifi':
			return { ...base, kind: 'system.wifi.disconnect', input: {} };
		case 'set-wifi-power': {
			const enabled = input.enabled;
			return typeof enabled === 'boolean' ? { ...base, kind: 'system.wifi.power.set', input: { enabled } } : null;
		}
		case 'hide-app': {
			const appId = inputString(input.appId || input.bundleId || intent.targetId);
			return appId ? { ...base, kind: 'app.hide', input: { appId } } : null;
		}
		case 'unhide-app': {
			const appId = inputString(input.appId || input.bundleId || intent.targetId);
			return appId ? { ...base, kind: 'app.unhide', input: { appId } } : null;
		}
		case 'hide-other-apps':
			return { ...base, kind: 'app.hide-others', input: {} };
		case 'sleep':
			return { ...base, kind: 'system.sleep', input: {} };
		case 'restart': return { ...base, kind: 'system.restart', input: {} };
		case 'shutdown': return { ...base, kind: 'system.shutdown', input: {} };
		case 'logout': return { ...base, kind: 'system.logout', input: {} };
		default:
			return null;
	}
};

export type UseDeviceStoreOptions = {
	userId: string | null | undefined;
	selectedDeviceId?: string | null;
	enabled?: boolean;
};

export const useDeviceStore = ({ userId, selectedDeviceId = null, enabled = true }: UseDeviceStoreOptions) => {
	const ownerId = userId || null;
	const active = enabled && Boolean(ownerId);
	const api = useDeviceApi();
	const lopu = useLopu();
	const lopuRef = useRef(lopu);
	lopuRef.current = lopu;
	const [store, setStore] = useState<StoreState>(() => seedStore(ownerId, selectedDeviceId));
	const storeRef = useRef(store);
	storeRef.current = store;
	const listRequestRef = useRef<{ ownerId: string; promise: Promise<void> } | null>(null);
	const detailRequestsRef = useRef(new Map<string, Promise<DeviceRuntimeState | null>>());
	const actionTokensRef = useRef(new Map<string, string>());
	const reportedErrorsRef = useRef(new Map<string, string>());

	useEffect(() => {
		if (storeRef.current.ownerId === ownerId) return;
		const next = seedStore(ownerId, selectedDeviceId);
		storeRef.current = next;
		setStore(next);
		listRequestRef.current = null;
		detailRequestsRef.current.clear();
		actionTokensRef.current.clear();
		reportedErrorsRef.current.clear();
	}, [ownerId, selectedDeviceId]);

	useEffect(() => {
		if (!ownerId || !selectedDeviceId || store.ownerId !== ownerId) return;
		const cached = readDeviceDetailCache(ownerId, selectedDeviceId);
		if (!cached) return;
		setStore((previous) => {
			if (previous.ownerId !== ownerId) return previous;
			const current = previous.states[selectedDeviceId];
			if (current?.snapshot && current.snapshot.revision >= (cached.snapshot?.revision || 0)) return previous;
			return { ...previous, states: { ...previous.states, [selectedDeviceId]: cached } };
		});
	}, [ownerId, selectedDeviceId, store.ownerId]);

	const notifyError = useCallback((key: string, title: string, error: unknown) => {
		const message = apiErrorMessage(error, 'Please try again.');
		if (reportedErrorsRef.current.get(key) === message) return;
		reportedErrorsRef.current.set(key, message);
		lopuRef.current({ title, description: message, status: 'error' });
	}, []);

	const refreshList = useCallback(async (): Promise<void> => {
		if (!active || !ownerId) return;
		const inFlight = listRequestRef.current;
		if (inFlight?.ownerId === ownerId) return inFlight.promise;
		setStore((previous) => (previous.ownerId === ownerId ? { ...previous, listRefreshing: true } : previous));
		const promise = (async () => {
			try {
				const response = await api.listDevices();
				const devices = Array.isArray(response.devices) ? response.devices : [];
				setStore((previous) => {
					if (previous.ownerId !== ownerId) return previous;
					const states: Record<string, DeviceRuntimeState> = {};
					const counts: Record<string, DevicePendingCounts> = {};
					for (const device of devices) {
						if (!device?.id) continue;
						states[device.id] = publicDeviceToRuntime(device, previous.states[device.id] || null);
						counts[device.id] = {
							commands: Math.max(0, Number(device.pendingCommandCount) || 0),
							approvals: Math.max(0, Number(device.pendingApprovalCount) || 0)
						};
					}
					return { ...previous, states, counts, listLoaded: true, listRefreshing: false };
				});
				reportedErrorsRef.current.delete('list');
			} catch (error) {
				if (!(error instanceof Error && error.name === 'AbortError')) {
					notifyError('list', 'Couldn’t refresh your computers 😔', error);
				}
				setStore((previous) => (previous.ownerId === ownerId ? { ...previous, listLoaded: true, listRefreshing: false } : previous));
			} finally {
				if (listRequestRef.current?.promise === promise) listRequestRef.current = null;
			}
		})();
		listRequestRef.current = { ownerId, promise };
		return promise;
	}, [active, api, notifyError, ownerId]);

	const refreshDevice = useCallback(
		async (deviceId: string, options: { quiet?: boolean } = {}): Promise<DeviceRuntimeState | null> => {
			if (!active || !ownerId || !deviceId) return null;
			const existing = detailRequestsRef.current.get(deviceId);
			if (existing) return existing;
			setStore((previous) => {
				if (previous.ownerId !== ownerId || previous.loadingDeviceIds.has(deviceId)) return previous;
				const loadingDeviceIds = new Set(previous.loadingDeviceIds).add(deviceId);
				return { ...previous, loadingDeviceIds };
			});
			const promise = (async () => {
				try {
					const [deviceResult, commandsResult, approvalsResult, screensResult] = await Promise.allSettled([
						api.listDevices(deviceId),
						api.listCommands(deviceId),
						api.listApprovals(deviceId),
						api.listScreenSessions(deviceId)
					]);
					if (deviceResult.status === 'rejected') throw deviceResult.reason;
					const device = deviceResult.value.device || deviceResult.value.devices?.[0];
					if (!device) throw new Error('Device not found');
					const previous = storeRef.current.ownerId === ownerId ? storeRef.current.states[deviceId] || null : null;
					let next = publicDeviceToRuntime(device, previous);
					next = {
						...next,
						commands:
							commandsResult.status === 'fulfilled'
								? runtimeCommands(commandsResult.value.commands || [], previous?.commands || [])
								: previous?.commands || [],
						approvals:
							approvalsResult.status === 'fulfilled'
								? (approvalsResult.value.approvals || []).map(publicDeviceApprovalToRuntime)
								: previous?.approvals || [],
						screenSessions:
							screensResult.status === 'fulfilled'
								? (screensResult.value.sessions || []).map(publicDeviceScreenToRuntime)
								: previous?.screenSessions || [],
						lastEventSequence: previous?.lastEventSequence || 0
					};
					setStore((current) => {
						if (current.ownerId !== ownerId) return current;
						const latest = current.states[deviceId];
						const committed = {
							...next,
							lastEventSequence: Math.max(next.lastEventSequence, latest?.lastEventSequence || 0)
						};
						return {
							...current,
							states: { ...current.states, [deviceId]: committed },
							counts: {
								...current.counts,
								[deviceId]: {
									commands: Math.max(0, Number(device.pendingCommandCount) || 0),
									approvals: Math.max(0, Number(device.pendingApprovalCount) || 0)
								}
							}
						};
					});
					if (commandsResult.status === 'rejected' || approvalsResult.status === 'rejected' || screensResult.status === 'rejected') {
						notifyError(
							`detail-partial:${deviceId}`,
							'Some device activity couldn’t refresh',
							commandsResult.status === 'rejected'
								? commandsResult.reason
								: approvalsResult.status === 'rejected'
								? approvalsResult.reason
								: screensResult.status === 'rejected'
								? screensResult.reason
								: new Error('Device activity unavailable')
						);
					} else {
						reportedErrorsRef.current.delete(`detail-partial:${deviceId}`);
					}
					reportedErrorsRef.current.delete(`detail:${deviceId}`);
					return next;
				} catch (error) {
					if (!options.quiet && !(error instanceof Error && error.name === 'AbortError')) {
						notifyError(`detail:${deviceId}`, 'Couldn’t refresh that computer 😔', error);
					}
					return null;
				} finally {
					setStore((previous) => {
						if (previous.ownerId !== ownerId || !previous.loadingDeviceIds.has(deviceId)) return previous;
						const loadingDeviceIds = new Set(previous.loadingDeviceIds);
						loadingDeviceIds.delete(deviceId);
						return { ...previous, loadingDeviceIds };
					});
					detailRequestsRef.current.delete(deviceId);
				}
			})();
			detailRequestsRef.current.set(deviceId, promise);
			return promise;
		},
		[active, api, notifyError, ownerId]
	);

	useEffect(() => {
		if (!active) return;
		void refreshList();
		const timer = window.setInterval(() => void refreshList(), LIST_REFRESH_MS);
		return () => window.clearInterval(timer);
	}, [active, refreshList]);

	useEffect(() => {
		if (!active || !selectedDeviceId) return;
		void refreshDevice(selectedDeviceId);
	}, [active, refreshDevice, selectedDeviceId]);

	useEffect(() => {
		if (!active || !ownerId || !selectedDeviceId) return;
		const controller = new AbortController();
		let cancelled = false;
		let cursor = readEventCursor(ownerId, selectedDeviceId);
		let catchingUp = cursor === null;
		let failures = 0;

		const run = async () => {
			while (!cancelled) {
				try {
					const page = await api.pollEvents(
						{
							deviceId: selectedDeviceId,
							cursor,
							waitMs: catchingUp ? 0 : EVENT_WAIT_MS,
							limit: EVENT_PAGE_SIZE
						},
						controller.signal
					);
					if (cancelled) return;
					failures = 0;
					const advanced = Boolean(page.cursor && page.cursor !== cursor);
					cursor = page.cursor || cursor;
					writeEventCursor(ownerId, selectedDeviceId, cursor);
					if (page.events.length) {
						setStore((previous) => {
							if (previous.ownerId !== ownerId || !previous.states[selectedDeviceId]) return previous;
							const current = previous.states[selectedDeviceId];
							return {
								...previous,
								states: {
									...previous.states,
									[selectedDeviceId]: {
										...current,
										lastEventSequence: current.lastEventSequence + page.events.length
									}
								}
							};
						});
						await refreshDevice(selectedDeviceId, { quiet: true });
					}
					if (catchingUp && page.events.length >= EVENT_PAGE_SIZE && advanced) continue;
					catchingUp = false;
					reportedErrorsRef.current.delete(`events:${selectedDeviceId}`);
				} catch (error) {
					if (cancelled || (error instanceof Error && error.name === 'AbortError')) return;
					failures += 1;
					const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : null;
					if (status === 400 && cursor) {
						clearLocalCache(eventCursorKey(ownerId, selectedDeviceId));
						cursor = null;
						catchingUp = true;
					}
					notifyError(`events:${selectedDeviceId}`, 'Live computer updates paused', error);
					const retryDelay = Math.min(10_000, 1_000 * 2 ** Math.min(failures, 3));
					await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
				}
			}
		};
		void run();
		return () => {
			cancelled = true;
			controller.abort();
		};
	}, [active, api, notifyError, ownerId, refreshDevice, selectedDeviceId]);

	const visibleStore = store.ownerId === ownerId ? store : seedStore(ownerId, selectedDeviceId);
	const devices = useMemo(
		() =>
			Object.values(visibleStore.states)
				.filter((state): state is DeviceRuntimeState & { summary: DeviceSummary } => Boolean(state.summary))
				.sort((left, right) => {
					const leftSeen = left.summary.lastSeenAt ? Date.parse(left.summary.lastSeenAt) : 0;
					const rightSeen = right.summary.lastSeenAt ? Date.parse(right.summary.lastSeenAt) : 0;
					return rightSeen - leftSeen || left.summary.name.localeCompare(right.summary.name);
				}),
		[visibleStore.states]
	);
	const selectedState = selectedDeviceId ? visibleStore.states[selectedDeviceId] || null : null;

	useEffect(() => {
		if (!ownerId || store.ownerId !== ownerId) return;
		const summaries = Object.values(store.states)
			.map((state) => state.summary)
			.filter((summary): summary is DeviceSummary => Boolean(summary));
		writeDeviceListCache(ownerId, summaries);
	}, [ownerId, store.ownerId, store.states]);

	useEffect(() => {
		if (!ownerId || !selectedDeviceId || store.ownerId !== ownerId) return;
		const state = store.states[selectedDeviceId];
		if (state) writeDeviceDetailCache(ownerId, state);
	}, [ownerId, selectedDeviceId, store.ownerId, store.states]);

	const tokenFor = useCallback((deviceId: string, action: DeviceActionKind, targetKey?: string | null): string => {
		const key = `${deviceId}\0${action}\0${targetKey || ''}`;
		let token = actionTokensRef.current.get(key);
		if (!token) {
			token = randomRequestId();
			actionTokensRef.current.set(key, token);
		}
		return token;
	}, []);

	const rotateToken = useCallback((deviceId: string, action: DeviceActionKind) => {
		const prefix = `${deviceId}\0${action}\0`;
		for (const key of actionTokensRef.current.keys()) {
			if (key.startsWith(prefix)) actionTokensRef.current.delete(key);
		}
	}, []);

	const controlFor = useCallback<DeviceControlResolver>(
		(action, targetKey) => {
			if (!selectedState?.summary) return null;
			let policy: DeviceActionPolicy;
			if (LOCAL_ACTIONS.has(action)) {
				policy = blockedPolicy('Complete this setup action in the local Thingtime desktop app.', 'local-only');
			} else if (SCREEN_ACTIONS.has(action)) {
				policy = blockedPolicy('Live screen sessions are not installed in this desktop node yet.');
			} else if (action === 'respond-approval') {
				const approval = selectedState.approvals.find(
					(entry) => entry.status === 'pending' && (targetKey === entry.id || targetKey?.startsWith(`${entry.id}:`))
				);
				policy = approval ? approvalPolicy() : blockedPolicy('That approval is no longer pending.');
			} else {
				const connector = selectedState.snapshot?.connectors.find((entry) => targetKey === entry.id || targetKey?.startsWith(`${entry.id}:`));
				policy = deviceActionPolicy(selectedState, action, {
					connectorId:
						action === 'create-agent-session' || action === 'send-agent-message' || action === 'interrupt-agent-session'
							? connector?.id || targetKey || null
							: null,
					capabilityId: action === 'set-connector-enabled' ? 'set-connector-enabled' : undefined
				});
			}
			const idempotencyKey = tokenFor(selectedState.deviceId, action, targetKey);
			const control: DeviceActionControl = { policy, idempotencyKey };
			return control;
		},
		[selectedState, tokenFor]
	);

	const executeAction = useCallback(
		async (intent: DeviceActionIntent): Promise<void> => {
			if (!active || !ownerId) return;
			const state = storeRef.current.ownerId === ownerId ? storeRef.current.states[intent.deviceId] : null;
			if (!state) return;
			rotateToken(intent.deviceId, intent.action);

			if (intent.action === 'respond-approval') {
				const approvalId = inputString(intent.input?.requestId || intent.targetId);
				const decision = intent.input?.decision === 'denied' ? 'denied' : 'approved';
				if (!approvalId) return;
				setStore((previous) => {
					if (previous.ownerId !== ownerId || !previous.states[intent.deviceId]) return previous;
					const current = previous.states[intent.deviceId];
					return {
						...previous,
						states: {
							...previous.states,
							[intent.deviceId]: {
								...current,
								approvals: current.approvals.map((approval) =>
									approval.id === approvalId
										? { ...approval, status: decision, decidedAt: new Date().toISOString(), revision: approval.revision + 1 }
										: approval
								)
							}
						}
					};
				});
				try {
					const response = await api.decideApproval({ approvalId, decision });
					const incoming = publicDeviceApprovalToRuntime(response.approval);
					setStore((previous) => {
						if (previous.ownerId !== ownerId || !previous.states[intent.deviceId]) return previous;
						const current = previous.states[intent.deviceId];
						return {
							...previous,
							states: {
								...previous.states,
								[intent.deviceId]: {
									...current,
									approvals: [incoming, ...current.approvals.filter((approval) => approval.id !== incoming.id)]
								}
							},
							counts: {
								...previous.counts,
								[intent.deviceId]: {
									commands: previous.counts[intent.deviceId]?.commands || 0,
									approvals: Math.max(0, (previous.counts[intent.deviceId]?.approvals || 1) - 1)
								}
							}
						};
					});
					await refreshDevice(intent.deviceId, { quiet: true });
				} catch (error) {
					notifyError(`action:${intent.idempotencyKey}`, 'Couldn’t respond to that approval 😔', error);
					await refreshDevice(intent.deviceId, { quiet: true });
				}
				return;
			}

			if (intent.action === 'start-screen-session' || intent.action === 'stop-screen-session') {
				// The server projection can describe already-existing sessions, but
				// this desktop build has no media operation to back a start/stop UI.
				return;
			}

			const wire = commandInputForIntent(intent);
			if (!wire) {
				notifyError(`action:${intent.idempotencyKey}`, 'That device action isn’t available yet', new Error('The action input was incomplete.'));
				return;
			}
			const policy = deviceActionPolicy(state, intent.action, {
				connectorId: inputString(wire.input.connectorId) || null,
				capabilityId: intent.action === 'set-connector-enabled' ? 'set-connector-enabled' : undefined
			});
			if (!policy.allowed) return;
			wire.requiresApproval = policy.approvalRequired;
			const now = new Date().toISOString();
			const optimistic: DeviceCommand = {
				id: `local:${intent.idempotencyKey}`,
				deviceId: intent.deviceId,
				requestId: intent.idempotencyKey,
				idempotencyKey: intent.idempotencyKey,
				action: intent.action,
				kind: wire.kind as DeviceActionKind,
				status: wire.requiresApproval ? 'needs-approval' : 'queued',
				revision: safeRevisionFromTime(now, wire.requiresApproval ? 4 : 1),
				createdAt: now,
				updatedAt: now,
				expiresAt: null,
				baseObservationRevision: state.snapshot?.revision ?? null,
				desired: intent.desired || null,
				args: wire.input
			};
			setStore((previous) => {
				if (previous.ownerId !== ownerId || !previous.states[intent.deviceId]) return previous;
				const current = previous.states[intent.deviceId];
				return {
					...previous,
					states: {
						...previous.states,
						[intent.deviceId]: { ...current, commands: reconcileDeviceCommand(current.commands, optimistic) }
					},
					counts: {
						...previous.counts,
						[intent.deviceId]: {
							commands: (previous.counts[intent.deviceId]?.commands || 0) + 1,
							approvals: previous.counts[intent.deviceId]?.approvals || 0
						}
					}
				};
			});
			try {
				const response = await api.createCommand(wire);
				const authoritative = publicDeviceCommandToRuntime(response.command, optimistic);
				setStore((previous) => {
					if (previous.ownerId !== ownerId || !previous.states[intent.deviceId]) return previous;
					const current = previous.states[intent.deviceId];
					return {
						...previous,
						states: {
							...previous.states,
							[intent.deviceId]: { ...current, commands: reconcileDeviceCommand(current.commands, authoritative) }
						}
					};
				});
			} catch (error) {
				notifyError(`action:${intent.idempotencyKey}`, 'Couldn’t send that computer action 😔', error);
				if (hasUnknownMutationOutcome(error)) {
					await refreshDevice(intent.deviceId, { quiet: true });
				} else {
					const failed: DeviceCommand = {
						...optimistic,
						status: 'failed',
						revision: optimistic.revision + 1,
						updatedAt: new Date().toISOString(),
						error: { code: 'request-rejected', message: apiErrorMessage(error, 'The command was rejected.') }
					};
					setStore((previous) => {
						if (previous.ownerId !== ownerId || !previous.states[intent.deviceId]) return previous;
						const current = previous.states[intent.deviceId];
						return {
							...previous,
							states: {
								...previous.states,
								[intent.deviceId]: { ...current, commands: reconcileDeviceCommand(current.commands, failed) }
							},
							counts: {
								...previous.counts,
								[intent.deviceId]: {
									commands: Math.max(0, (previous.counts[intent.deviceId]?.commands || 1) - 1),
									approvals: previous.counts[intent.deviceId]?.approvals || 0
								}
							}
						};
					});
				}
			}
		},
		[active, api, notifyError, ownerId, refreshDevice, rotateToken]
	);

	const setPermissionMode = useCallback(
		async (deviceId: string, mode: DeviceExecutionPermissionMode): Promise<void> => {
			if (!active || !ownerId) return;
			const priorMode = storeRef.current.states[deviceId]?.summary?.permissionMode || 'always-allow';
			if (priorMode === mode) return;
			setStore((previous) => {
				const current = previous.states[deviceId];
				if (previous.ownerId !== ownerId || !current?.summary) return previous;
				return {
					...previous,
					states: {
						...previous.states,
						[deviceId]: { ...current, summary: { ...current.summary, permissionMode: mode } }
					}
				};
			});
			try {
				const result = await api.setPermissionMode({ deviceId, mode });
				setStore((previous) => {
					const current = previous.states[deviceId];
					if (previous.ownerId !== ownerId || !current?.summary) return previous;
					return {
						...previous,
						states: {
							...previous.states,
							[deviceId]: { ...current, summary: { ...current.summary, permissionMode: result.mode } }
						}
					};
				});
			} catch (error) {
				setStore((previous) => {
					const current = previous.states[deviceId];
					if (previous.ownerId !== ownerId || !current?.summary || current.summary.permissionMode !== mode) return previous;
					return {
						...previous,
						states: {
							...previous.states,
							[deviceId]: { ...current, summary: { ...current.summary, permissionMode: priorMode } }
						}
					};
				});
				notifyError(`permission-mode:${deviceId}`, 'Couldn’t save that device permission preference', error);
			}
		},
		[active, api, notifyError, ownerId]
	);

	return {
		devices,
		statesById: visibleStore.states,
		countsById: visibleStore.counts,
		selectedState,
		loading: active && !visibleStore.listLoaded && devices.length === 0,
		refreshing: visibleStore.listRefreshing,
		selectedLoading: selectedDeviceId ? visibleStore.loadingDeviceIds.has(selectedDeviceId) : false,
		refreshList,
		refreshDevice,
		controlFor,
		executeAction,
		setPermissionMode
	};
};
