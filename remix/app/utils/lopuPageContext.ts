/* eslint-disable no-control-regex -- URL and label validation intentionally rejects control characters. */
// Page references are labels/URLs, not trusted instructions or access grants.
export type LopuPageReference = { url: string; title: string };
export const LOPU_MAX_PAGE_REFERENCES = 10;
const SAFE_QUERY_KEYS = new Set(['q', 'tab', 'view', 'sort', 'filter', 'algorithm', 'kind', 'page']);

export function lopuPageReference(raw: unknown): LopuPageReference | null {
	if (!raw || typeof raw !== 'object') return null;
	const { url, title } = raw as Record<string, unknown>;
	if (typeof url !== 'string' || url.length > 300 || !url.startsWith('/') || url.startsWith('//') || /[\\\s\u0000-\u001f]/.test(url)) return null;
	try {
		const parsed = new URL(url, 'https://thingtime.invalid');
		if (parsed.origin !== 'https://thingtime.invalid') return null;
		// Login, invite and credential callbacks are never browsing context.
		const decodedPath = decodeURIComponent(parsed.pathname);
		if (/[\\\u0000-\u001f]/.test(decodedPath)) return null;
		if (/^\/(?:api|invite|login|register|reset-password|verify|oauth|authorize|auth)(?:\/|$)/i.test(decodedPath)) return null;
		for (const key of [...parsed.searchParams.keys()]) if (!SAFE_QUERY_KEYS.has(key)) parsed.searchParams.delete(key);
		const path = parsed.pathname + parsed.search;
		return { url: path, title: typeof title === 'string' ? title.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120) || path : path };
	} catch { return null; }
}

export function lopuPageReferences(raw: unknown): LopuPageReference[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	return raw.slice(0, 100).flatMap(item => {
		const page = lopuPageReference(item);
		if (!page || seen.has(page.url)) return [];
		seen.add(page.url); return [page];
	}).slice(0, LOPU_MAX_PAGE_REFERENCES);
}
