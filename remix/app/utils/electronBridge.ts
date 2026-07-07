export type ThingtimeDesktopInfo = {
	appVersion?: string;
	contentOrigin?: string | null;
	currentUrl?: string | null;
	isPackaged?: boolean;
	origin?: string | null;
	platform?: string;
	sessionHash?: string;
};

export type ThingtimeDesktopBridge = {
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

export const electronUrlSettingPath = (sessionHash: string) => `settings.electron.${electronUrlSettingKey(sessionHash)}`;

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

