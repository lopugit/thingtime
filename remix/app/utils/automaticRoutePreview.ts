import generatedRoutes from './automaticRoutePreviews.generated.json';
import type { SocialPreviewVariant } from '../api/utils/meta/socialPreview';

export const DEFAULT_ROUTE_PAGE_TITLE = 'Thingtime - Your Home for Everything';
export type RoutePreviewOverride = {
	title?: string;
	description?: string;
	eyebrow?: string;
	badges?: string[];
	variant?: SocialPreviewVariant;
	/** Optional document-title label, independent of the card headline. */
	pageTitle?: string;
	revision?: string;
};
export type AutomaticRouteEntry = { pattern: string; label: string; index?: boolean; caseSensitive?: boolean; preview: RoutePreviewOverride };

const hasControls = (value: string): boolean => Array.from(value).some((character) => character.charCodeAt(0) < 32);

const matches = (pattern: string, path: string, caseSensitive = false): boolean => {
	const route = pattern.split('/').filter(Boolean);
	let segments: string[];
	try {
		segments = path.split('/').filter(Boolean).map(decodeURIComponent);
	} catch {
		return false;
	}
	if (segments.some((segment) => /[\\/]/.test(segment) || hasControls(segment))) return false;
	const walk = (r: number, p: number): boolean => {
		if (r === route.length) return p === segments.length;
		const part = route[r];
		if (part.startsWith(':')) return (p < segments.length && walk(r + 1, p + 1)) || (part.endsWith('?') && walk(r + 1, p));
		const literal = part.endsWith('?') ? part.slice(0, -1) : part;
		const equal = p < segments.length && (caseSensitive ? literal === segments[p] : literal.toLowerCase() === segments[p].toLowerCase());
		return (equal && walk(r + 1, p + 1)) || (part.endsWith('?') && walk(r + 1, p));
	};
	return walk(0, 0);
};

/** Pure shared route defaults. Route parameters and request query/fragment
 * values never become copy; matching never imports or executes page modules. */
export const automaticRoutePreview = (value: string, routes: readonly AutomaticRouteEntry[] = generatedRoutes as AutomaticRouteEntry[]) => {
	if (
		typeof value !== 'string' ||
		!value.startsWith('/') ||
		value.startsWith('//') ||
		value.includes('\\') ||
		hasControls(value) ||
		value.length > 2048
	)
		return null;
	const path = value.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
	const candidates = routes.filter((entry) => !entry.pattern.includes('*') && matches(entry.pattern, path, entry.caseSensitive));
	const score = (entry: AutomaticRouteEntry) =>
		entry.pattern.split('/').reduce((total, segment) => total + (segment ? (segment.startsWith(':') ? 3 : 10) : 0), entry.index ? 0.5 : 0);
	candidates.sort((a, b) => score(b) - score(a));
	const selected = candidates[0];
	if (!selected) return null;
	const { pageTitle, ...override } = selected.preview;
	const label = pageTitle || selected.label;
	const routeTitle = path === '/' ? DEFAULT_ROUTE_PAGE_TITLE : label.startsWith('Thingtime') ? label : `Thingtime - ${label}`;
	return {
		routeTitle,
		label: selected.label,
		title: routeTitle,
		description:
			path === '/'
				? 'Everything is a thing — share posts, run polls and build a home for the things you care about.'
				: `Open ${selected.label} on Thingtime — a home for the things you care about.`,
		eyebrow: `THINGTIME · ${selected.label.toUpperCase()}`,
		badges: [] as string[],
		variant: (path === '/' ? 'app' : 'webpage') as SocialPreviewVariant,
		...override
	};
};
