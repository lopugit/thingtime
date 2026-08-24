export type ThingtimeDesktopEndpointProfile = {
	id: string;
	label: string;
	url: string;
	source: 'built-in' | 'build' | 'custom';
};

export type ThingtimeDesktopMenuBarIcon = {
	id: string;
	label: string;
	custom?: boolean;
};

export type ThingtimeDesktopSettings = {
	autoStartNodeOnLaunch: boolean;
	customMenuBarIconConfigured: boolean;
	endpointProfiles: ThingtimeDesktopEndpointProfile[];
	menuBarIcons: ThingtimeDesktopMenuBarIcon[];
	selectedEndpoint: ThingtimeDesktopEndpointProfile;
	selectedEndpointId: string;
	selectedMenuBarIconId: string;
};

export type ThingtimeDesktopEndpointCompatibility = {
	checkedAt?: string;
	message?: string;
	status: 'checking' | 'compatible' | 'incompatible' | 'unreachable';
};

export type ThingtimeDesktopInfo = {
	appVersion?: string;
	contentOrigin?: string | null;
	currentUrl?: string | null;
	desktopSettings?: ThingtimeDesktopSettings | null;
	desktopSettingsLastError?: string | null;
	endpointCompatibility?: ThingtimeDesktopEndpointCompatibility | null;
	isPackaged?: boolean;
	origin?: string | null;
	platform?: string;
	sessionHash?: string;
	titlebar?: {
		enabled?: boolean;
		height?: number;
		leftInset?: number;
		navStart?: number;
		style?: string;
		trafficLightPosition?: { x?: number; y?: number } | null;
	};
	updateFeedUrl?: string | null;
};

export type ThingtimeDesktopUpdateAsset = {
	contentType?: string | null;
	downloadUrl?: string | null;
	label?: string | null;
	name?: string | null;
	size?: number | null;
};

export type ThingtimeDesktopUpdateInfo = {
	asset?: ThingtimeDesktopUpdateAsset | null;
	cachedBundle?: ThingtimeDesktopCachedBundle | null;
	checkedAt?: string;
	currentVersion?: string;
	downloadedAt?: string;
	downloadPath?: string;
	feedUrl?: string | null;
	latestVersion?: string | null;
	message?: string;
	releaseName?: string | null;
	releaseUrl?: string | null;
	status?: 'available' | 'error' | 'unavailable' | 'up-to-date';
	updateAvailable?: boolean;
};

export type ThingtimeDesktopRelease = {
	asset?: ThingtimeDesktopUpdateAsset | null;
	branch?: string | null;
	commit?: string | null;
	id: string;
	isCurrent?: boolean;
	isPrerelease?: boolean;
	name?: string | null;
	publishedAt?: string | null;
	pullRequestNumber?: number | null;
	releaseUrl?: string | null;
	tag?: string | null;
	version?: string | null;
};

export type ThingtimeDesktopCachedBundle = {
	assetName?: string | null;
	branch?: string | null;
	cachedAt?: string | null;
	cacheState?: 'ready';
	commit?: string | null;
	key: string;
	name?: string | null;
	pullRequestNumber?: number | null;
	releaseUrl?: string | null;
	tag?: string | null;
	version?: string | null;
};

export type ThingtimeDesktopReleaseCatalog = {
	cachedBundles: ThingtimeDesktopCachedBundle[];
	catalogError?: string | null;
	checkedAt?: string;
	currentVersion?: string;
	feedUrl?: string | null;
	releases: ThingtimeDesktopRelease[];
	truncated?: boolean;
};

export type ThingtimeAiDesktopSource = {
	sourceId: 'chatgpt' | 'claude' | 'claude-thingtime';
	provider: 'chatgpt' | 'claude';
	label: string;
	description: string;
	installed: boolean;
	localAvailable: boolean;
	exportSupported: boolean;
	localDetail?: string | null;
};

export type ThingtimeAiSyncBatch = {
	syncId: string;
	source: {
		provider: 'chatgpt' | 'claude';
		sourceId: string;
		label: string;
		connector: string;
		mode: 'local' | 'export';
	};
	groups: Array<{ id: string; name: string; kind: 'workspace' | 'project' | 'group' }>;
	conversations: Array<{
		id: string;
		title: string;
		groupId: string | null;
		createdAt: string | null;
		updatedAt: string | null;
	}>;
	messages: Array<{
		id: string;
		conversationId: string;
		role: 'user' | 'assistant' | 'system' | 'unknown';
		authorName: string | null;
		text: string;
		createdAt: string | null;
	}>;
	final: boolean;
	totals: { groups: number; conversations: number; messages: number };
	progress: { completed: number; total: number };
};

export type ThingtimeNodeServiceStatus = 'absent' | 'needs-approval' | 'starting' | 'running' | 'degraded' | 'stopped' | 'version-mismatch';
export type ThingtimeNodePairingStatus = 'unpaired' | 'pairing' | 'paired' | 'revoked';
export type ThingtimeNodeTransportStatus = 'unknown' | 'offline' | 'connecting' | 'online' | 'backoff';
export type ThingtimeNodePermissionStatus = 'not-determined' | 'denied' | 'restricted' | 'authorized';

export type ThingtimeNodeStatus = {
	deviceId?: string | null;
	deviceIds?: string[];
	pairedAccountCount?: number;
	serviceStatus: ThingtimeNodeServiceStatus;
	pairingStatus: ThingtimeNodePairingStatus;
	recoverablePairing?: boolean;
	transportStatus: ThingtimeNodeTransportStatus;
	version?: string | null;
	lastSeenAt?: string | null;
	lastError?: { code: string; message?: string | null; at?: string | null } | null;
	capabilities?: string[];
	connector?: { state: string; detail?: string | null; processIdentifier?: number | null };
	journalEntryCount?: number;
	loginItem?: { label: string; registered: boolean; state: string };
	permissions?: ThingtimeNodePermission[];
	rawStatus?: Record<string, unknown>;
};

export type ThingtimeNodePermission = {
	kind: string;
	status: ThingtimeNodePermissionStatus;
	updatedAt?: string | null;
};

export type ThingtimeNodePermissions = {
	permissions: ThingtimeNodePermission[];
};

export type ThingtimeNodeProjectReference = {
	projectId: string;
	projectLabel: string;
};

export type ThingtimeNodePairingChallenge = {
	code?: string | null;
	expiresAt?: string | null;
	nonce?: string | null;
	publicKey?: string | null;
	status?: ThingtimeNodePairingStatus;
};

export type ThingtimeNodeConnectorRequest =
	| { action: 'start' | 'stop'; commandId: string }
	| {
			action: 'send';
			commandId: string;
			operation:
				| 'connector/list'
				| 'connector/start'
				| 'connector/stop'
				| 'session/list'
				| 'session/read'
				| 'session/create'
				| 'session/send'
				| 'session/interrupt'
				| 'approval/respond';
			payload?: Record<string, unknown>;
	  };

export type ThingtimeNodeDeviceRequest =
	| { action: 'snapshot' | 'permissions' }
	| {
			action: 'evaluate' | 'execute';
			commandId?: string;
			request: {
				kind:
					| 'telemetry.refresh'
					| 'system.volume.set'
					| 'system.audio.mute.set'
					| 'system.audio.output.set'
					| 'system.audio.input.set'
					| 'system.audio.sound-effects-output.set'
					| 'system.brightness.set'
					| 'application.activate'
					| 'application.launch'
					| 'application.quit'
					| 'application.force-quit'
					| 'application.hide'
					| 'application.unhide'
					| 'application.hide-others'
					| 'system.lock'
					| 'system.sleep'
					| 'system.wifi.connect'
					| 'system.wifi.disconnect'
					| 'system.wifi.power.set';
				parameters?: Record<string, unknown>;
			};
	  };

export type ThingtimeDesktopBridge = {
	discoverAiSources?: () => Promise<{ sources: ThingtimeAiDesktopSource[] }>;
	beginAiSync?: (request: {
		sourceId: string;
		mode: 'local' | 'export';
	}) => Promise<{ syncId: string; totals: ThingtimeAiSyncBatch['totals'] } | { cancelled: true }>;
	readAiSyncBatch?: (request: { syncId: string }) => Promise<ThingtimeAiSyncBatch>;
	cancelAiSync?: (request: { syncId: string }) => Promise<{ ok: true }>;
	checkForUpdates?: () => Promise<ThingtimeDesktopUpdateInfo>;
	downloadUpdateBundle?: () => Promise<ThingtimeDesktopUpdateInfo>;
	listUpdateCatalog?: () => Promise<ThingtimeDesktopReleaseCatalog>;
	cacheReleaseBundle?: (request: { releaseId: string }) => Promise<{ cachedBundle: ThingtimeDesktopCachedBundle; catalog: ThingtimeDesktopReleaseCatalog }>;
	installCachedRelease?: (request: { key: string }) => Promise<{ cachedBundle: ThingtimeDesktopCachedBundle; message: string; status: 'relaunching' }>;
	launchCachedRelease?: (request: { key: string }) => Promise<{ cachedBundle: ThingtimeDesktopCachedBundle; message: string; status: 'relaunching' }>;
	removeCachedRelease?: (request: { key: string }) => Promise<ThingtimeDesktopReleaseCatalog>;
	revealUpdateCache?: () => Promise<{ cachePath: string }>;
	getInfo?: () => Promise<ThingtimeDesktopInfo>;
	getDesktopSettings?: () => Promise<ThingtimeDesktopSettings>;
	addEndpoint?: (request: { label: string; url: string }) => Promise<ThingtimeDesktopSettings>;
	removeEndpoint?: (request: { endpointId: string }) => Promise<ThingtimeDesktopSettings>;
	selectEndpoint?: (request: { endpointId: string }) => Promise<ThingtimeDesktopInfo>;
	checkEndpointCompatibility?: () => Promise<ThingtimeDesktopInfo>;
	selectMenuBarIcon?: (request: { iconId: string }) => Promise<ThingtimeDesktopSettings>;
	uploadMenuBarIcon?: () => Promise<{ cancelled: true } | { cancelled: false; settings: ThingtimeDesktopSettings }>;
	setNodeAutoStart?: (request: { enabled: boolean }) => Promise<ThingtimeDesktopSettings>;
	loadUrl?: (url: string) => Promise<ThingtimeDesktopInfo>;
	navigateToUrl?: (url: string) => Promise<ThingtimeDesktopInfo>;
	// Narrow local-node setup and macOS privacy surface. Ordinary device
	// commands deliberately do not travel through a loaded renderer page; they
	// are authenticated server commands claimed by the local node.
	nodeGetStatus?: () => Promise<ThingtimeNodeStatus>;
	nodeRegisterService?: () => Promise<ThingtimeNodeStatus>;
	nodeUnregisterService?: () => Promise<ThingtimeNodeStatus>;
	nodeBeginPairing?: () => Promise<ThingtimeNodePairingChallenge>;
	nodeCompletePairing?: (request: { pairingSecret: string; commandId: string }) => Promise<ThingtimeNodeStatus>;
	nodeResumePairing?: (request: { commandId: string }) => Promise<ThingtimeNodeStatus>;
	nodeUnpair?: (request: { commandId: string }) => Promise<ThingtimeNodeStatus>;
	nodeGetPermissions?: () => Promise<ThingtimeNodePermissions>;
	nodeOpenPermissionSettings?: (request: { kind: 'accessibility' | 'screen-recording' }) => Promise<{
		kind: 'accessibility' | 'screen-recording';
		opened: boolean;
		permissions?: ThingtimeNodePermission[];
	}>;
	nodeAddProject?: () => Promise<{ cancelled: true } | { cancelled: false; project: ThingtimeNodeProjectReference; status: ThingtimeNodeStatus }>;
	nodeConnector?: (request: ThingtimeNodeConnectorRequest) => Promise<unknown>;
	nodeDevice?: (request: ThingtimeNodeDeviceRequest) => Promise<unknown>;
	platform?: string;
	versions?: {
		chrome?: string;
		electron?: string;
	};
};

declare global {
	interface Window {
		thingtimeDesktop?: ThingtimeDesktopBridge;
	}
}

export const electronUrlSettingKey = (sessionHash: string) => `${sessionHash}URL`;
export const electronAutoUpdateSettingKey = (sessionHash: string) => `${sessionHash}AutoUpdateEnabled`;

export const electronUrlSettingPath = (sessionHash: string) => `settings.electron.${electronUrlSettingKey(sessionHash)}`;
export const electronAutoUpdateSettingPath = (sessionHash: string) => `settings.electron.${electronAutoUpdateSettingKey(sessionHash)}`;

export const getElectronBridge = () => {
	if (typeof window === 'undefined') {
		return undefined;
	}

	return window.thingtimeDesktop;
};

export const getElectronSettingUrl = (thingtime: any, sessionHash?: string | null) => {
	if (!sessionHash) {
		return '';
	}

	const value = thingtime?.settings?.electron?.[electronUrlSettingKey(sessionHash)];
	return typeof value === 'string' ? value : '';
};

export const getElectronAutoUpdateEnabled = (thingtime: any, sessionHash?: string | null) => {
	if (!sessionHash) {
		return true;
	}

	const value = thingtime?.settings?.electron?.[electronAutoUpdateSettingKey(sessionHash)];
	return typeof value === 'boolean' ? value : true;
};

export const normalizeElectronUrl = (rawUrl?: string | null) => {
	const value = String(rawUrl || '').trim();

	if (!value) {
		return '';
	}

	try {
		const url = new URL(value);

		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return '';
		}

		return url.href;
	} catch {
		return '';
	}
};

export const loadElectronUrl = (bridge: ThingtimeDesktopBridge, url: string) => {
	if (bridge.loadUrl) {
		return bridge.loadUrl(url);
	}

	if (bridge.navigateToUrl) {
		return bridge.navigateToUrl(url);
	}

	return Promise.reject(new Error('Thingtime desktop URL loading is unavailable.'));
};
