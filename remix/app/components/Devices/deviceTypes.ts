// Browser-side wire vocabulary for Thingtime's persistent device nodes. These
// types deliberately describe state and capabilities, not a transport: the
// same reducer can consume API snapshots, resumed cloud events, or the narrow
// local Electron bridge event stream.

export const DEVICE_SERVICE_STATUSES = ['absent', 'needs-approval', 'starting', 'running', 'degraded', 'stopped', 'version-mismatch'] as const;
export type DeviceServiceStatus = (typeof DEVICE_SERVICE_STATUSES)[number];

export const DEVICE_PAIRING_STATUSES = ['unpaired', 'pairing', 'paired', 'revoked'] as const;
export type DevicePairingStatus = (typeof DEVICE_PAIRING_STATUSES)[number];

export const DEVICE_TRANSPORT_STATUSES = ['offline', 'connecting', 'online', 'backoff'] as const;
export type DeviceTransportStatus = (typeof DEVICE_TRANSPORT_STATUSES)[number];

export const DEVICE_PERMISSION_STATUSES = ['not-determined', 'denied', 'restricted', 'authorized'] as const;
export type DevicePermissionStatus = (typeof DEVICE_PERMISSION_STATUSES)[number];

export const DEVICE_EXECUTION_PERMISSION_MODES = ['always-allow', 'ask-every-time', 'deny'] as const;
export type DeviceExecutionPermissionMode = (typeof DEVICE_EXECUTION_PERMISSION_MODES)[number];

export const DEVICE_CONNECTOR_STATUSES = ['unavailable', 'disabled', 'connecting', 'ready', 'degraded', 'error', 'update-required'] as const;
export type DeviceConnectorStatus = (typeof DEVICE_CONNECTOR_STATUSES)[number];

export const DEVICE_AGENT_SESSION_STATUSES = ['idle', 'queued', 'running', 'waiting-approval', 'completed', 'interrupted', 'failed'] as const;
export type DeviceAgentSessionStatus = (typeof DEVICE_AGENT_SESSION_STATUSES)[number];

export const DEVICE_SCREEN_SESSION_STATUSES = ['inactive', 'starting', 'active', 'stopping', 'denied', 'failed'] as const;
export type DeviceScreenSessionStatus = (typeof DEVICE_SCREEN_SESSION_STATUSES)[number];

export const DEVICE_COMMAND_STATUSES = [
	'queued',
	'claimed',
	'leased',
	'running',
	'streaming',
	'needs-approval',
	'succeeded',
	'failed',
	'cancelled',
	'expired',
	'needs-review'
] as const;
export type DeviceCommandStatus = (typeof DEVICE_COMMAND_STATUSES)[number];

export type DevicePresenceStatus = 'online' | 'stale' | 'offline';

export type DevicePermissionKind =
	| 'accessibility'
	| 'screen-recording'
	| 'automation'
	| 'input-monitoring'
	| 'full-disk-access'
	| 'microphone'
	| 'camera'
	| (string & {});

export type DeviceHealthError = {
	code: string;
	message?: string | null;
	at?: string | null;
};

export type DevicePermission = {
	kind: DevicePermissionKind;
	status: DevicePermissionStatus;
	updatedAt: string | null;
};

export type DeviceCapability = {
	id: string;
	label?: string | null;
	supported: boolean;
	enabled: boolean;
	requiresUnlocked?: boolean;
	allowedWhileLocked?: boolean;
	queueWhenOffline?: boolean;
	approval?: 'never' | 'once' | 'always';
	requiredPermissions?: DevicePermissionKind[];
	unavailableReason?: string | null;
};

export type DeviceRunningApp = {
	bundleId: string;
	name: string;
	isActive: boolean;
	isHidden?: boolean;
	pid?: number | null;
	iconDataUrl?: string | null;
	windowCount?: number | null;
	windowTitles?: string[];
	metadata?: Record<string, unknown> | null;
};

export type DeviceAudioDevice = {
	id: string;
	name: string;
	hasInput: boolean;
	hasOutput: boolean;
	isDefaultInput: boolean;
	isDefaultOutput: boolean;
	isDefaultSoundEffectsOutput: boolean;
};

export type DeviceWiFiState = {
	powerOn: boolean | null;
	ssid: string | null;
};

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
export type DeviceBattery = { level: number | null; charging: boolean | null; isExternalPower: boolean | null; isPreventingIdleSleep: boolean; isLowPowerModeEnabled?: boolean };
export type DevicePowerTimers = { displayIdleMinutes: number | null; systemSleepMinutes: number | null; diskIdleMinutes: number | null };
export type DeviceAppleMusic = { isInstalled: boolean; isRunning: boolean };
export type DeviceSpotify = { isInstalled: boolean; isRunning: boolean };
export type DeviceChromeYouTube = { isInstalled: boolean; isRunning: boolean };

export type DeviceSystemProperties = {
	model?: string | null;
	osName?: string | null;
	osVersion?: string | null;
	architecture?: string | null;
	cpuModel?: string | null;
	memoryBytes?: number | null;
	batteryPercent?: number | null;
	charging?: boolean | null;
};

export type DeviceObservedState = {
	volume: number | null;
	muted: boolean | null;
	inputVolume?: number | null;
	inputMuted?: boolean | null;
	soundEffectsVolume?: number | null;
	soundEffectsMuted?: boolean | null;
	brightness: number | null;
	locked: boolean | null;
	sleeping: boolean | null;
	activeAppBundleId: string | null;
	runningApps: DeviceRunningApp[];
	audioDevices?: DeviceAudioDevice[];
	wifi?: DeviceWiFiState | null;
	displays?: DeviceDisplay[];
	printers?: DevicePrinter[];
	cameras?: DeviceCamera[];
	bluetoothDevices?: DeviceBluetoothDevice[];
	vpnServices?: DeviceVPNService[];
	battery?: DeviceBattery | null;
	powerTimers?: DevicePowerTimers;
	appleMusic?: DeviceAppleMusic;
	spotify?: DeviceSpotify;
	chromeYouTube?: DeviceChromeYouTube;
	observedAt: string;
};

// Values that may be painted optimistically while the node executes a command.
// Undefined means that a command does not claim that field.
export type DeviceDesiredState = Partial<Pick<DeviceObservedState, 'volume' | 'muted' | 'brightness' | 'locked' | 'activeAppBundleId'>>;

export type DeviceConnector = {
	id: string;
	kind: string;
	label: string;
	enabled: boolean;
	status: DeviceConnectorStatus;
	capabilities: DeviceCapability[];
	projects: Array<{ projectId: string; projectLabel: string }>;
	version?: string | null;
	lastSeenAt?: string | null;
	lastError?: DeviceHealthError | null;
};

export type DeviceSummary = {
	id: string;
	name: string;
	platform: string;
	serviceStatus: DeviceServiceStatus;
	pairingStatus: DevicePairingStatus;
	transportStatus: DeviceTransportStatus;
	revision: number;
	lastSeenAt: string | null;
	appVersion?: string | null;
	nodeVersion?: string | null;
	system?: DeviceSystemProperties;
	capabilities: DeviceCapability[];
	connectorCount?: number;
	permissionMode: DeviceExecutionPermissionMode;
	lastError?: DeviceHealthError | null;
};

export type DeviceSnapshot = {
	deviceId: string;
	revision: number;
	capturedAt: string;
	observed: DeviceObservedState;
	permissions: DevicePermission[];
	connectors: DeviceConnector[];
};

export type DeviceActionKind =
	| 'register-service'
	| 'unregister-service'
	| 'begin-pairing'
	| 'complete-pairing'
	| 'unpair'
	| 'request-permission'
	| 'open-permission-settings'
	| 'register-project'
	| 'set-volume'
	| 'set-muted'
	| 'set-input-volume'
	| 'set-input-muted'
	| 'set-sound-effects-volume'
	| 'set-sound-effects-muted'
	| 'set-brightness'
	| 'set-audio-output'
	| 'set-audio-input'
	| 'set-sound-effects-output'
	| 'connect-wifi'
	| 'disconnect-wifi'
	| 'set-wifi-power'
	| 'set-display-brightness'
	| 'set-display-mode'
	| 'set-display-origin'
	| 'set-display-mirroring'
	| 'set-default-printer'
	| 'set-preferred-camera'
	| 'set-bluetooth-device-connected'
	| 'set-vpn-connected'
	| 'set-prevent-idle-sleep'
	| 'set-power-idle-timer'
	| 'propose-airdrop-policy-profile'
	| 'propose-camera-policy-profile'
	| 'set-apple-music-playback'
	| 'set-apple-music-volume'
	| 'set-spotify-playback'
	| 'set-spotify-volume'
	| 'set-chrome-youtube-volume'
	| 'move-pointer'
	| 'click-pointer'
	| 'scroll-pointer'
	| 'type-text'
	| 'send-shortcut'
	| 'launch-app'
	| 'quit-app'
	| 'force-quit-app'
	| 'hide-app'
	| 'unhide-app'
	| 'hide-other-apps'
	| 'lock'
	| 'sleep'
	| 'restart'
	| 'shutdown'
	| 'logout'
	| 'start-screen-session'
	| 'control-screen-session'
	| 'stop-screen-session'
	| 'create-agent-session'
	| 'send-agent-message'
	| 'interrupt-agent-session'
	| 'respond-approval'
	| (string & {});

export type DeviceCommand = {
	id: string;
	deviceId: string;
	requestId?: string | null;
	idempotencyKey?: string | null;
	action: DeviceActionKind;
	kind?: DeviceActionKind;
	status: DeviceCommandStatus;
	revision: number;
	createdAt: string;
	updatedAt: string;
	expiresAt?: string | null;
	baseObservationRevision?: number | null;
	desired?: DeviceDesiredState | null;
	args?: Record<string, unknown> | null;
	result?: Record<string, unknown> | null;
	error?: DeviceHealthError | null;
};

export type DeviceApproval = {
	id: string;
	deviceId: string;
	commandId: string | null;
	status: 'pending' | 'approved' | 'denied' | 'expired';
	kind?: string | null;
	prompt: string;
	scopes?: Array<'once' | 'chat' | 'while-unlocked' | (string & {})>;
	localOnly?: boolean;
	revision: number;
	createdAt: string;
	expiresAt: string | null;
	decidedAt?: string | null;
};

export type DeviceAgentSession = {
	id: string;
	deviceId: string;
	connectorId: string;
	chatId?: string | null;
	title?: string | null;
	project?: string | null;
	status: DeviceAgentSessionStatus;
	activeTurnId?: string | null;
	queueDepth: number;
	revision: number;
	updatedAt: string;
	lastError?: DeviceHealthError | null;
};

export type DeviceScreenSession = {
	id: string;
	deviceId: string;
	status: DeviceScreenSessionStatus;
	controlEnabled: boolean;
	displayId?: string | null;
	windowId?: string | null;
	revision: number;
	createdAt: string;
	updatedAt: string;
	lastError?: DeviceHealthError | null;
};

export type DeviceRuntimeState = {
	deviceId: string;
	summary: DeviceSummary | null;
	snapshot: DeviceSnapshot | null;
	commands: DeviceCommand[];
	approvals: DeviceApproval[];
	agentSessions: DeviceAgentSession[];
	screenSessions: DeviceScreenSession[];
	lastEventSequence: number;
};

type DeviceEventBase = {
	deviceId: string;
	sequence: number;
	occurredAt: string;
};

export type DeviceEvent =
	| (DeviceEventBase & { type: 'summary'; summary: DeviceSummary })
	| (DeviceEventBase & { type: 'snapshot'; snapshot: DeviceSnapshot })
	| (DeviceEventBase & { type: 'command'; command: DeviceCommand })
	| (DeviceEventBase & { type: 'command-removed'; commandId: string })
	| (DeviceEventBase & { type: 'approval'; approval: DeviceApproval })
	| (DeviceEventBase & { type: 'approval-removed'; approvalId: string })
	| (DeviceEventBase & { type: 'agent-session'; session: DeviceAgentSession })
	| (DeviceEventBase & { type: 'agent-session-removed'; sessionId: string })
	| (DeviceEventBase & { type: 'screen-session'; session: DeviceScreenSession })
	| (DeviceEventBase & { type: 'screen-session-removed'; sessionId: string });

export type DeviceActionPolicy = {
	allowed: boolean;
	delivery: 'local' | 'immediate' | 'queued' | 'blocked';
	reason:
		| 'ready'
		| 'local-only'
		| 'service-unavailable'
		| 'not-paired'
		| 'device-offline'
		| 'device-locked'
		| 'capability-unsupported'
		| 'capability-disabled'
		| 'permission-required'
		| 'connector-unavailable';
	message: string | null;
	capabilityId: string | null;
	requiredPermissions: DevicePermissionKind[];
	approvalRequired: boolean;
};

export type DeviceDesiredReconciliation = {
	observed: DeviceObservedState | null;
	effective: DeviceObservedState | null;
	pendingFields: Array<keyof DeviceDesiredState>;
	pendingCommandIds: string[];
	confirmedCommandIds: string[];
	revertedCommandIds: string[];
};
