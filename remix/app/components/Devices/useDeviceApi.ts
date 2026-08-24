import { useCallback, useMemo } from 'react';

import { createApiFailure, readApiResponsePayload } from '~/hooks/apiFailure';

export const PUBLIC_DEVICE_COMMAND_KINDS = [
	'connector.start',
	'connector.stop',
	'session.list',
	'session.read',
	'session.create',
	'session.send',
	'session.interrupt',
	'approval.respond',
	'app.focus',
	'app.launch',
	'app.quit',
	'app.force-quit',
	'app.hide',
	'app.unhide',
	'app.hide-others',
	'system.volume.set',
	'system.audio.mute.set',
	'system.audio.input.volume.set',
	'system.audio.input.mute.set',
	'system.audio.output.set',
	'system.audio.input.set',
	'system.audio.sound-effects.volume.set',
	'system.audio.sound-effects.mute.set',
	'system.audio.sound-effects-output.set',
	'system.brightness.set',
	'system.display.brightness.set',
	'system.display.mode.set',
	'system.display.origin.set',
	'system.display.mirroring.set',
	'system.printer.default.set',
	'system.camera.preferred.set',
	'system.bluetooth.device.connection.set',
	'system.vpn.connection.set',
	'system.power.idle-sleep-prevention.set',
	'system.power.idle-timer.set',
	'system.policy.airdrop.profile.propose',
	'system.policy.camera.profile.propose',
	'system.media.apple-music.playback.set',
	'system.media.apple-music.volume.set',
	'system.media.spotify.playback.set',
	'system.media.spotify.volume.set',
	'system.media.chrome-youtube.volume.set',
	'system.lock',
	'system.sleep',
	'system.restart',
	'system.shutdown',
	'system.logout',
	'system.wifi.connect',
	'system.wifi.disconnect',
	'system.wifi.power.set',
	'screen.start',
	'screen.stop'
] as const;

export type PublicDeviceCommandKind = (typeof PUBLIC_DEVICE_COMMAND_KINDS)[number];
export type PublicDevicePermissionMode = 'always-allow' | 'ask-every-time' | 'deny';
export type PublicDeviceCommandStatus = 'queued' | 'claimed' | 'running' | 'needs-approval' | 'succeeded' | 'failed' | 'cancelled' | 'needs-review';
export type PublicDeviceScreenStatus = 'requested' | 'awaiting-local-approval' | 'connecting' | 'active' | 'ended' | 'failed';

export type PublicDeviceOpenApp = {
	id: string;
	name: string;
	frontmost: boolean;
	hidden: boolean;
};

export type PublicDeviceState = {
	id: string;
	revision: number;
	locked: boolean;
	volume: number | null;
	muted: boolean | null;
	inputVolume?: number | null;
	inputMuted?: boolean | null;
	soundEffectsVolume?: number | null;
	soundEffectsMuted?: boolean | null;
	brightness: number | null;
	battery: { level: number | null; charging: boolean | null; isExternalPower?: boolean | null; isPreventingIdleSleep?: boolean; isLowPowerModeEnabled?: boolean } | null;
	powerTimers?: { displayIdleMinutes: number | null; systemSleepMinutes: number | null; diskIdleMinutes: number | null };
	openApps: PublicDeviceOpenApp[];
	audioDevices: Array<{
		id: string;
		name: string;
		hasInput: boolean;
		hasOutput: boolean;
		isDefaultInput: boolean;
		isDefaultOutput: boolean;
		isDefaultSoundEffectsOutput: boolean;
	}>;
	wifi: { powerOn: boolean | null; ssid: string | null } | null;
	displays?: Array<{ id: number; width: number; height: number; isMain: boolean; isBuiltIn: boolean; brightness: number | null; brightnessControlSupported: boolean; currentMode: { id: string; width: number; height: number; refreshRate: number } | null; availableModes: Array<{ id: string; width: number; height: number; refreshRate: number }>; originX: number; originY: number; mirroredDisplayId: number | null; hdrActive: boolean }>;
	printers?: Array<{ id: string; name: string; isDefault: boolean }>;
	cameras?: Array<{ id: string; name: string; isConnected: boolean; isPreferred: boolean; authorization: 'granted' | 'denied' }>;
	bluetoothDevices?: Array<{ id: string; name: string; isConnected: boolean }>;
	vpnServices?: Array<{ id: string; name: string; isConnected: boolean }>;
	appleMusic?: { isInstalled: boolean; isRunning: boolean };
	spotify?: { isInstalled: boolean; isRunning: boolean };
	chromeYouTube?: { isInstalled: boolean; isRunning: boolean };
	observedAt: string;
	updatedAt: string;
};

export type PublicDeviceConnectorProject = {
	projectId: string;
	projectLabel: string;
};

export type PublicDeviceConnector = {
	documentId: string;
	revision: number;
	id: string;
	kind: string;
	label: string;
	status: 'connected' | 'disconnected' | 'degraded' | 'needs-permission';
	capabilities: string[];
	projects: PublicDeviceConnectorProject[];
	updatedAt: string;
};

export type PublicDevice = {
	id: string;
	name: string;
	platform: 'macos' | 'windows' | 'linux';
	model: string | null;
	osVersion: string | null;
	appVersion: string | null;
	capabilities: string[];
	pairedAt: string;
	online: boolean;
	lastSeenAt: string | null;
	locked: boolean | null;
	volume: number | null;
	brightness: number | null;
	battery: { level: number | null; charging: boolean | null; isExternalPower?: boolean | null; isPreventingIdleSleep?: boolean; isLowPowerModeEnabled?: boolean } | null;
	openApps: PublicDeviceOpenApp[];
	state: PublicDeviceState | null;
	connectors: PublicDeviceConnector[];
	pendingCommandCount: number;
	pendingApprovalCount: number;
	permissionMode: PublicDevicePermissionMode;
};

export type PublicDeviceCommand = {
	id: string;
	requestId: string;
	deviceId: string;
	kind: string;
	status: PublicDeviceCommandStatus;
	input: Record<string, unknown>;
	requiresApproval: boolean;
	approvalState: 'not-required' | 'pending' | 'approved' | 'denied';
	error: string | null;
	outputRef: string | null;
	createdAt: string;
	updatedAt: string;
	claimedAt: string | null;
	leaseExpiresAt: string | null;
	completedAt: string | null;
};

export type PublicDeviceApproval = {
	id: string;
	deviceId: string;
	commandId: string;
	requestId: string;
	kind: string;
	prompt: string;
	status: 'pending' | 'approved' | 'denied' | 'expired';
	createdAt: string;
	expiresAt: string | null;
	decidedAt: string | null;
};

export type PublicDeviceScreenSession = {
	id: string;
	deviceId: string;
	requestId: string;
	status: PublicDeviceScreenStatus;
	viewOnly: boolean;
	createdAt: string;
	updatedAt: string;
	startedAt: string | null;
	endedAt: string | null;
	error: string | null;
};

export type PublicDeviceEvent = {
	cursor: string;
	id: string;
	type: string;
	deviceId: string;
	resourceId: string | null;
	revision: number | null;
	at: string;
	payload: Record<string, unknown>;
};

export type DeviceEventsPage = {
	events: PublicDeviceEvent[];
	cursor: string | null;
	serverTime: string | null;
};

export type CreateDeviceCommandInput = {
	deviceId: string;
	requestId: string;
	kind: PublicDeviceCommandKind;
	input: Record<string, unknown>;
	requiresApproval?: boolean;
};

const MAX_EVENT_RESPONSE_BYTES = 1024 * 1024;

const toQuery = (values: Record<string, string | number | null | undefined>): string => {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) {
		if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
	}
	const query = params.toString();
	return query ? `?${query}` : '';
};

const request = async <T>(url: string, options: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal; action: string }): Promise<T> => {
	const method = options.method || 'GET';
	let response: Response;
	try {
		response = await fetch(url, {
			method,
			credentials: 'include',
			signal: options.signal,
			...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body ?? {}) } : {})
		});
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') throw error;
		throw createApiFailure({ cause: error, action: options.action, method });
	}
	const payload = await readApiResponsePayload(response, { action: options.action, method });
	if (!response.ok) {
		throw createApiFailure({
			payload,
			status: response.status,
			retryAfter: response.headers.get('Retry-After'),
			action: options.action,
			method
		});
	}
	return payload as T;
};

const requestEvents = async (
	input: { deviceId: string; cursor?: string | null; waitMs?: number; limit?: number },
	signal?: AbortSignal
): Promise<DeviceEventsPage> => {
	const url = `/api/v1/devices/events${toQuery({
		deviceId: input.deviceId,
		cursor: input.cursor,
		waitMs: input.waitMs,
		limit: input.limit
	})}`;
	let response: Response;
	try {
		response = await fetch(url, { credentials: 'include', signal });
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') throw error;
		throw createApiFailure({ cause: error, action: 'resume device updates', method: 'GET' });
	}
	if (!response.ok) {
		const payload = await readApiResponsePayload(response, { action: 'resume device updates', method: 'GET' });
		throw createApiFailure({
			payload,
			status: response.status,
			retryAfter: response.headers.get('Retry-After'),
			action: 'resume device updates',
			method: 'GET'
		});
	}

	const body = await response.text();
	if (body.length > MAX_EVENT_RESPONSE_BYTES) {
		throw createApiFailure({
			status: 413,
			action: 'resume device updates',
			method: 'GET',
			payload: { ok: false, error: 'The device update batch was unexpectedly large.' }
		});
	}

	const events: PublicDeviceEvent[] = [];
	let cursor: string | null = input.cursor || null;
	let serverTime: string | null = null;
	for (const line of body.split(/\r?\n/)) {
		if (!line.trim()) continue;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			throw createApiFailure({
				status: response.status,
				action: 'resume device updates',
				method: 'GET',
				payload: { ok: false, error: 'Thingtime returned an unreadable device update.' }
			});
		}
		if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
		const record = value as Record<string, unknown>;
		if (record.type === 'hello') {
			serverTime = typeof record.serverTime === 'string' ? record.serverTime : null;
		} else if (record.type === 'cursor') {
			cursor = typeof record.cursor === 'string' && record.cursor.length <= 1024 ? record.cursor : cursor;
		} else if (
			typeof record.cursor === 'string' &&
			typeof record.id === 'string' &&
			typeof record.type === 'string' &&
			typeof record.deviceId === 'string' &&
			typeof record.at === 'string'
		) {
			events.push(record as PublicDeviceEvent);
			cursor = record.cursor;
		}
	}
	return { events, cursor, serverTime };
};

export const useDeviceApi = () => {
	const listDevices = useCallback(
		(deviceId?: string | null, signal?: AbortSignal) =>
			request<{ ok: true; devices: PublicDevice[]; device?: PublicDevice }>(`/api/v1/devices${toQuery({ id: deviceId })}`, {
				action: deviceId ? 'load that device' : 'load your devices',
				signal
			}),
		[]
	);
	const listCommands = useCallback(
		(deviceId: string, signal?: AbortSignal) =>
			request<{ ok: true; commands: PublicDeviceCommand[] }>(`/api/v1/devices/commands${toQuery({ deviceId })}`, {
				action: 'load device commands',
				signal
			}),
		[]
	);
	const createCommand = useCallback(
		(body: CreateDeviceCommandInput, signal?: AbortSignal) =>
			request<{ ok: true; command: PublicDeviceCommand; idempotent: boolean }>('/api/v1/devices/commands', {
				method: 'POST',
				body,
				signal,
				action: 'send that device command'
			}),
		[]
	);
	const listApprovals = useCallback(
		(deviceId: string, signal?: AbortSignal) =>
			request<{ ok: true; approvals: PublicDeviceApproval[] }>(`/api/v1/devices/approvals${toQuery({ deviceId })}`, {
				action: 'load device approvals',
				signal
			}),
		[]
	);
	const decideApproval = useCallback(
		(body: { approvalId: string; decision: 'approved' | 'denied' }, signal?: AbortSignal) =>
			request<{ ok: true; approval: PublicDeviceApproval; idempotent: boolean }>('/api/v1/devices/approvals', {
				method: 'POST',
				body,
				signal,
				action: 'respond to that approval'
			}),
		[]
	);
	const setPermissionMode = useCallback(
		(body: { deviceId: string; mode: PublicDevicePermissionMode }, signal?: AbortSignal) =>
			request<{ ok: true; deviceId: string; mode: PublicDevicePermissionMode }>('/api/v1/devices/permissions', {
				method: 'POST',
				body,
				signal,
				action: 'save device permission preference'
			}),
		[]
	);
	const listScreenSessions = useCallback(
		(deviceId: string, signal?: AbortSignal) =>
			request<{ ok: true; sessions: PublicDeviceScreenSession[] }>(`/api/v1/devices/screen${toQuery({ deviceId })}`, {
				action: 'load device screen sessions',
				signal
			}),
		[]
	);
	const startScreenSession = useCallback(
		(body: { deviceId: string; requestId: string; viewOnly: boolean }, signal?: AbortSignal) =>
			request<{
				ok: true;
				session: PublicDeviceScreenSession;
				command: PublicDeviceCommand;
				idempotent: boolean;
			}>('/api/v1/devices/screen', {
				method: 'POST',
				body: { action: 'start', ...body },
				signal,
				action: 'start that screen session'
			}),
		[]
	);
	const stopScreenSession = useCallback(
		(body: { sessionId: string; requestId: string }, signal?: AbortSignal) =>
			request<{
				ok: true;
				session: PublicDeviceScreenSession;
				command: PublicDeviceCommand;
				idempotent: boolean;
			}>('/api/v1/devices/screen', {
				method: 'POST',
				body: { action: 'stop', ...body },
				signal,
				action: 'stop that screen session'
			}),
		[]
	);
	const pollEvents = useCallback(
		(input: { deviceId: string; cursor?: string | null; waitMs?: number; limit?: number }, signal?: AbortSignal) => requestEvents(input, signal),
		[]
	);

	return useMemo(
		() => ({
			listDevices,
			listCommands,
			createCommand,
			listApprovals,
			decideApproval,
			setPermissionMode,
			listScreenSessions,
			startScreenSession,
			stopScreenSession,
			pollEvents
		}),
		[
			createCommand,
			decideApproval,
			listApprovals,
			listCommands,
			listDevices,
			listScreenSessions,
			pollEvents,
			setPermissionMode,
			startScreenSession,
			stopScreenSession
		]
	);
};
