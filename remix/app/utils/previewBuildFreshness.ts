const VERCEL_PREVIEW_SUFFIX = '.vercel.app';
const ENTRY_ASSET_PATH = /\/assets\/index-[^/?#]+\.js$/i;
const ENTRY_ASSET_IN_HTML = /\bsrc\s*=\s*["']([^"']*\/assets\/index-[^"']+\.js(?:[?#][^"']*)?)["']/i;
const PREVIEW_REFRESH_PARAM = '__tt_preview_refresh';

const assetPath = (value: string, baseOrigin = 'https://thingtime.invalid'): string | null => {
	if (!value) return null;

	try {
		const path = new URL(value, baseOrigin).pathname;
		return ENTRY_ASSET_PATH.test(path) ? path : null;
	} catch {
		return null;
	}
};

export const previewEntryAssetFromSources = (sources: readonly string[], baseOrigin?: string): string | null => {
	for (const source of sources) {
		const path = assetPath(source, baseOrigin);
		if (path) return path;
	}

	return null;
};

export const previewEntryAssetFromHtml = (html: string, baseOrigin?: string): string | null => {
	const source = html.match(ENTRY_ASSET_IN_HTML)?.[1];
	return source ? assetPath(source, baseOrigin) : null;
};

export const isVercelPreviewHost = (hostname: string): boolean => hostname.toLowerCase().endsWith(VERCEL_PREVIEW_SUFFIX);

export const isStalePreviewEntry = (loadedAsset: string | null, liveAsset: string | null): boolean =>
	Boolean(loadedAsset && liveAsset && loadedAsset !== liveAsset);

export const previewRefreshUrl = (href: string, asset: string | null, now = Date.now()): string => {
	const url = new URL(href);
	const build =
		asset
			?.split('/')
			.pop()
			?.replace(/[^a-z0-9._-]/gi, '') || 'unknown';
	url.searchParams.set(PREVIEW_REFRESH_PARAM, `${build}-${now}`);
	return url.toString();
};

type PreviewFreshnessRuntime = {
	window: Window;
	document: Document;
	now?: () => number;
};

// A Vercel branch alias can move to a repaired deployment while an iOS tab is
// still holding the previous client bundle. Vite serialises this self-contained
// function into a classic inline head script, before it evaluates the main app
// module graph, so even an import-time React failure cannot disable recovery.
export const installPreviewBuildFreshness = (runtime?: PreviewFreshnessRuntime): (() => void) => {
	if (!runtime && (typeof window === 'undefined' || typeof document === 'undefined')) {
		return () => undefined;
	}

	const win = runtime?.window ?? window;
	const doc = runtime?.document ?? document;
	const currentTime = runtime?.now ?? (() => Date.now());
	const previewSuffix = '.vercel.app';
	const entryAssetPath = /\/assets\/index-[^/?#]+\.js$/i;
	const entryAssetInHtml = /\bsrc\s*=\s*["']([^"']*\/assets\/index-[^"']+\.js(?:[?#][^"']*)?)["']/i;
	const refreshParam = '__tt_preview_refresh';
	const minimumCheckIntervalMs = 15_000;

	if (!win.location.hostname.toLowerCase().endsWith(previewSuffix)) return () => undefined;

	const toAssetPath = (value: string): string | null => {
		if (!value) return null;

		try {
			const path = new URL(value, win.location.origin).pathname;
			return entryAssetPath.test(path) ? path : null;
		} catch {
			return null;
		}
	};
	const loadedAsset = (): string | null => {
		for (const script of Array.from(doc.scripts)) {
			const path = toAssetPath(script.src);
			if (path) return path;
		}

		return null;
	};
	const assetFromHtml = (html: string): string | null => {
		const source = html.match(entryAssetInHtml)?.[1];
		return source ? toAssetPath(source) : null;
	};
	const refreshUrl = (asset: string | null): string => {
		const url = new URL(win.location.href);
		const build =
			asset
				?.split('/')
				.pop()
				?.replace(/[^a-z0-9._-]/gi, '') || 'unknown';
		url.searchParams.set(refreshParam, `${build}-${currentTime()}`);
		return url.toString();
	};

	let disposed = false;
	let checking = false;
	let lastCheckAt = 0;
	let recoverAfterRuntimeError = false;
	let runtimeRecoveryClaimed = false;

	const reloadFromNetwork = (asset: string | null) => {
		win.location.replace(refreshUrl(asset));
	};
	const claimRuntimeRecovery = (asset: string) => {
		if (runtimeRecoveryClaimed) return false;

		const build = asset.split('/').pop() || 'unknown';
		const activeRefresh = new URL(win.location.href).searchParams.get(refreshParam);
		if (activeRefresh?.startsWith(`${build}-`)) return false;

		const key = `tt-preview-runtime-recovery:${asset}`;
		try {
			if (win.sessionStorage.getItem(key)) return false;
			win.sessionStorage.setItem(key, '1');
		} catch {
			// The URL marker plus the in-memory claim still prevent a reload loop
			// when strict privacy mode makes sessionStorage unavailable.
		}

		runtimeRecoveryClaimed = true;
		return true;
	};

	const check = async (force = false, recoverCurrentBuild = false) => {
		if (recoverCurrentBuild) recoverAfterRuntimeError = true;
		const now = currentTime();
		if (disposed || checking || (!force && now - lastCheckAt < minimumCheckIntervalMs)) return;

		const currentAsset = loadedAsset();
		if (!currentAsset) return;

		checking = true;
		lastCheckAt = now;

		try {
			const url = new URL('/', win.location.origin);
			url.searchParams.set('__tt_preview_build_check', String(now));
			const response = await win.fetch(url, {
				cache: 'no-store',
				credentials: 'same-origin',
				headers: { Accept: 'text/html' }
			});
			if (!response.ok || disposed) return;

			const liveAsset = assetFromHtml(await response.text());
			if (liveAsset && currentAsset !== liveAsset && !disposed) {
				reloadFromNetwork(liveAsset);
				return;
			}

			if (recoverAfterRuntimeError && liveAsset && !disposed) {
				recoverAfterRuntimeError = false;
				if (claimRuntimeRecovery(liveAsset)) reloadFromNetwork(liveAsset);
			}
		} catch {
			// Offline or transient preview checks must never disturb the live app.
		} finally {
			checking = false;
		}
	};

	const onPageShow = (event: PageTransitionEvent) => {
		const currentAsset = loadedAsset();
		if (event.persisted && currentAsset) {
			// Safari's page cache restores a suspended document without consulting
			// HTTP cache headers. Preview aliases are intentionally moving targets,
			// so trade that optimisation for a real versioned navigation.
			reloadFromNetwork(currentAsset);
			return;
		}

		void check(true);
	};
	const onFocus = () => void check();
	const onVisibilityChange = () => {
		if (doc.visibilityState === 'visible') void check();
	};
	const onRuntimeError = (event: ErrorEvent) => {
		if (!event.filename) return;

		try {
			const source = new URL(event.filename, win.location.origin);
			if (source.origin !== win.location.origin || !source.pathname.startsWith('/assets/')) return;
		} catch {
			return;
		}

		void check(true, true);
	};
	const onDocumentReady = () => void check(true);

	win.addEventListener('pageshow', onPageShow);
	win.addEventListener('focus', onFocus);
	win.addEventListener('error', onRuntimeError);
	doc.addEventListener('visibilitychange', onVisibilityChange);
	if (doc.readyState === 'loading') {
		doc.addEventListener('DOMContentLoaded', onDocumentReady, { once: true });
	} else {
		void check(true);
	}

	return () => {
		disposed = true;
		win.removeEventListener('pageshow', onPageShow);
		win.removeEventListener('focus', onFocus);
		win.removeEventListener('error', onRuntimeError);
		doc.removeEventListener('visibilitychange', onVisibilityChange);
		doc.removeEventListener('DOMContentLoaded', onDocumentReady);
	};
};
