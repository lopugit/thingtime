type PageLocation = { pathname: string; search: string; hash?: string };
const origin = 'https://component.invalid';
const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(id);

function isPage(pageId: string, location: PageLocation): boolean {
	return /^\/p\/[^/]+$/.test(location.pathname) ||
		(location.pathname === '/builder' && new URLSearchParams(location.search).get('page') === pageId);
}

// Query links belong to the current app in both the live page and Builder.
// Rewriting never changes an external URL or another page's destination.
export function componentPageHref(pageId: string | null, location: PageLocation, href: string): string {
	if (!validId(pageId) || !isPage(pageId, location) || href.length > 4096 || !/^(?:[?#]|\/(?!\/))/.test(href)) return href;
	const target = new URL(href, origin + location.pathname + location.search);
	if (target.origin !== origin) return href;
	const canonical = `/p/${encodeURIComponent(pageId)}`;
	if (!href.startsWith('?') && !href.startsWith('#') && target.pathname !== location.pathname && target.pathname !== canonical) return href;
	if (target.pathname === '/builder' && !href.startsWith('?') && target.searchParams.get('page') !== pageId) return href;
	if (location.pathname === '/builder') {
		target.searchParams.set('page', pageId);
		const mode = new URLSearchParams(location.search).get('mode');
		if (mode) target.searchParams.set('mode', mode);
	}
	return location.pathname + target.search + target.hash;
}

export function componentNavigationState(pageId: string | null, location: PageLocation, href: string): unknown {
	if (!validId(pageId) || !isPage(pageId, location) || href.length > 4096 || !href.startsWith(location.pathname + '?')) return undefined;
	const target = new URL(href, origin);
	if (!isPage(pageId, { pathname: target.pathname, search: target.search })) return undefined;
	const from = location.pathname + location.search + (location.hash || '');
	if (from === href || from.length > 4096) return undefined;
	return { ttComponentNavigation: { pageId, from, to: href } };
}

export function hasComponentBackEntry(pageId: string | null, location: PageLocation, state: unknown): boolean {
	if (!validId(pageId) || !isPage(pageId, location) || !state || typeof state !== 'object') return false;
	const entry = (state as { ttComponentNavigation?: { pageId?: unknown; from?: unknown; to?: unknown } }).ttComponentNavigation;
	if (!entry || entry.pageId !== pageId || typeof entry.from !== 'string' || entry.from.length > 4096) return false;
	if (entry.to !== location.pathname + location.search + (location.hash || '') || !entry.from.startsWith(location.pathname)) return false;
	const previous = new URL(entry.from, origin);
	return previous.origin === origin && previous.pathname === location.pathname && isPage(pageId, { pathname: previous.pathname, search: previous.search });
}
