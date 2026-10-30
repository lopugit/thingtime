// Live sitemap engine — the data-backed half of sitemapCore.ts.
//
// Every UGC section runs as the anonymous null viewer through exactly the
// pipeline the public Atom feed uses (things/rss.ts): a PUBLIC (tt:all)
// superset match, then the exact per-document acl walk (canViewInherited),
// so a URL can only appear here when an anonymous GET of it would succeed.
// Nothing but the permalink and a timestamp is emitted — no text, no author
// names, no counts — so the sitemap can never leak more than the URL itself.
//
// The data-plane calls sit behind `SitemapDataSource` so unit tests and the
// offline generator can exercise the whole response path without MongoDB.

import brandingAssetsJson from '../../../components/Branding/brandingAssets.generated.json';
import {
	PAGED_SITEMAP_SECTIONS,
	SITEMAP_MAX_PAGES,
	SITEMAP_MAX_PROFILES,
	SITEMAP_PAGE_SIZE,
	absoluteUrl,
	buildRobotsTxt,
	pageCountFor,
	renderSitemapIndex,
	renderUrlset,
	selectSitemapRequest,
	sitemapDate,
	sitemapIndexEntries,
	staticSitemapUrls,
	type BrandingAssetsManifest,
	type SitemapSection,
	type SitemapUrl
} from './sitemapCore';

const brandingAssets = brandingAssetsJson as BrandingAssetsManifest;

export type SitemapPage = { urls: SitemapUrl[] };

export type SitemapDataSource = {
	countPublicPosts: () => Promise<number>;
	listPublicPosts: (page: number) => Promise<SitemapUrl[]>;
	countPublicWebpages: () => Promise<number>;
	listPublicWebpages: (page: number) => Promise<SitemapUrl[]>;
	listPublicProfiles: () => Promise<SitemapUrl[]>;
};

// Shared cache contract for every sitemap/robots response: anonymous-only and
// URL-keyed, so the Vercel edge may hold it for an hour and serve stale for a
// day while revalidating. Search engines re-fetch on their own schedule.
export const SITEMAP_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

const xmlHeaders = {
	'Content-Type': 'application/xml; charset=utf-8',
	'Cache-Control': SITEMAP_CACHE_CONTROL,
	'X-Content-Type-Options': 'nosniff'
} as const;

const textHeaders = {
	'Content-Type': 'text/plain; charset=utf-8',
	'Cache-Control': SITEMAP_CACHE_CONTROL,
	'X-Content-Type-Options': 'nosniff'
} as const;

// ---------------------------------------------------------------------------
// MongoDB-backed source (lazy imports: the module must stay cheap for the
// robots.txt handler and for unit tests that inject their own source).

const publicPostsMatch = async () => {
	const { postMatch, visibilityQueryFor, withMatch } = await import('../things/things');
	const { subspaceFeedClauses } = await import('../subspaces/gate');
	// subspace fences: removed and private-subspace posts never syndicate
	return withMatch(await postMatch(), visibilityQueryFor(null, ['public']), ...subspaceFeedClauses(null));
};

const publicWebpagesMatch = async () => {
	const { visibilityQueryFor, withMatch } = await import('../things/things');
	// Route twins (crystal.siteRoute) answer for app routes and are already in
	// the static list; page keys of system suites resolve per viewer. Only
	// stand-alone published pages get a /p/<shareId> permalink here.
	return withMatch({ thingtime: 'webpage', 'crystal.siteRoute': { $in: [null] } }, visibilityQueryFor(null, ['public']));
};

const lastmodOf = (doc: any): string | undefined => sitemapDate(doc?.updatedAt) ?? sitemapDate(doc?.createdAt);

// Superset page → exact anonymous acl evaluation → permalinks. Bounded by
// SITEMAP_PAGE_SIZE and by the caller's page ≤ SITEMAP_MAX_PAGES guard.
const listVisibleThings = async (origin: string, match: Record<string, any>, page: number, pathFor: (doc: any) => string): Promise<SitemapUrl[]> => {
	const { getThingsCollection } = await import('../mongodb/collections');
	const { canViewInherited } = await import('../things/things');
	const things = await getThingsCollection();
	const docs = (await things
		.find(match as any)
		.sort({ createdAt: -1, shareId: 1 })
		.skip((page - 1) * SITEMAP_PAGE_SIZE)
		.limit(SITEMAP_PAGE_SIZE)
		.toArray()) as any[];
	const urls: SitemapUrl[] = [];
	for (const doc of docs) {
		if (typeof doc?.shareId !== 'string' || !doc.shareId) continue;
		if (!(await canViewInherited(doc, null))) continue;
		urls.push({ loc: absoluteUrl(origin, pathFor(doc)), lastmod: lastmodOf(doc), changefreq: 'weekly' });
	}
	return urls;
};

export const mongoSitemapDataSource = (origin: string): SitemapDataSource => ({
	countPublicPosts: async () => {
		const { getThingsCollection } = await import('../mongodb/collections');
		const things = await getThingsCollection();
		return things.countDocuments((await publicPostsMatch()) as any, { limit: SITEMAP_MAX_PAGES * SITEMAP_PAGE_SIZE });
	},
	listPublicPosts: async (page) => listVisibleThings(origin, await publicPostsMatch(), page, (doc) => `/post/${encodeURIComponent(doc.shareId)}`),
	countPublicWebpages: async () => {
		const { getThingsCollection } = await import('../mongodb/collections');
		const things = await getThingsCollection();
		return things.countDocuments((await publicWebpagesMatch()) as any, { limit: SITEMAP_MAX_PAGES * SITEMAP_PAGE_SIZE });
	},
	listPublicWebpages: async (page) => listVisibleThings(origin, await publicWebpagesMatch(), page, (doc) => `/p/${encodeURIComponent(doc.shareId)}`),
	listPublicProfiles: async () => {
		// Profiles of people who have at least one public post, most recently
		// active first. Deliberately NOT every account: a profile page is public,
		// but advertising the whole user table to crawlers is a different thing
		// from listing the authors of content that is already syndicated.
		const { getThingsCollection } = await import('../mongodb/collections');
		const { findUsersByIds } = await import('../auth/users');
		const things = await getThingsCollection();
		const authors = (await things
			.aggregate([
				{ $match: await publicPostsMatch() },
				{ $group: { _id: '$ownerId', lastmod: { $max: '$createdAt' } } },
				{ $match: { _id: { $type: 'string', $nin: ['', 'system'] } } },
				{ $sort: { lastmod: -1 } },
				{ $limit: SITEMAP_MAX_PROFILES }
			])
			.toArray()) as Array<{ _id: string; lastmod?: unknown }>;
		const lastmodById = new Map(authors.map((author) => [String(author._id), sitemapDate(author.lastmod)]));
		const urls: SitemapUrl[] = [];
		for (let index = 0; index < authors.length; index += 500) {
			const users = await findUsersByIds(authors.slice(index, index + 500).map((author) => String(author._id)));
			for (const user of users as any[]) {
				const username = typeof user?.username === 'string' ? user.username.trim() : '';
				if (!username) continue;
				urls.push({
					loc: absoluteUrl(origin, `/profile/${encodeURIComponent(username)}`),
					lastmod: lastmodById.get(String(user._id ?? user.id)),
					changefreq: 'weekly'
				});
			}
		}
		return urls;
	}
});

// ---------------------------------------------------------------------------
// Response builders (shared by /sitemap.xml, /api/v1/sitemap and the script)

export type SitemapDocument = { status: 200; contentType: 'application/xml'; body: string } | { status: 400 | 404; contentType: 'text/plain'; body: string };

const pagedList = (source: SitemapDataSource, section: SitemapSection): [() => Promise<number>, (page: number) => Promise<SitemapUrl[]>] =>
	section === 'posts' ? [source.countPublicPosts, source.listPublicPosts] : [source.countPublicWebpages, source.listPublicWebpages];

// Build the document a sitemap request describes. `lastmod` is the moment the
// index was generated; individual URLs carry their own timestamps.
export const buildSitemapDocument = async (origin: string, searchParams: URLSearchParams, source: SitemapDataSource, now = new Date()): Promise<SitemapDocument> => {
	const selection = selectSitemapRequest(searchParams);
	if (selection.kind === 'invalid') return { status: 400, contentType: 'text/plain', body: `Bad sitemap request: ${selection.error}\n` };
	const lastmod = now.toISOString();
	if (selection.kind === 'index') {
		const [posts, pages, profiles] = await Promise.all([source.countPublicPosts(), source.countPublicWebpages(), source.listPublicProfiles().then((urls) => urls.length)]);
		return { status: 200, contentType: 'application/xml', body: renderSitemapIndex(sitemapIndexEntries(origin, { posts, pages, profiles, lastmod })) };
	}
	if (selection.section === 'static') {
		return { status: 200, contentType: 'application/xml', body: renderUrlset(staticSitemapUrls(origin, brandingAssets, lastmod)) };
	}
	if (selection.section === 'profiles') {
		return { status: 200, contentType: 'application/xml', body: renderUrlset(await source.listPublicProfiles()) };
	}
	if (PAGED_SITEMAP_SECTIONS.includes(selection.section)) {
		const [count, list] = pagedList(source, selection.section);
		const pages = pageCountFor(await count());
		if (selection.page > Math.max(pages, 1)) {
			return { status: 404, contentType: 'text/plain', body: `Sitemap page ${selection.page} does not exist (${pages} page${pages === 1 ? '' : 's'} available)\n` };
		}
		return { status: 200, contentType: 'application/xml', body: renderUrlset(await list(selection.page)) };
	}
	return { status: 404, contentType: 'text/plain', body: 'Sitemap section not found\n' };
};

export const sitemapDocumentResponse = (document: SitemapDocument, method: string): Response =>
	new Response(method === 'HEAD' ? null : document.body, {
		status: document.status,
		// text documents are always 400/404 explanations: keep them briefly cacheable so
		// a fixed cause is not stuck at the edge for an hour
		headers: document.contentType === 'application/xml' ? xmlHeaders : { ...textHeaders, 'Cache-Control': 'public, max-age=60' }
	});

// GET/HEAD handler body shared by the Nitro /sitemap.xml route and the
// /api/v1/sitemap loader. Anonymous by construction: cookies and bearer
// tokens are never consulted, which is what makes the shared-cache headers safe.
export const respondSitemap = async (request: Request, origin: string, source: SitemapDataSource = mongoSitemapDataSource(origin)): Promise<Response> => {
	const method = request.method.toUpperCase();
	if (method !== 'GET' && method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
	const document = await buildSitemapDocument(origin, new URL(request.url).searchParams, source);
	return sitemapDocumentResponse(document, method);
};

export const respondRobots = (request: Request, origin: string): Response => {
	const method = request.method.toUpperCase();
	if (method !== 'GET' && method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
	return new Response(method === 'HEAD' ? null : buildRobotsTxt(origin), { headers: textHeaders });
};

export { buildRobotsTxt };
