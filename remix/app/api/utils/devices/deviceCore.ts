import { createHash } from 'node:crypto';

export const DEVICE_COMMAND_KINDS = [
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
	'input.pointer.move',
	'input.pointer.click',
	'input.pointer.scroll',
	'input.keyboard.type',
	'input.keyboard.shortcut',
	'screen.start',
	'screen.stop'
] as const;

export type DeviceCommandKind = (typeof DEVICE_COMMAND_KINDS)[number];

export const DEVICE_PERMISSION_MODES = ['always-allow', 'ask-every-time', 'deny'] as const;
export type DevicePermissionMode = (typeof DEVICE_PERMISSION_MODES)[number];

// Permission mode is an account/device setting. It defaults to always-allow so
// an explicitly paired computer does not interrupt each typed, supported action.
// Commands may still opt in to an approval, while pairing, capability, lock and
// OS privacy checks remain independently fail-closed.
export const normalizeDevicePermissionMode = (value: unknown): DevicePermissionMode =>
	value === 'ask-every-time' || value === 'deny' || value === 'always-allow' ? value : 'always-allow';

// Force quitting can discard unsaved work. It must always create a fresh
// approval, even when the paired device otherwise allows routine controls.
const ALWAYS_APPROVAL_DEVICE_COMMANDS = new Set<DeviceCommandKind>([
	'app.force-quit',
	'system.restart',
	'system.shutdown',
	'system.logout',
	'system.media.apple-music.playback.set',
	'system.media.apple-music.volume.set',
	'system.media.spotify.playback.set',
	'system.media.spotify.volume.set',
	'system.media.chrome-youtube.volume.set',
	'input.pointer.move',
	'input.pointer.click',
	'input.pointer.scroll',
	'input.keyboard.type',
	'input.keyboard.shortcut',
	'system.power.idle-timer.set',
	'system.policy.airdrop.profile.propose',
	'system.policy.camera.profile.propose'
]);

export const deviceCommandRequiresApproval = (kind: DeviceCommandKind, callerRequiresApproval: boolean): boolean =>
	callerRequiresApproval || ALWAYS_APPROVAL_DEVICE_COMMANDS.has(kind);

export const deviceConnectorCommandRequiresApproval = (
	_kind: DeviceCommandKind,
	callerRequiresApproval: boolean,
	_connector: Pick<DeviceConnectorSnapshot, 'kind' | 'capabilities'> | null
): boolean => callerRequiresApproval;

export const DEVICE_COMMAND_STATUSES = [
	'queued',
	'claimed',
	'running',
	'needs-approval',
	'succeeded',
	'failed',
	'cancelled',
	'needs-review'
] as const;

export type DeviceCommandStatus = (typeof DEVICE_COMMAND_STATUSES)[number];

export const DEVICE_COMMAND_APPROVAL_STATES = ['not-required', 'pending', 'approved', 'denied'] as const;
export type DeviceCommandApprovalState = (typeof DEVICE_COMMAND_APPROVAL_STATES)[number];

export const DEVICE_APPROVAL_STATUSES = ['pending', 'approved', 'denied', 'expired'] as const;
export type DeviceApprovalStatus = (typeof DEVICE_APPROVAL_STATUSES)[number];

export const DEVICE_SCREEN_STATUSES = ['requested', 'awaiting-local-approval', 'connecting', 'active', 'ended', 'failed'] as const;
export type DeviceScreenStatus = (typeof DEVICE_SCREEN_STATUSES)[number];

export type DeviceFail = { ok: false; status: number; error: string };
export const deviceFail = (status: number, error: string): DeviceFail => ({ ok: false, status, error });

const bounded = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const containsUnsafeInputControl = (value: string): boolean => Array.from(value).some((character) => {
	const code = character.codePointAt(0) || 0;
	return !(code === 0x09 || code === 0x0a || code === 0x0d || (code > 0x1f && !(code >= 0x7f && code <= 0x9f)));
});

const normalizedScalar = (value: unknown): string | number | boolean | null => {
	if (value === null) return null;
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	return typeof value === 'string' ? value : null;
};

const stableValue = (value: unknown, depth = 0): unknown => {
	if (depth > 10) return null;
	if (Array.isArray(value)) return value.map((entry) => stableValue(entry, depth + 1));
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			out[key] = stableValue((value as Record<string, unknown>)[key], depth + 1);
		}
		return out;
	}
	return normalizedScalar(value);
};

export const stableDeviceJson = (value: unknown): string => JSON.stringify(stableValue(value));

export const deviceHash = (namespace: string, ...parts: string[]): string => {
	const hash = createHash('sha256').update(`thingtime-device:${namespace}:v1`);
	for (const part of parts) hash.update('\0').update(part);
	return hash.digest('hex');
};

export const devicePayloadHash = (value: unknown): string => createHash('sha256').update(stableDeviceJson(value)).digest('hex');

export type DeviceDescriptor = {
	name: string;
	platform: 'macos' | 'windows' | 'linux' | 'watchos';
	model: string | null;
	osVersion: string | null;
	appVersion: string | null;
};

export const normalizeDeviceDescriptor = (value: unknown): DeviceDescriptor | null => {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	if (!Object.keys(raw).every((key) => ['name', 'platform', 'model', 'osVersion', 'appVersion'].includes(key))) return null;
	const name = bounded(raw.name, 120);
	const platform =
		raw.platform === 'macos' || raw.platform === 'windows' || raw.platform === 'linux' || raw.platform === 'watchos'
			? raw.platform
			: null;
	if (!name || !platform) return null;
	return {
		name,
		platform,
		model: bounded(raw.model, 160) || null,
		osVersion: bounded(raw.osVersion, 80) || null,
		appVersion: bounded(raw.appVersion, 80) || null
	};
};

export type DeviceOpenApp = { id: string; name: string; frontmost: boolean; hidden: boolean };
export const MAX_DEVICE_OPEN_APPS = 64;
export type DeviceAudioDevice = {
	id: string;
	name: string;
	hasInput: boolean;
	hasOutput: boolean;
	isDefaultInput: boolean;
	isDefaultOutput: boolean;
	isDefaultSoundEffectsOutput: boolean;
};
export const MAX_DEVICE_AUDIO_DEVICES = 32;
export type DeviceWiFiState = { powerOn: boolean | null; ssid: string | null };
export type DeviceDisplayMode = { id: string; width: number; height: number; refreshRate: number };
export type DeviceDisplay = {
	id: number;
	width: number;
	height: number;
	isMain: boolean;
	isBuiltIn: boolean;
	brightness: number | null;
	brightnessControlSupported: boolean;
	currentMode: DeviceDisplayMode | null;
	availableModes: DeviceDisplayMode[];
	originX: number;
	originY: number;
	mirroredDisplayId: number | null;
	hdrActive: boolean;
};
export type DevicePrinter = { id: string; name: string; isDefault: boolean };
export type DeviceCamera = { id: string; name: string; isConnected: boolean; isPreferred: boolean; authorization: 'granted' | 'denied' };
export type DeviceBluetoothDevice = { id: string; name: string; isConnected: boolean };
export type DeviceVPNService = { id: string; name: string; isConnected: boolean };
export type DeviceBatteryState = { level: number | null; charging: boolean | null; isExternalPower: boolean | null; isPreventingIdleSleep: boolean; isLowPowerModeEnabled: boolean };
export type DevicePowerTimersState = { displayIdleMinutes: number | null; systemSleepMinutes: number | null; diskIdleMinutes: number | null };
export type DeviceAppleMusicState = { isInstalled: boolean; isRunning: boolean };
export type DeviceSpotifyState = { isInstalled: boolean; isRunning: boolean };
export type DeviceChromeYouTubeState = { isInstalled: boolean; isRunning: boolean };
export type DeviceStateSnapshot = {
	locked: boolean;
	volume: number | null;
	muted: boolean | null;
	inputVolume?: number | null;
	inputMuted?: boolean | null;
	soundEffectsVolume?: number | null;
	soundEffectsMuted?: boolean | null;
	brightness: number | null;
	battery: DeviceBatteryState | null;
	powerTimers?: DevicePowerTimersState;
	openApps: DeviceOpenApp[];
	audioDevices: DeviceAudioDevice[];
	wifi?: DeviceWiFiState | null;
	displays?: DeviceDisplay[];
	printers?: DevicePrinter[];
	cameras?: DeviceCamera[];
	bluetoothDevices?: DeviceBluetoothDevice[];
	vpnServices?: DeviceVPNService[];
	appleMusic?: DeviceAppleMusicState;
	spotify?: DeviceSpotifyState;
	chromeYouTube?: DeviceChromeYouTubeState;
};

const unitInterval = (value: unknown): number | null => {
	const number = Number(value);
	return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
};

const boundedInteger = (value: unknown, minimum: number, maximum: number): number | null => {
	const number = Number(value);
	return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : null;
};

const normalizeDisplayMode = (value: unknown): DeviceDisplayMode | null => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const raw = value as Record<string, unknown>;
	if (!Object.keys(raw).every((key) => ['id', 'width', 'height', 'refreshRate'].includes(key))) return null;
	const id = bounded(raw.id, 160);
	const width = boundedInteger(raw.width, 1, 32_768);
	const height = boundedInteger(raw.height, 1, 32_768);
	const refreshRate = Number(raw.refreshRate);
	if (!id || width === null || height === null || !Number.isFinite(refreshRate) || refreshRate < 0 || refreshRate > 1_000) return null;
	return { id, width, height, refreshRate };
};

const normalizeNamedDeviceList = <T>(
	value: unknown,
	maximum: number,
	keys: readonly string[],
	normalize: (raw: Record<string, unknown>) => T | null
): T[] | null => {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > maximum) return null;
	const output: T[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
		const raw = entry as Record<string, unknown>;
		if (!Object.keys(raw).every((key) => keys.includes(key))) return null;
		const normalized = normalize(raw);
		if (!normalized) return null;
		output.push(normalized);
	}
	return output;
};

export const normalizeDeviceState = (value: unknown): DeviceStateSnapshot | null => {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	if (typeof raw.locked !== 'boolean') return null;
	if (
		!Object.keys(raw).every((key) =>
			[
				'locked', 'volume', 'muted', 'inputVolume', 'inputMuted', 'soundEffectsVolume', 'soundEffectsMuted', 'brightness', 'battery', 'powerTimers', 'openApps', 'audioDevices', 'wifi',
				'displays', 'printers', 'cameras', 'bluetoothDevices', 'vpnServices', 'appleMusic', 'spotify', 'chromeYouTube'
			].includes(key)
		)
	)
		return null;
	const appsRaw = raw.openApps === undefined ? [] : raw.openApps;
	if (!Array.isArray(appsRaw) || appsRaw.length > MAX_DEVICE_OPEN_APPS) return null;
	const openApps: DeviceOpenApp[] = [];
	for (const entry of appsRaw) {
		if (!entry || typeof entry !== 'object') return null;
		const app = entry as Record<string, unknown>;
		if (!Object.keys(app).every((key) => ['id', 'name', 'frontmost', 'hidden'].includes(key))) return null;
		const id = bounded(app.id, 160);
		const name = bounded(app.name, 120);
		if (!id || !name) return null;
		openApps.push({ id, name, frontmost: app.frontmost === true, hidden: app.hidden === true });
	}
	const devicesRaw = raw.audioDevices === undefined ? [] : raw.audioDevices;
	if (!Array.isArray(devicesRaw) || devicesRaw.length > MAX_DEVICE_AUDIO_DEVICES) return null;
	const audioDevices: DeviceAudioDevice[] = [];
	for (const entry of devicesRaw) {
		if (!entry || typeof entry !== 'object') return null;
		const device = entry as Record<string, unknown>;
		if (
			!Object.keys(device).every((key) =>
				['id', 'name', 'hasInput', 'hasOutput', 'isDefaultInput', 'isDefaultOutput', 'isDefaultSoundEffectsOutput'].includes(key)
			)
		)
			return null;
		const id = bounded(device.id, 512);
		const name = bounded(device.name, 120);
		if (
			!id ||
			!name ||
			typeof device.hasInput !== 'boolean' ||
			typeof device.hasOutput !== 'boolean' ||
			(!device.hasInput && !device.hasOutput) ||
			typeof device.isDefaultInput !== 'boolean' ||
			typeof device.isDefaultOutput !== 'boolean' ||
			typeof device.isDefaultSoundEffectsOutput !== 'boolean'
		)
			return null;
		audioDevices.push({
			id,
			name,
			hasInput: device.hasInput,
			hasOutput: device.hasOutput,
			isDefaultInput: device.isDefaultInput,
			isDefaultOutput: device.isDefaultOutput,
			isDefaultSoundEffectsOutput: device.isDefaultSoundEffectsOutput
		});
	}
	let battery: DeviceStateSnapshot['battery'] = null;
	if (raw.battery !== undefined && raw.battery !== null) {
		if (!raw.battery || typeof raw.battery !== 'object') return null;
		const candidate = raw.battery as Record<string, unknown>;
		if (!Object.keys(candidate).every((key) => ['level', 'charging', 'isExternalPower', 'isPreventingIdleSleep', 'isLowPowerModeEnabled'].includes(key))) return null;
		const level = candidate.level === null || candidate.level === undefined ? null : unitInterval(candidate.level);
		const charging = candidate.charging === null || candidate.charging === undefined ? null : typeof candidate.charging === 'boolean' ? candidate.charging : null;
		const isExternalPower = candidate.isExternalPower === null || candidate.isExternalPower === undefined ? null : typeof candidate.isExternalPower === 'boolean' ? candidate.isExternalPower : null;
		const isPreventingIdleSleep = candidate.isPreventingIdleSleep ?? false;
		const isLowPowerModeEnabled = candidate.isLowPowerModeEnabled ?? false;
		if ((candidate.level !== null && candidate.level !== undefined && level === null) || (candidate.charging !== null && candidate.charging !== undefined && charging === null) || (candidate.isExternalPower !== null && candidate.isExternalPower !== undefined && isExternalPower === null) || typeof isPreventingIdleSleep !== 'boolean' || typeof isLowPowerModeEnabled !== 'boolean') return null;
		battery = { level, charging, isExternalPower, isPreventingIdleSleep, isLowPowerModeEnabled };
	}
	let powerTimers: DevicePowerTimersState | undefined;
	if (raw.powerTimers !== undefined) {
		if (!raw.powerTimers || typeof raw.powerTimers !== 'object' || Array.isArray(raw.powerTimers)) return null;
		const candidate = raw.powerTimers as Record<string, unknown>;
		if (!exactKeys(candidate, ['displayIdleMinutes', 'systemSleepMinutes', 'diskIdleMinutes'])) return null;
		const displayIdleMinutes = candidate.displayIdleMinutes === null ? null : boundedInteger(candidate.displayIdleMinutes, 0, 180);
		const systemSleepMinutes = candidate.systemSleepMinutes === null ? null : boundedInteger(candidate.systemSleepMinutes, 0, 180);
		const diskIdleMinutes = candidate.diskIdleMinutes === null ? null : boundedInteger(candidate.diskIdleMinutes, 0, 180);
		if ((candidate.displayIdleMinutes !== null && displayIdleMinutes === null) || (candidate.systemSleepMinutes !== null && systemSleepMinutes === null) || (candidate.diskIdleMinutes !== null && diskIdleMinutes === null)) return null;
		powerTimers = { displayIdleMinutes, systemSleepMinutes, diskIdleMinutes };
	}
	const volume = raw.volume === undefined || raw.volume === null ? null : unitInterval(raw.volume);
	let muted: boolean | null = null;
	if (raw.muted !== undefined && raw.muted !== null) {
		if (typeof raw.muted !== 'boolean') return null;
		muted = raw.muted;
	}
	const inputVolume = raw.inputVolume === undefined || raw.inputVolume === null ? null : unitInterval(raw.inputVolume);
	let inputMuted: boolean | null = null;
	if (raw.inputMuted !== undefined && raw.inputMuted !== null) {
		if (typeof raw.inputMuted !== 'boolean') return null;
		inputMuted = raw.inputMuted;
	}
	const soundEffectsVolume = raw.soundEffectsVolume === undefined || raw.soundEffectsVolume === null ? null : unitInterval(raw.soundEffectsVolume);
	let soundEffectsMuted: boolean | null = null;
	if (raw.soundEffectsMuted !== undefined && raw.soundEffectsMuted !== null) {
		if (typeof raw.soundEffectsMuted !== 'boolean') return null;
		soundEffectsMuted = raw.soundEffectsMuted;
	}
	const brightness = raw.brightness === undefined || raw.brightness === null ? null : unitInterval(raw.brightness);
	let wifi: DeviceWiFiState | null = null;
	if (raw.wifi !== undefined && raw.wifi !== null) {
		if (!raw.wifi || typeof raw.wifi !== 'object' || Array.isArray(raw.wifi)) return null;
		const candidate = raw.wifi as Record<string, unknown>;
		if (!Object.keys(candidate).every((key) => ['powerOn', 'ssid'].includes(key))) return null;
		const rawPowerOn = candidate.powerOn;
		const powerOn: boolean | null = rawPowerOn === undefined || rawPowerOn === null ? null : typeof rawPowerOn === 'boolean' ? rawPowerOn : null;
		const ssid = candidate.ssid === undefined || candidate.ssid === null ? null : bounded(candidate.ssid, 32);
		if ((rawPowerOn !== undefined && rawPowerOn !== null && powerOn === null) || (ssid !== null && !ssid)) return null;
		wifi = { powerOn, ssid };
	}
	if (raw.volume !== undefined && raw.volume !== null && volume === null) return null;
	if (raw.inputVolume !== undefined && raw.inputVolume !== null && inputVolume === null) return null;
	if (raw.soundEffectsVolume !== undefined && raw.soundEffectsVolume !== null && soundEffectsVolume === null) return null;
	if (raw.brightness !== undefined && raw.brightness !== null && brightness === null) return null;
	const displays = normalizeNamedDeviceList(raw.displays, 16, ['id', 'width', 'height', 'isMain', 'isBuiltIn', 'brightness', 'brightnessControlSupported', 'currentMode', 'availableModes', 'originX', 'originY', 'mirroredDisplayId', 'hdrActive'], (display) => {
		const id = boundedInteger(display.id, 1, 4_294_967_295);
		const width = boundedInteger(display.width, 1, 32_768);
		const height = boundedInteger(display.height, 1, 32_768);
		const brightness = display.brightness === null || display.brightness === undefined ? null : unitInterval(display.brightness);
		const currentMode = display.currentMode === null || display.currentMode === undefined ? null : normalizeDisplayMode(display.currentMode);
		if (id === null || width === null || height === null || typeof display.isMain !== 'boolean' || typeof display.isBuiltIn !== 'boolean' || typeof display.brightnessControlSupported !== 'boolean' || (display.brightness !== null && display.brightness !== undefined && brightness === null) || (display.currentMode !== null && display.currentMode !== undefined && !currentMode) || !Array.isArray(display.availableModes) || display.availableModes.length > 64 || typeof display.hdrActive !== 'boolean') return null;
		const availableModes = display.availableModes.map(normalizeDisplayMode);
		const originX = boundedInteger(display.originX, -32_768, 32_768);
		const originY = boundedInteger(display.originY, -32_768, 32_768);
		const mirroredDisplayId = display.mirroredDisplayId === null || display.mirroredDisplayId === undefined ? null : boundedInteger(display.mirroredDisplayId, 1, 4_294_967_295);
		if (availableModes.some((mode) => !mode) || originX === null || originY === null || (display.mirroredDisplayId !== null && display.mirroredDisplayId !== undefined && mirroredDisplayId === null)) return null;
		return { id, width, height, isMain: display.isMain, isBuiltIn: display.isBuiltIn, brightness, brightnessControlSupported: display.brightnessControlSupported, currentMode, availableModes: availableModes as DeviceDisplayMode[], originX, originY, mirroredDisplayId, hdrActive: display.hdrActive };
	});
	const printers = normalizeNamedDeviceList(raw.printers, 64, ['id', 'name', 'isDefault'], (printer) => {
		const id = bounded(printer.id, 512), name = bounded(printer.name, 120);
		return id && name && typeof printer.isDefault === 'boolean' ? { id, name, isDefault: printer.isDefault } : null;
	});
	const cameras = normalizeNamedDeviceList(raw.cameras, 32, ['id', 'name', 'isConnected', 'isPreferred', 'authorization'], (camera) => {
		const id = bounded(camera.id, 512), name = bounded(camera.name, 120);
		return id && name && typeof camera.isConnected === 'boolean' && typeof camera.isPreferred === 'boolean' && (camera.authorization === 'granted' || camera.authorization === 'denied') ? { id, name, isConnected: camera.isConnected, isPreferred: camera.isPreferred, authorization: camera.authorization as DeviceCamera['authorization'] } : null;
	});
	const bluetoothDevices = normalizeNamedDeviceList(raw.bluetoothDevices, 64, ['id', 'name', 'isConnected'], (device) => {
		const id = bounded(device.id, 120), name = bounded(device.name, 120);
		return id && name && typeof device.isConnected === 'boolean' ? { id, name, isConnected: device.isConnected } : null;
	});
	const vpnServices = normalizeNamedDeviceList(raw.vpnServices, 32, ['id', 'name', 'isConnected'], (service) => {
		const id = bounded(service.id, 512), name = bounded(service.name, 120);
		return id && name && typeof service.isConnected === 'boolean' ? { id, name, isConnected: service.isConnected } : null;
	});
	let appleMusic: DeviceAppleMusicState | undefined;
	if (raw.appleMusic !== undefined) {
		if (!raw.appleMusic || typeof raw.appleMusic !== 'object' || Array.isArray(raw.appleMusic)) return null;
		const candidate = raw.appleMusic as Record<string, unknown>;
		if (!exactKeys(candidate, ['isInstalled', 'isRunning']) || typeof candidate.isInstalled !== 'boolean' || typeof candidate.isRunning !== 'boolean') return null;
		appleMusic = { isInstalled: candidate.isInstalled, isRunning: candidate.isRunning };
	}
	let spotify: DeviceSpotifyState | undefined;
	if (raw.spotify !== undefined) {
		if (!raw.spotify || typeof raw.spotify !== 'object' || Array.isArray(raw.spotify)) return null;
		const candidate = raw.spotify as Record<string, unknown>;
		if (!exactKeys(candidate, ['isInstalled', 'isRunning']) || typeof candidate.isInstalled !== 'boolean' || typeof candidate.isRunning !== 'boolean') return null;
		spotify = { isInstalled: candidate.isInstalled, isRunning: candidate.isRunning };
	}
	let chromeYouTube: DeviceChromeYouTubeState | undefined;
	if (raw.chromeYouTube !== undefined) {
		if (!raw.chromeYouTube || typeof raw.chromeYouTube !== 'object' || Array.isArray(raw.chromeYouTube)) return null;
		const candidate = raw.chromeYouTube as Record<string, unknown>;
		if (!exactKeys(candidate, ['isInstalled', 'isRunning']) || typeof candidate.isInstalled !== 'boolean' || typeof candidate.isRunning !== 'boolean') return null;
		chromeYouTube = { isInstalled: candidate.isInstalled, isRunning: candidate.isRunning };
	}
	if (!displays || !printers || !cameras || !bluetoothDevices || !vpnServices) return null;
	return {
		locked: raw.locked,
		volume,
		muted,
		inputVolume,
		inputMuted,
		soundEffectsVolume,
		soundEffectsMuted,
		brightness,
		battery,
		powerTimers,
		openApps,
		audioDevices,
		wifi,
		displays,
		printers,
		cameras,
		bluetoothDevices,
		vpnServices,
		appleMusic,
		spotify,
		chromeYouTube
	};
};

export type DeviceConnectorSnapshot = {
	id: string;
	kind: string;
	label: string;
	status: 'connected' | 'disconnected' | 'degraded' | 'needs-permission';
	capabilities: string[];
	projects: DeviceConnectorProjectReference[];
};

export const DEVICE_CONNECTOR_CAPABILITIES = [
	'read-history',
	'create-session',
	'send-message',
	'steer-turn',
	'interrupt-turn',
	'review-approval',
	'accessibility',
	'explicit-approval'
] as const;

export type DeviceConnectorCapability = (typeof DEVICE_CONNECTOR_CAPABILITIES)[number];

const DEVICE_CONNECTOR_CAPABILITY_SET = new Set<string>(DEVICE_CONNECTOR_CAPABILITIES);
const DEVICE_CONNECTOR_CAPABILITY_ALIASES: Readonly<Record<string, DeviceConnectorCapability>> = {
	'session.list': 'read-history',
	'session.read': 'read-history',
	'ai.session.read': 'read-history',
	'session.create': 'create-session',
	'ai.session.create': 'create-session',
	'session.send': 'send-message',
	'ai.session.message': 'send-message',
	'session.steer': 'steer-turn',
	'ai.session.steer': 'steer-turn',
	'session.interrupt': 'interrupt-turn',
	'ai.session.interrupt': 'interrupt-turn',
	'approval.respond': 'review-approval',
	'approvals.respond': 'review-approval'
};

export const normalizeDeviceConnectorCapability = (value: unknown): DeviceConnectorCapability | null => {
	if (typeof value !== 'string') return null;
	const normalized = value.trim().toLowerCase();
	if (!normalized || normalized.length > 100 || !/^[a-z][a-z0-9.-]*$/u.test(normalized)) return null;
	const aliased = DEVICE_CONNECTOR_CAPABILITY_ALIASES[normalized];
	if (aliased) return aliased;
	return DEVICE_CONNECTOR_CAPABILITY_SET.has(normalized) ? (normalized as DeviceConnectorCapability) : null;
};

export const MAX_DEVICE_CONNECTOR_PROJECTS = 128;

export type DeviceConnectorProjectReference = {
	projectId: string;
	projectLabel: string;
};

const normalizeDeviceConnectorProjects = (value: unknown): DeviceConnectorProjectReference[] | null => {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > MAX_DEVICE_CONNECTOR_PROJECTS) return null;
	const projects: DeviceConnectorProjectReference[] = [];
	const ids = new Set<string>();
	for (const entry of value) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
		const raw = entry as Record<string, unknown>;
		if (!Object.keys(raw).every((key) => key === 'projectId' || key === 'projectLabel')) return null;
		if (typeof raw.projectId !== 'string' || typeof raw.projectLabel !== 'string') return null;
		const projectId = raw.projectId;
		const projectLabel = raw.projectLabel;
		if (
			projectId !== projectId.trim() ||
			!projectId ||
			Array.from(projectId).length > 128 ||
			!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(projectId) ||
			ids.has(projectId) ||
			projectLabel !== projectLabel.trim() ||
			!projectLabel ||
			Array.from(projectLabel).length > 120 ||
			/[\\/\p{Cc}\p{Cf}]/u.test(projectLabel)
		)
			return null;
		ids.add(projectId);
		projects.push({ projectId, projectLabel });
	}
	return projects;
};

export const normalizeDeviceConnectors = (value: unknown): DeviceConnectorSnapshot[] | null => {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > 32) return null;
	const out: DeviceConnectorSnapshot[] = [];
	const ids = new Set<string>();
	for (const entry of value) {
		if (!entry || typeof entry !== 'object') return null;
		const raw = entry as Record<string, unknown>;
		if (!Object.keys(raw).every((key) => ['id', 'kind', 'label', 'status', 'capabilities', 'projects'].includes(key))) return null;
		const id = bounded(raw.id, 120);
		const kind = bounded(raw.kind, 80);
		const label = bounded(raw.label, 120);
		const status =
			raw.status === 'connected' || raw.status === 'disconnected' || raw.status === 'degraded' || raw.status === 'needs-permission'
				? raw.status
				: null;
		if (!id || ids.has(id) || !kind || !label || !status) return null;
		if (!Array.isArray(raw.capabilities) || raw.capabilities.length > 32) return null;
		const projects = normalizeDeviceConnectorProjects(raw.projects);
		if (!projects) return null;
		const capabilities: string[] = [];
		for (const capability of raw.capabilities) {
			const normalized = normalizeDeviceConnectorCapability(capability);
			if (!normalized) return null;
			if (!capabilities.includes(normalized)) capabilities.push(normalized);
		}
		capabilities.sort();
		ids.add(id);
		out.push({ id, kind, label, status, capabilities, projects });
	}
	return out;
};

const FORBIDDEN_PERSISTED_KEYS = new Set(['sdp', 'ice', 'candidate', 'frame', 'frames', 'imageData', 'rawFrame', 'pixels', 'audioData']);

const sanitizeJsonValue = (value: unknown, depth = 0): unknown | undefined => {
	if (depth > 8) return undefined;
	if (value === null || typeof value === 'boolean') return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
	if (typeof value === 'string') return value.length <= 16_000 ? value : undefined;
	if (Array.isArray(value)) {
		if (value.length > 100) return undefined;
		const out: unknown[] = [];
		for (const entry of value) {
			const sanitized = sanitizeJsonValue(entry, depth + 1);
			if (sanitized === undefined) return undefined;
			out.push(sanitized);
		}
		return out;
	}
	if (value && typeof value === 'object') {
		const keys = Object.keys(value as Record<string, unknown>);
		if (keys.length > 100) return undefined;
		const out: Record<string, unknown> = {};
		for (const key of keys) {
			if (!key || key.length > 100 || key.startsWith('$') || key.includes('.') || FORBIDDEN_PERSISTED_KEYS.has(key)) {
				return undefined;
			}
			const sanitized = sanitizeJsonValue((value as Record<string, unknown>)[key], depth + 1);
			if (sanitized === undefined) return undefined;
			out[key] = sanitized;
		}
		return out;
	}
	return undefined;
};

export const normalizeCommandInput = (value: unknown): { ok: true; input: Record<string, unknown> } | DeviceFail => {
	const sanitized = sanitizeJsonValue(value ?? {});
	if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) {
		return deviceFail(400, 'input must be a bounded JSON object');
	}
	if (Buffer.byteLength(JSON.stringify(sanitized), 'utf8') > 64 * 1024) {
		return deviceFail(413, 'Command input is too large');
	}
	return { ok: true, input: sanitized as Record<string, unknown> };
};

export const normalizeCommandKind = (value: unknown): DeviceCommandKind | null =>
	typeof value === 'string' && (DEVICE_COMMAND_KINDS as readonly string[]).includes(value) ? (value as DeviceCommandKind) : null;

type ConnectorInput = { connectorId: string };
type CursorPageInput = { cursor?: string; limit?: number };

export type DeviceCommandInputByKind = {
	'connector.start': ConnectorInput;
	'connector.stop': ConnectorInput;
	'session.list': ConnectorInput & CursorPageInput & { projectId?: string; search?: string };
	'session.read': ConnectorInput & CursorPageInput & { sessionId: string };
	'session.create': ConnectorInput & { projectId?: string; title?: string };
	'session.send':
		| (ConnectorInput & { sessionId: string; text: string; delivery: 'queue' })
		| (ConnectorInput & { sessionId: string; text: string; delivery: 'steer'; expectedTurnId: string });
	'session.interrupt': ConnectorInput & { sessionId: string; turnId: string };
	'approval.respond': ConnectorInput & { approvalId: string; decision: 'approved' | 'denied' };
	'app.focus': { appId: string };
	'app.launch': { appId: string };
	'app.quit': { appId: string };
	'app.force-quit': { appId: string };
	'app.hide': { appId: string };
	'app.unhide': { appId: string };
	'app.hide-others': Record<string, never>;
	'system.volume.set': { level: number };
	'system.audio.mute.set': { muted: boolean };
	'system.audio.input.volume.set': { level: number };
	'system.audio.input.mute.set': { muted: boolean };
	'system.audio.output.set': { deviceId: string };
	'system.audio.input.set': { deviceId: string };
	'system.audio.sound-effects.volume.set': { level: number };
	'system.audio.sound-effects.mute.set': { muted: boolean };
	'system.audio.sound-effects-output.set': { deviceId: string };
	'system.brightness.set': { level: number };
	'system.display.brightness.set': { displayId: number; level: number };
	'system.display.mode.set': { displayId: number; modeId: string };
	'system.display.origin.set': { displayId: number; x: number; y: number };
	'system.display.mirroring.set': { displayId: number; sourceDisplayId: number | null };
	'system.printer.default.set': { id: string };
	'system.camera.preferred.set': { id: string };
	'system.bluetooth.device.connection.set': { id: string; connected: boolean };
	'system.vpn.connection.set': { id: string; connected: boolean };
	'system.power.idle-sleep-prevention.set': { enabled: boolean };
	'system.power.idle-timer.set': { scope: 'display' | 'system' | 'disk'; minutes: number };
	'system.policy.airdrop.profile.propose': { enabled: boolean };
	'system.policy.camera.profile.propose': { enabled: boolean };
	'system.media.apple-music.playback.set': { operation: 'play' | 'pause' | 'next' | 'previous' };
	'system.media.apple-music.volume.set': { level: number };
	'system.media.spotify.playback.set': { operation: 'play' | 'pause' | 'next' | 'previous' };
	'system.media.spotify.volume.set': { level: number };
	'system.media.chrome-youtube.volume.set': { level: number };
	'system.lock': Record<string, never>;
	'system.sleep': Record<string, never>;
	'system.restart': Record<string, never>;
	'system.shutdown': Record<string, never>;
	'system.logout': Record<string, never>;
	'system.wifi.connect': { ssid: string };
	'system.wifi.disconnect': Record<string, never>;
	'system.wifi.power.set': { enabled: boolean };
	'input.pointer.move': { displayId: number; x: number; y: number };
	'input.pointer.click': { displayId: number; x: number; y: number; button: 'left' | 'right' | 'middle' };
	'input.pointer.scroll': { deltaX: number; deltaY: number };
	'input.keyboard.type': { text: string };
	'input.keyboard.shortcut': { key: string; modifiers: Array<'command' | 'control' | 'option' | 'shift' | 'function'> };
	'screen.start': { screenSessionId: string; viewOnly: boolean };
	'screen.stop': { screenSessionId: string };
};

export type DeviceCommandEnvelope = {
	[K in DeviceCommandKind]: { kind: K; input: DeviceCommandInputByKind[K] };
}[DeviceCommandKind];

const hasConnectorCapability = (connector: Pick<DeviceConnectorSnapshot, 'capabilities'>, ...ids: readonly DeviceConnectorCapability[]): boolean =>
	connector.capabilities.some((capability) => {
		const normalized = normalizeDeviceConnectorCapability(capability);
		return normalized !== null && ids.includes(normalized);
	});

/**
 * The current connector snapshot is authoritative for session operations.
 * Lifecycle start/stop is intentionally exempt: a stopped connector cannot
 * advertise a live capability, and its persisted identity is the authority.
 */
export const deviceConnectorSupportsCommand = (
	kind: DeviceCommandKind,
	input: DeviceCommandInputByKind[DeviceCommandKind],
	connector: Pick<DeviceConnectorSnapshot, 'capabilities'>
): boolean => {
	switch (kind) {
		case 'connector.start':
		case 'connector.stop':
			return true;
		case 'session.list':
		case 'session.read':
			return hasConnectorCapability(connector, 'read-history');
		case 'session.create':
			return hasConnectorCapability(connector, 'create-session');
		case 'session.send': {
			const delivery = (input as DeviceCommandInputByKind['session.send']).delivery;
			const canSend = hasConnectorCapability(connector, 'send-message');
			return canSend && (delivery !== 'steer' || hasConnectorCapability(connector, 'steer-turn'));
		}
		case 'session.interrupt':
			return hasConnectorCapability(connector, 'interrupt-turn');
		case 'approval.respond':
			return hasConnectorCapability(connector, 'review-approval');
		default:
			return true;
	}
};

const DEVICE_COMMAND_CAPABILITY: Partial<Record<DeviceCommandKind, string>> = {
	'app.focus': 'apps.launch',
	'app.launch': 'apps.launch',
	'app.quit': 'apps.quit',
	'app.force-quit': 'apps.force-quit',
	'app.hide': 'apps.visibility',
	'app.unhide': 'apps.visibility',
	'app.hide-others': 'apps.visibility',
	'system.volume.set': 'system.volume.write',
	'system.audio.mute.set': 'system.audio.mute.write',
	'system.audio.input.volume.set': 'system.audio.input.volume.write',
	'system.audio.input.mute.set': 'system.audio.input.mute.write',
	'system.audio.output.set': 'system.audio.output.write',
	'system.audio.input.set': 'system.audio.input.write',
	'system.audio.sound-effects.volume.set': 'system.audio.sound-effects.volume.write',
	'system.audio.sound-effects.mute.set': 'system.audio.sound-effects.mute.write',
	'system.audio.sound-effects-output.set': 'system.audio.sound-effects-output.write',
	'system.brightness.set': 'system.brightness.write',
	'system.display.brightness.set': 'system.display.brightness.write',
	'system.display.mode.set': 'system.display.mode.write',
	'system.display.origin.set': 'system.display.layout.write',
	'system.display.mirroring.set': 'system.display.mirroring.write',
	'system.printer.default.set': 'system.printer.default.write',
	'system.camera.preferred.set': 'system.camera.preferred.write',
	'system.bluetooth.device.connection.set': 'system.bluetooth.device.connection.write',
	'system.vpn.connection.set': 'system.vpn.connection.write',
	'system.power.idle-sleep-prevention.set': 'system.power.idle-sleep-prevention.write',
	'system.power.idle-timer.set': 'system.power.idle-timer.write',
	'system.policy.airdrop.profile.propose': 'system.policy.airdrop.profile.write',
	'system.policy.camera.profile.propose': 'system.policy.camera.profile.write',
	'system.media.apple-music.playback.set': 'system.media.apple-music.playback.write',
	'system.media.apple-music.volume.set': 'system.media.apple-music.volume.write',
	'system.media.spotify.playback.set': 'system.media.spotify.playback.write',
	'system.media.spotify.volume.set': 'system.media.spotify.volume.write',
	'system.media.chrome-youtube.volume.set': 'system.media.chrome-youtube.volume.write',
	'system.lock': 'system.lock',
	'system.sleep': 'system.power.sleep',
	'system.restart': 'system.power.restart',
	'system.shutdown': 'system.power.shutdown',
	'system.logout': 'system.session.logout',
	'system.wifi.connect': 'system.wifi.connect',
	'system.wifi.disconnect': 'system.wifi.disconnect',
	'system.wifi.power.set': 'system.wifi.power.write',
	'input.pointer.move': 'input.pointer.write',
	'input.pointer.click': 'input.pointer.write',
	'input.pointer.scroll': 'input.pointer.write',
	'input.keyboard.type': 'input.keyboard.write',
	'input.keyboard.shortcut': 'input.keyboard.write',
	'screen.start': 'screen.view',
	'screen.stop': 'screen.view'
};

const DEVICE_CAPABILITY_ALIASES: Readonly<Record<string, string>> = {
	'app.focus': 'apps.launch',
	'app.launch': 'apps.launch',
	'application.activate': 'apps.launch',
	'application.launch': 'apps.launch',
	'app.quit': 'apps.quit',
	'application.quit': 'apps.quit',
	'app.force-quit': 'apps.force-quit',
	'application.force-quit': 'apps.force-quit',
	'app.hide': 'apps.visibility',
	'application.hide': 'apps.visibility',
	'app.unhide': 'apps.visibility',
	'application.unhide': 'apps.visibility',
	'app.hide-others': 'apps.visibility',
	'application.hide-others': 'apps.visibility',
	'system.volume.set': 'system.volume.write',
	'system.audio.mute.set': 'system.audio.mute.write',
	'system.audio.input.volume.set': 'system.audio.input.volume.write',
	'system.audio.input.mute.set': 'system.audio.input.mute.write',
	'system.audio.output.set': 'system.audio.output.write',
	'system.audio.input.set': 'system.audio.input.write',
	'system.audio.sound-effects.volume.set': 'system.audio.sound-effects.volume.write',
	'system.audio.sound-effects.mute.set': 'system.audio.sound-effects.mute.write',
	'system.audio.sound-effects-output.set': 'system.audio.sound-effects-output.write',
	'system.brightness.set': 'system.brightness.write',
	'system.display.brightness.set': 'system.display.brightness.write',
	'system.display.mode.set': 'system.display.mode.write',
	'system.display.origin.set': 'system.display.layout.write',
	'system.display.mirroring.set': 'system.display.mirroring.write',
	'system.printer.default.set': 'system.printer.default.write',
	'system.camera.preferred.set': 'system.camera.preferred.write',
	'system.bluetooth.device.connection.set': 'system.bluetooth.device.connection.write',
	'system.vpn.connection.set': 'system.vpn.connection.write',
	'system.power.idle-sleep-prevention.set': 'system.power.idle-sleep-prevention.write',
	'system.power.idle-timer.set': 'system.power.idle-timer.write',
	'system.policy.airdrop.profile.propose': 'system.policy.airdrop.profile.write',
	'system.policy.camera.profile.propose': 'system.policy.camera.profile.write',
	'system.media.apple-music.playback.set': 'system.media.apple-music.playback.write',
	'system.media.apple-music.volume.set': 'system.media.apple-music.volume.write',
	'system.media.spotify.playback.set': 'system.media.spotify.playback.write',
	'system.media.spotify.volume.set': 'system.media.spotify.volume.write',
	'system.media.chrome-youtube.volume.set': 'system.media.chrome-youtube.volume.write',
	'device.lock.write': 'system.lock',
	'system.sleep': 'system.power.sleep',
	'system.restart': 'system.power.restart',
	'system.shutdown': 'system.power.shutdown',
	'system.logout': 'system.session.logout',
	'system.wifi.connect': 'system.wifi.connect',
	'system.wifi.disconnect': 'system.wifi.disconnect',
	'system.wifi.power.set': 'system.wifi.power.write',
	'input.pointer.move': 'input.pointer.write',
	'input.pointer.click': 'input.pointer.write',
	'input.pointer.scroll': 'input.pointer.write',
	'input.keyboard.type': 'input.keyboard.write',
	'input.keyboard.shortcut': 'input.keyboard.write',
	'screen.start': 'screen.view',
	'screen.stop': 'screen.view'
};

/**
 * A paired device's signed claim is authoritative for device-wide effects.
 * Connector-scoped commands are checked against the current connector
 * snapshot separately; this function closes direct API calls that otherwise
 * could enqueue an effect the paired node never advertised.
 */
export const deviceSupportsCommand = (kind: DeviceCommandKind, capabilities: unknown): boolean => {
	const required = DEVICE_COMMAND_CAPABILITY[kind];
	if (!required) return true;
	if (!Array.isArray(capabilities)) return false;
	return capabilities.some((value) => {
		if (typeof value !== 'string') return false;
		const normalized = value.trim().toLowerCase();
		return (DEVICE_CAPABILITY_ALIASES[normalized] || normalized) === required;
	});
};

const opaqueId = (value: unknown, max = 200): string | null => {
	const id = bounded(value, max);
	return id && !/[\s/\\\p{Cc}\p{Cf}]/u.test(id) ? id : null;
};

const opaqueCursor = (value: unknown): string | null => {
	if (typeof value !== 'string' || !value || value !== value.trim() || Array.from(value).length > 2_048) return null;
	return /[\p{Cc}\p{Cf}]/u.test(value) ? null : value;
};

const commandMessageText = (value: unknown): string | null => {
	if (typeof value !== 'string' || !value.trim() || Array.from(value).length > 32_000) return null;
	return Array.from(value).some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
	})
		? null
		: value;
};

const exactKeys = (raw: Record<string, unknown>, allowed: readonly string[]): boolean => Object.keys(raw).every((key) => allowed.includes(key));

const optionalPage = (raw: Record<string, unknown>): { ok: true; page: CursorPageInput } | DeviceFail => {
	const page: CursorPageInput = {};
	if (raw.cursor !== undefined) {
		const cursor = opaqueCursor(raw.cursor);
		if (!cursor) return deviceFail(400, 'cursor must be a bounded opaque identifier');
		page.cursor = cursor;
	}
	if (raw.limit !== undefined) {
		const limit = Number(raw.limit);
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return deviceFail(400, 'limit must be an integer from 1 to 100');
		page.limit = limit;
	}
	return { ok: true, page };
};

export const normalizeDeviceCommand = <K extends DeviceCommandKind>(
	kind: K,
	value: unknown
): { ok: true; input: DeviceCommandInputByKind[K] } | DeviceFail => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return deviceFail(400, 'input must be an object');
	const raw = value as Record<string, unknown>;
	const connector = () => opaqueId(raw.connectorId, 120);
	const session = () => opaqueId(raw.sessionId, 512);
	const app = () => opaqueId(raw.appId, 200);
	const screen = () => opaqueId(raw.screenSessionId, 160);
	const displayId = () => boundedInteger(raw.displayId, 1, 4_294_967_295);
	const hardwareId = () => opaqueId(raw.id, 512);
	const ok = (input: unknown) => ({ ok: true as const, input: input as DeviceCommandInputByKind[K] });

	switch (kind) {
		case 'connector.start':
		case 'connector.stop': {
			const connectorId = connector();
			return connectorId && exactKeys(raw, ['connectorId']) ? ok({ connectorId }) : deviceFail(400, `${kind} requires only connectorId`);
		}
		case 'session.list': {
			const connectorId = connector();
			const page = optionalPage(raw);
			if (!connectorId) return deviceFail(400, 'session.list requires connectorId');
			if (page.ok === false) return page;
			if (!exactKeys(raw, ['connectorId', 'projectId', 'search', 'cursor', 'limit']))
				return deviceFail(400, 'session.list input contains an unknown field');
			const projectId = raw.projectId === undefined ? undefined : opaqueId(raw.projectId, 512);
			const search = raw.search === undefined ? undefined : bounded(raw.search, 200);
			if (raw.projectId !== undefined && !projectId) return deviceFail(400, 'projectId must be a bounded opaque identifier');
			if (raw.search !== undefined && !search) return deviceFail(400, 'search must be a bounded non-empty string');
			return ok({ connectorId, ...(projectId ? { projectId } : {}), ...(search ? { search } : {}), ...page.page });
		}
		case 'session.read': {
			const connectorId = connector();
			const sessionId = session();
			const page = optionalPage(raw);
			if (!connectorId || !sessionId) return deviceFail(400, 'session.read requires connectorId and sessionId');
			if (page.ok === false) return page;
			if (!exactKeys(raw, ['connectorId', 'sessionId', 'cursor', 'limit'])) return deviceFail(400, 'session.read input contains an unknown field');
			return ok({ connectorId, sessionId, ...page.page });
		}
		case 'session.create': {
			const connectorId = connector();
			const projectId = raw.projectId === undefined ? undefined : opaqueId(raw.projectId, 512);
			const title = raw.title === undefined ? undefined : bounded(raw.title, 200);
			if (!connectorId || !exactKeys(raw, ['connectorId', 'projectId', 'title'])) return deviceFail(400, 'session.create input is invalid');
			if (raw.projectId !== undefined && !projectId) return deviceFail(400, 'projectId must be a bounded opaque identifier');
			if (raw.title !== undefined && !title) return deviceFail(400, 'title must be a bounded non-empty string');
			return ok({ connectorId, ...(projectId ? { projectId } : {}), ...(title ? { title } : {}) });
		}
		case 'session.send': {
			const connectorId = connector();
			const sessionId = session();
			const text = commandMessageText(raw.text);
			if (!connectorId || !sessionId || !text) return deviceFail(400, 'session.send requires connectorId, sessionId and bounded text');
			if (raw.delivery === 'queue') {
				return exactKeys(raw, ['connectorId', 'sessionId', 'text', 'delivery'])
					? ok({ connectorId, sessionId, text, delivery: 'queue' })
					: deviceFail(400, 'queued session.send input contains an unknown field');
			}
			if (raw.delivery === 'steer') {
				const expectedTurnId = opaqueId(raw.expectedTurnId, 512);
				return expectedTurnId && exactKeys(raw, ['connectorId', 'sessionId', 'text', 'delivery', 'expectedTurnId'])
					? ok({ connectorId, sessionId, text, delivery: 'steer', expectedTurnId })
					: deviceFail(400, 'steered session.send requires expectedTurnId and no unknown fields');
			}
			return deviceFail(400, 'session.send delivery must be queue or steer');
		}
		case 'session.interrupt': {
			const connectorId = connector();
			const sessionId = session();
			const turnId = opaqueId(raw.turnId, 512);
			return connectorId && sessionId && turnId && exactKeys(raw, ['connectorId', 'sessionId', 'turnId'])
				? ok({ connectorId, sessionId, turnId })
				: deviceFail(400, 'session.interrupt requires connectorId, sessionId and turnId');
		}
		case 'approval.respond': {
			const connectorId = connector();
			const approvalId = opaqueId(raw.approvalId, 512);
			const decision = raw.decision === 'approved' || raw.decision === 'denied' ? raw.decision : null;
			return connectorId && approvalId && decision && exactKeys(raw, ['connectorId', 'approvalId', 'decision'])
				? ok({ connectorId, approvalId, decision })
				: deviceFail(400, 'approval.respond requires connectorId, approvalId and an approved/denied decision');
		}
		case 'app.focus':
		case 'app.launch':
		case 'app.quit':
		case 'app.force-quit':
		case 'app.hide':
		case 'app.unhide': {
			const appId = app();
			return appId && exactKeys(raw, ['appId']) ? ok({ appId }) : deviceFail(400, `${kind} requires only a stable appId`);
		}
		case 'system.volume.set':
		case 'system.audio.input.volume.set':
		case 'system.audio.sound-effects.volume.set':
		case 'system.brightness.set': {
			const level = Number(raw.level);
			return Number.isFinite(level) && level >= 0 && level <= 1 && exactKeys(raw, ['level'])
				? ok({ level })
				: deviceFail(400, `${kind} requires only level from 0 to 1`);
		}
		case 'system.media.apple-music.volume.set':
		case 'system.media.spotify.volume.set':
		case 'system.media.chrome-youtube.volume.set': {
			const level = Number(raw.level);
			return Number.isFinite(level) && level >= 0 && level <= 1 && exactKeys(raw, ['level'])
				? ok({ level })
				: deviceFail(400, `${kind} requires only level from 0 to 1`);
		}
		case 'system.display.brightness.set': {
			const id = displayId();
			const level = Number(raw.level);
			return id !== null && Number.isFinite(level) && level >= 0 && level <= 1 && exactKeys(raw, ['displayId', 'level'])
				? ok({ displayId: id, level })
				: deviceFail(400, 'system.display.brightness.set requires an advertised displayId and level from 0 to 1');
		}
		case 'system.display.mode.set': {
			const id = displayId();
			const modeId = bounded(raw.modeId, 160);
			return id !== null && modeId && exactKeys(raw, ['displayId', 'modeId'])
				? ok({ displayId: id, modeId })
				: deviceFail(400, 'system.display.mode.set requires an advertised displayId and modeId');
		}
		case 'system.display.origin.set': {
			const id = displayId();
			const x = boundedInteger(raw.x, -32_768, 32_768);
			const y = boundedInteger(raw.y, -32_768, 32_768);
			return id !== null && x !== null && y !== null && exactKeys(raw, ['displayId', 'x', 'y'])
				? ok({ displayId: id, x, y })
				: deviceFail(400, 'system.display.origin.set requires an advertised displayId and bounded integer coordinates');
		}
		case 'system.display.mirroring.set': {
			const id = displayId();
			const sourceDisplayId = raw.sourceDisplayId === null ? null : boundedInteger(raw.sourceDisplayId, 1, 4_294_967_295);
			return id !== null && sourceDisplayId !== undefined && (raw.sourceDisplayId === null || sourceDisplayId !== null) && exactKeys(raw, ['displayId', 'sourceDisplayId'])
				? ok({ displayId: id, sourceDisplayId })
				: deviceFail(400, 'system.display.mirroring.set requires an advertised displayId and sourceDisplayId or null');
		}
		case 'system.printer.default.set':
		case 'system.camera.preferred.set': {
			const id = hardwareId();
			return id && exactKeys(raw, ['id']) ? ok({ id }) : deviceFail(400, `${kind} requires an advertised hardware id`);
		}
		case 'system.bluetooth.device.connection.set':
		case 'system.vpn.connection.set': {
			const id = hardwareId();
			return id && typeof raw.connected === 'boolean' && exactKeys(raw, ['id', 'connected'])
				? ok({ id, connected: raw.connected })
				: deviceFail(400, `${kind} requires an advertised id and boolean connected value`);
		}
		case 'system.power.idle-sleep-prevention.set':
			return typeof raw.enabled === 'boolean' && exactKeys(raw, ['enabled'])
				? ok({ enabled: raw.enabled })
				: deviceFail(400, 'system.power.idle-sleep-prevention.set requires only a boolean enabled value');
		case 'system.power.idle-timer.set': {
			const scope = raw.scope;
			const minutes = boundedInteger(raw.minutes, 0, 180);
			return (scope === 'display' || scope === 'system' || scope === 'disk') && minutes !== null && exactKeys(raw, ['scope', 'minutes'])
				? ok({ scope, minutes })
				: deviceFail(400, 'system.power.idle-timer.set requires display, system, or disk scope and whole minutes from 0 to 180');
		}
		case 'system.policy.airdrop.profile.propose':
		case 'system.policy.camera.profile.propose':
			return typeof raw.enabled === 'boolean' && exactKeys(raw, ['enabled'])
				? ok({ enabled: raw.enabled })
				: deviceFail(400, `${kind} requires only a boolean enabled value`);
		case 'system.media.apple-music.playback.set': {
			const operation = raw.operation;
			return (operation === 'play' || operation === 'pause' || operation === 'next' || operation === 'previous') && exactKeys(raw, ['operation'])
				? ok({ operation })
				: deviceFail(400, 'system.media.apple-music.playback.set requires only play, pause, next, or previous');
		}
		case 'system.media.spotify.playback.set': {
			const operation = raw.operation;
			return (operation === 'play' || operation === 'pause' || operation === 'next' || operation === 'previous') && exactKeys(raw, ['operation'])
				? ok({ operation })
				: deviceFail(400, 'system.media.spotify.playback.set requires only play, pause, next, or previous');
		}
		case 'system.lock':
		case 'system.sleep':
		case 'system.restart':
		case 'system.shutdown':
		case 'system.logout':
		case 'app.hide-others':
			return exactKeys(raw, []) ? ok({}) : deviceFail(400, `${kind} accepts no input fields`);
		case 'system.audio.mute.set':
		case 'system.audio.input.mute.set':
		case 'system.audio.sound-effects.mute.set':
			return typeof raw.muted === 'boolean' && exactKeys(raw, ['muted'])
				? ok({ muted: raw.muted })
				: deviceFail(400, 'system.audio.mute.set requires only a boolean muted value');
		case 'system.audio.output.set':
		case 'system.audio.input.set':
		case 'system.audio.sound-effects-output.set': {
			const deviceId = bounded(raw.deviceId, 512);
			return deviceId && exactKeys(raw, ['deviceId'])
				? ok({ deviceId })
				: deviceFail(400, `${kind} requires only a valid audio deviceId`);
		}
		case 'system.wifi.connect': {
			const ssid = typeof raw.ssid === 'string' ? raw.ssid : '';
			const validSSID =
				ssid.length > 0 &&
				ssid === ssid.trim() &&
				Buffer.byteLength(ssid, 'utf8') <= 32 &&
				!/\p{Cc}/u.test(ssid);
			return validSSID && exactKeys(raw, ['ssid'])
				? ok({ ssid })
				: deviceFail(400, 'system.wifi.connect requires only a visible SSID; passwords are never accepted');
		}
		case 'system.wifi.disconnect':
			return exactKeys(raw, []) ? ok({}) : deviceFail(400, 'system.wifi.disconnect accepts no input fields');
		case 'system.wifi.power.set':
			return typeof raw.enabled === 'boolean' && exactKeys(raw, ['enabled'])
				? ok({ enabled: raw.enabled })
				: deviceFail(400, 'system.wifi.power.set requires only a boolean enabled value');
		case 'input.pointer.move': {
			const targetDisplayId = displayId(), x = boundedInteger(raw.x, 0, 32_768), y = boundedInteger(raw.y, 0, 32_768);
			return targetDisplayId !== null && x !== null && y !== null && exactKeys(raw, ['displayId', 'x', 'y'])
				? ok({ displayId: targetDisplayId, x, y })
				: deviceFail(400, 'input.pointer.move requires displayId and whole nonnegative x and y values only');
		}
		case 'input.pointer.click': {
			const targetDisplayId = displayId(), x = boundedInteger(raw.x, 0, 32_768), y = boundedInteger(raw.y, 0, 32_768), button = raw.button === 'left' || raw.button === 'right' || raw.button === 'middle' ? raw.button : null;
			return targetDisplayId !== null && x !== null && y !== null && button && exactKeys(raw, ['displayId', 'x', 'y', 'button'])
				? ok({ displayId: targetDisplayId, x, y, button })
				: deviceFail(400, 'input.pointer.click requires displayId, whole coordinates, and left, right, or middle button only');
		}
		case 'input.pointer.scroll': {
			const deltaX = boundedInteger(raw.deltaX, -5_000, 5_000), deltaY = boundedInteger(raw.deltaY, -5_000, 5_000);
			return deltaX !== null && deltaY !== null && (deltaX !== 0 || deltaY !== 0) && exactKeys(raw, ['deltaX', 'deltaY'])
				? ok({ deltaX, deltaY })
				: deviceFail(400, 'input.pointer.scroll requires nonzero bounded whole deltaX and deltaY values only');
		}
		case 'input.keyboard.type': {
			const text = typeof raw.text === 'string' ? raw.text : '';
			return text.length > 0 && Buffer.byteLength(text, 'utf8') <= 4_096 && !containsUnsafeInputControl(text) && exactKeys(raw, ['text'])
				? ok({ text })
				: deviceFail(400, 'input.keyboard.type requires bounded text without unsafe control characters only');
		}
		case 'input.keyboard.shortcut': {
			const key = typeof raw.key === 'string' && /^(?:[a-z0-9]|return|tab|space|delete|escape|left|right|up|down|home|end|pageup|pagedown|f(?:[1-9]|1[0-2]))$/u.test(raw.key) ? raw.key : null;
			const modifiers = Array.isArray(raw.modifiers) && raw.modifiers.length <= 5 && raw.modifiers.every((entry) => entry === 'command' || entry === 'control' || entry === 'option' || entry === 'shift' || entry === 'function') && new Set(raw.modifiers).size === raw.modifiers.length
				? raw.modifiers as Array<'command' | 'control' | 'option' | 'shift' | 'function'>
				: null;
			return key && modifiers && exactKeys(raw, ['key', 'modifiers'])
				? ok({ key, modifiers })
				: deviceFail(400, 'input.keyboard.shortcut requires one allowlisted key and unique allowlisted modifiers only');
		}
		case 'screen.start': {
			const screenSessionId = screen();
			return screenSessionId && typeof raw.viewOnly === 'boolean' && exactKeys(raw, ['screenSessionId', 'viewOnly'])
				? ok({ screenSessionId, viewOnly: raw.viewOnly })
				: deviceFail(400, 'screen.start requires screenSessionId and viewOnly only');
		}
		case 'screen.stop': {
			const screenSessionId = screen();
			return screenSessionId && exactKeys(raw, ['screenSessionId'])
				? ok({ screenSessionId })
				: deviceFail(400, 'screen.stop requires only screenSessionId');
		}
	}
};

export const normalizeRequestId = (value: unknown): string | null => {
	const id = bounded(value, 160);
	return id && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id) ? id : null;
};

const TRANSITIONS: Record<DeviceCommandStatus, readonly DeviceCommandStatus[]> = {
	queued: ['claimed', 'cancelled'],
	claimed: ['running', 'needs-approval', 'succeeded', 'failed', 'cancelled', 'needs-review'],
	running: ['needs-approval', 'succeeded', 'failed', 'cancelled', 'needs-review'],
	'needs-approval': ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'needs-review'],
	succeeded: [],
	failed: [],
	cancelled: [],
	'needs-review': []
};

export const canTransitionDeviceCommand = (from: DeviceCommandStatus, to: DeviceCommandStatus): boolean => TRANSITIONS[from].includes(to);

export const canLeaseDeviceCommand = (requiresApproval: boolean, approvalState: DeviceCommandApprovalState): boolean =>
	!requiresApproval || approvalState === 'approved';

export type RevisionDecision = 'insert' | 'update' | 'same' | 'stale' | 'conflict';
export const decideDeviceRevision = (
	existingRevision: number | null,
	existingHash: string | null,
	incomingRevision: number,
	incomingHash: string
): RevisionDecision => {
	if (existingRevision === null) return 'insert';
	if (incomingRevision < existingRevision) return 'stale';
	if (incomingRevision > existingRevision) return 'update';
	return existingHash === incomingHash ? 'same' : 'conflict';
};

export const deviceSnapshotHash = (state: DeviceStateSnapshot, connectors: DeviceConnectorSnapshot[]): string =>
	devicePayloadHash({ state, connectors });

export type DeviceLeaseDecision = 'active' | 'expired' | 'invalid';
export const decideDeviceLease = (storedLeaseHash: unknown, presentedLeaseHash: string, leaseExpiresAt: unknown, now: Date): DeviceLeaseDecision => {
	if (storedLeaseHash !== presentedLeaseHash) return 'invalid';
	const expiresAt = leaseExpiresAt ? new Date(leaseExpiresAt as any) : null;
	return expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now.getTime() ? 'active' : 'expired';
};

export const deviceControlEventLogicalBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8') + 512;

export const retainedDeviceControlEventCount = (newestFirstLogicalBytes: number[], maxCount: number, maxBytes: number): number => {
	if (!Number.isSafeInteger(maxCount) || maxCount < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
		throw new RangeError('Device control-event retention bounds must be non-negative safe integers');
	}
	let count = 0;
	let bytes = 0;
	for (const value of newestFirstLogicalBytes) {
		if (!Number.isSafeInteger(value) || value < 0) break;
		if (count >= maxCount || bytes + value > maxBytes) break;
		count += 1;
		bytes += value;
	}
	return count;
};

export type DeviceEventCursor = { at: Date; id: string };

export const encodeDeviceEventCursor = (cursor: DeviceEventCursor): string =>
	Buffer.from(JSON.stringify([cursor.at.toISOString(), cursor.id]), 'utf8').toString('base64url');

export const decodeDeviceEventCursor = (value: unknown): DeviceEventCursor | null => {
	if (typeof value !== 'string' || !value || value.length > 512) return null;
	try {
		const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
		if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') return null;
		const at = new Date(parsed[0]);
		return Number.isFinite(at.getTime()) && parsed[1] ? { at, id: parsed[1] } : null;
	} catch {
		return null;
	}
};
