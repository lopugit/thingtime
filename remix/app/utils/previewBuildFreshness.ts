const VERCEL_PREVIEW_SUFFIX = '.vercel.app';
const ENTRY_ASSET_PATH = /\/assets\/index-[^/?#]+\.js$/i;
const ENTRY_ASSET_IN_HTML = /\bsrc\s*=\s*["']([^"']*\/assets\/index-[^"']+\.js(?:[?#][^"']*)?)["']/i;

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

// A Vercel branch alias can move to a repaired deployment while an iOS tab is
// still holding the previous client bundle. If that old React tree crashed,
// the page can remain visually present while every control feels inert. Keep
// this outside React so it survives a route render failure and can reload the
// alias as soon as the tab returns to the foreground.
export const installPreviewBuildFreshness = (): (() => void) => {
	if (typeof window === 'undefined' || typeof document === 'undefined' || !isVercelPreviewHost(window.location.hostname)) {
		return () => undefined;
	}

	const loadedAsset = previewEntryAssetFromSources(
		Array.from(document.scripts, (script) => script.src),
		window.location.origin
	);
	if (!loadedAsset) return () => undefined;

	let disposed = false;
	let checking = false;
	let lastCheckAt = 0;
	const minimumCheckIntervalMs = 15_000;

	const check = async (force = false) => {
		const now = Date.now();
		if (disposed || checking || (!force && now - lastCheckAt < minimumCheckIntervalMs)) return;

		checking = true;
		lastCheckAt = now;

		try {
			const url = new URL('/', window.location.origin);
			url.searchParams.set('__tt_preview_build_check', String(now));
			const response = await window.fetch(url, {
				cache: 'no-store',
				credentials: 'same-origin',
				headers: { Accept: 'text/html' }
			});
			if (!response.ok || disposed) return;

			const liveAsset = previewEntryAssetFromHtml(await response.text(), window.location.origin);
			if (isStalePreviewEntry(loadedAsset, liveAsset) && !disposed) {
				window.location.reload();
			}
		} catch {
			// Offline or transient preview checks must never disturb the live app.
		} finally {
			checking = false;
		}
	};

	const onPageShow = (event: PageTransitionEvent) => void check(event.persisted);
	const onFocus = () => void check();
	const onVisibilityChange = () => {
		if (document.visibilityState === 'visible') void check();
	};

	window.addEventListener('pageshow', onPageShow);
	window.addEventListener('focus', onFocus);
	document.addEventListener('visibilitychange', onVisibilityChange);
	void check(true);

	return () => {
		disposed = true;
		window.removeEventListener('pageshow', onPageShow);
		window.removeEventListener('focus', onFocus);
		document.removeEventListener('visibilitychange', onVisibilityChange);
	};
};
