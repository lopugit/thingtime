import React from 'react';
import { useLocation } from 'react-router';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { QUICK_PAGES, readQuickRecents } from '~/components/QuickSwitcher/quickSwitcherCore';
import { lopuPageReference, type LopuPageReference } from '~/utils/lopuPageContext';

const historyKey = (owner: string) => `tt-lopu-pages-${owner}`;
export type LopuRecentPage = LopuPageReference & { at: number };
export function readLopuRecentPages(owner: string): LopuRecentPage[] {
	const cached = readLocalCache<LopuRecentPage[]>(historyKey(owner));
	const rows = [...(Array.isArray(cached) ? cached : []), ...readQuickRecents(owner).map(row => ({ url: row.href, title: row.label, at: row.at }))];
	const seen = new Set<string>();
	return rows.sort((a, b) => (b?.at || 0) - (a?.at || 0)).flatMap(row => {
		const page = lopuPageReference(row);
		if (!page || seen.has(page.url)) return [];
		seen.add(page.url); return [{ ...page, at: Number(row.at) || 0 }];
	}).slice(0, 60);
}

export function useLopuCurrentPage(): LopuPageReference | null {
	const location = useLocation();
	const route = location.pathname + location.search;
	const [pageTitle, setPageTitle] = React.useState({ route: '', title: '' });
	React.useEffect(() => {
		const read = () => {
			const title = document.title.replace(/^\[[^\]]+\]\s*/, '').replace(/(?: · Thingtime| - Thingtime)$/, '');
			setPageTitle(previous => previous.route === route && previous.title === title ? previous : { route, title });
		};
		const observer = new MutationObserver(read);
		observer.observe(document.querySelector('title') || document.head, { childList: true, subtree: true, characterData: true });
		read();
		return () => observer.disconnect();
	}, [route]);
	return React.useMemo(() => {
		const known = QUICK_PAGES.find(page => page.href === location.pathname);
		let label = location.pathname === '/' ? 'Home' : location.pathname;
		try { label = decodeURIComponent(label); } catch { /* malformed path stays readable */ }
		return lopuPageReference({ url: location.pathname + location.search, title: known?.label || (pageTitle.route === route && pageTitle.title && !pageTitle.title.startsWith('Thingtime') ? pageTitle.title : label) });
	}, [location.pathname, location.search, pageTitle, route]);
}

// Mounted once in the root, so normal navigation is recorded even while Lopu
// is minimised. Account-owned device history; logout clears the tt-lopu prefix.
export function LopuPageTracker() {
	const user = useCurrentUser();
	const current = useLopuCurrentPage();
	React.useEffect(() => {
		if (!user?.id || !current) return;
		const rows = [{ ...current, at: Date.now() }, ...readLopuRecentPages(user.id).filter(row => row.url !== current.url)].slice(0, 60);
		writeLocalCache(historyKey(user.id), rows);
	}, [user?.id, current]);
	return null;
}
