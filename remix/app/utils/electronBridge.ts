export type ThingtimeDesktopInfo = {
	appVersion?: string;
	contentOrigin?: string | null;
	currentUrl?: string | null;
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

export type ThingtimeDesktopBridge = {
	discoverAiSources?: () => Promise<{ sources: ThingtimeAiDesktopSource[] }>;
	beginAiSync?: (request: { sourceId: string; mode: 'local' | 'export' }) => Promise<{ syncId: string; totals: ThingtimeAiSyncBatch['totals'] } | { cancelled: true }>;
	readAiSyncBatch?: (request: { syncId: string }) => Promise<ThingtimeAiSyncBatch>;
	cancelAiSync?: (request: { syncId: string }) => Promise<{ ok: true }>;
	checkForUpdates?: () => Promise<ThingtimeDesktopUpdateInfo>;
	downloadUpdateBundle?: () => Promise<ThingtimeDesktopUpdateInfo>;
	getInfo?: () => Promise<ThingtimeDesktopInfo>;
	loadUrl?: (url: string) => Promise<ThingtimeDesktopInfo>;
	navigateToUrl?: (url: string) => Promise<ThingtimeDesktopInfo>;
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
export const electronAutoUpdateSettingPath = (sessionHash: string) =>
	`settings.electron.${electronAutoUpdateSettingKey(sessionHash)}`;

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
