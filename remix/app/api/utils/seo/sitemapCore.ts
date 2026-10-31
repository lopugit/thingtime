// Sitemap + robots.txt building blocks — pure, dependency-free, so the same
// code drives GET /sitemap.xml, GET /api/v1/sitemap, and the offline
// `npm run sitemap:generate` script (which imports this file straight into
// node without a bundler; keep imports relative and side-effect free).
//
// Shape (sitemaps.org protocol, 50k URLs / 50 MB per file):
//   /sitemap.xml                         → <sitemapindex> of every section file
//   /sitemap.xml?section=static          → hand-listed public pages + brand images
//   /sitemap.xml?section=posts&page=N    → public posts, newest first, paged
//   /sitemap.xml?section=pages&page=N    → public published /p/<id> pages, paged
//   /sitemap.xml?section=profiles        → profiles of people with public posts
// Every UGC section is bounded (page size × max pages) so a crawler can never
// make the server walk the whole collection in one request.

// Explicit .ts extensions: scripts/generate-sitemap.mjs imports this module
// straight into node (type stripping), which resolves relative paths literally.
import { ORGANIZATION_LOGO_PATH, ORGANIZATION_WORDMARK_PATH } from '../meta/brandIdentity.ts';
import { STATIC_SITEMAP_PATHS, isIndexableStaticPath } from '../meta/indexablePaths.ts';

export const SITEMAP_PATH = '/sitemap.xml';
export const ROBOTS_PATH = '/robots.txt';
export const SITEMAP_API_PATH = '/api/v1/sitemap';

export const SITEMAP_SECTIONS = ['static', 'posts', 'pages', 'profiles'] as const;
export type SitemapSection = (typeof SITEMAP_SECTIONS)[number];
export const PAGED_SITEMAP_SECTIONS: readonly SitemapSection[] = ['posts', 'pages'];

// URLs per paged section file. Well under the 50k protocol cap on purpose:
// every URL costs an exact anonymous acl check, so one page stays one cheap
// request even when the data plane is cold.
export const SITEMAP_PAGE_SIZE = 500;
// Hard ceiling per section (100 × 500 = 50k URLs). Older content past the cap
// stays reachable through in-app links and the API; the index simply stops
// advertising it.
export const SITEMAP_MAX_PAGES = 100;
// Profiles are a single file: the most recently active public authors.
export const SITEMAP_MAX_PROFILES = 5000;

export type SitemapImage = { loc: string; title?: string };

export type SitemapUrl = {
	loc: string;
	lastmod?: string;
	changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
	priority?: number;
	images?: SitemapImage[];
};

export type SitemapIndexEntry = { loc: string; lastmod?: string };

// The subset of brandingAssets.generated.json the sitemap reads. Passed in
// rather than imported so the offline script can load the JSON with fs and
// the runtime can import it through Vite — one builder, two loaders.
export type BrandingAssetsManifest = {
	variants: Array<{ slug: string; name: string; svg: { url: string }; pngs: Array<{ w: number; h: number; url: string }> }>;
	presskit?: Array<{ slug: string; name: string; url: string }>;
};

// XML 1.0: TAB/LF/CR are the only legal C0 controls; C1 controls, DEL and the
// FFFE/FFFF non-characters are never valid. Strip, then escape the five XML
// metacharacters — the single choke point every dynamic value passes through.
export const xmlText = (value: unknown): string =>
	(typeof value === 'string' ? value : value == null ? '' : String(value))
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]/g, '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');

// W3C datetime for <lastmod>; a malformed date is dropped rather than emitted.
export const sitemapDate = (value: unknown): string | undefined => {
	if (value == null || value === '') return undefined;
	const time = value instanceof Date ? value.getTime() : new Date(value as any).getTime();
	return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
};

export const normaliseSitemapOrigin = (origin: string): string => {
	const url = new URL(origin);
	return url.origin;
};

export const absoluteUrl = (origin: string, path: string): string => `${normaliseSitemapOrigin(origin)}${path.startsWith('/') ? path : `/${path}`}`;

const renderImage = (image: SitemapImage): string =>
	[
		'    <image:image>',
		`      <image:loc>${xmlText(image.loc)}</image:loc>`,
		...(image.title ? [`      <image:title>${xmlText(image.title)}</image:title>`] : []),
		'    </image:image>'
	].join('\n');

const renderUrl = (url: SitemapUrl): string => {
	const lines = ['  <url>', `    <loc>${xmlText(url.loc)}</loc>`];
	const lastmod = sitemapDate(url.lastmod);
	if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
	if (url.changefreq) lines.push(`    <changefreq>${url.changefreq}</changefreq>`);
	if (typeof url.priority === 'number' && Number.isFinite(url.priority)) {
		lines.push(`    <priority>${Math.min(1, Math.max(0, url.priority)).toFixed(1)}</priority>`);
	}
	for (const image of url.images ?? []) lines.push(renderImage(image));
	lines.push('  </url>');
	return lines.join('\n');
};

export const renderUrlset = (urls: readonly SitemapUrl[]): string => {
	const hasImages = urls.some((url) => url.images?.length);
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${
			hasImages ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : ''
		}>`,
		...urls.map(renderUrl),
		'</urlset>',
		''
	].join('\n');
};

export const renderSitemapIndex = (entries: readonly SitemapIndexEntry[]): string =>
	[
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...entries.map((entry) => {
			const lastmod = sitemapDate(entry.lastmod);
			return ['  <sitemap>', `    <loc>${xmlText(entry.loc)}</loc>`, ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []), '  </sitemap>'].join('\n');
		}),
		'</sitemapindex>',
		''
	].join('\n');

// Section file URL. Query strings are legal in a sitemap index and keep the
// whole feature behind one explicit server route.
export const sitemapSectionUrl = (origin: string, section: SitemapSection, page?: number): string => {
	const url = new URL(SITEMAP_PATH, normaliseSitemapOrigin(origin));
	url.searchParams.set('section', section);
	if (page !== undefined) url.searchParams.set('page', String(page));
	return url.toString();
};

// Brand imagery attached to the pages that show it — this is what lets image
// search associate the real logo files with the site instead of merch photos.
export const brandImagesFor = (origin: string, path: string, manifest: BrandingAssetsManifest): SitemapImage[] => {
	if (path === '/') {
		return [
			{ loc: absoluteUrl(origin, ORGANIZATION_LOGO_PATH), title: 'Thingtime logo icon' },
			{ loc: absoluteUrl(origin, ORGANIZATION_WORDMARK_PATH), title: 'Thingtime logo wordmark' }
		];
	}
	if (path !== '/branding') return [];
	const images: SitemapImage[] = [];
	for (const variant of manifest.variants) {
		const png = variant.pngs.find((entry) => entry.w === 1024) ?? variant.pngs[variant.pngs.length - 1];
		if (png) images.push({ loc: absoluteUrl(origin, png.url), title: `Thingtime ${variant.name} logo (PNG)` });
		if (variant.svg?.url) images.push({ loc: absoluteUrl(origin, variant.svg.url), title: `Thingtime ${variant.name} logo (SVG)` });
	}
	for (const item of manifest.presskit ?? []) images.push({ loc: absoluteUrl(origin, item.url), title: `Thingtime ${item.name}` });
	return images;
};

export const staticSitemapUrls = (origin: string, manifest: BrandingAssetsManifest, lastmod?: string): SitemapUrl[] =>
	STATIC_SITEMAP_PATHS.filter(isIndexableStaticPath).map((path) => ({
		loc: absoluteUrl(origin, path),
		...(lastmod ? { lastmod } : {}),
		changefreq: path === '/' || path === '/feed' || path === '/explore' ? 'daily' : 'weekly',
		priority: path === '/' ? 1 : path === '/branding' || path === '/welcome' ? 0.8 : 0.6,
		images: brandImagesFor(origin, path, manifest)
	}));

export const pageCountFor = (total: number): number => Math.min(SITEMAP_MAX_PAGES, Math.max(0, Math.ceil(Math.max(0, total) / SITEMAP_PAGE_SIZE)));

export type SitemapIndexCounts = { posts: number; pages: number; profiles: number; lastmod?: string };

export const sitemapIndexEntries = (origin: string, counts: SitemapIndexCounts): SitemapIndexEntry[] => {
	const entries: SitemapIndexEntry[] = [{ loc: sitemapSectionUrl(origin, 'static'), lastmod: counts.lastmod }];
	for (let page = 1; page <= pageCountFor(counts.posts); page += 1) entries.push({ loc: sitemapSectionUrl(origin, 'posts', page), lastmod: counts.lastmod });
	for (let page = 1; page <= pageCountFor(counts.pages); page += 1) entries.push({ loc: sitemapSectionUrl(origin, 'pages', page), lastmod: counts.lastmod });
	if (counts.profiles > 0) entries.push({ loc: sitemapSectionUrl(origin, 'profiles'), lastmod: counts.lastmod });
	return entries;
};

export type SitemapRequestSelection =
	| { kind: 'index' }
	| { kind: 'section'; section: SitemapSection; page: number }
	| { kind: 'invalid'; error: string };

// Query parsing for both the /sitemap.xml route and the /api/v1/sitemap
// endpoint. `page` is 1-based, only meaningful on paged sections, and bounded
// by SITEMAP_MAX_PAGES so an absurd value is refused before any query runs.
export const selectSitemapRequest = (searchParams: URLSearchParams): SitemapRequestSelection => {
	const sectionRaw = searchParams.get('section');
	const pageRaw = searchParams.get('page');
	if (sectionRaw === null) {
		return pageRaw === null ? { kind: 'index' } : { kind: 'invalid', error: 'page requires a section' };
	}
	if (!(SITEMAP_SECTIONS as readonly string[]).includes(sectionRaw)) {
		return { kind: 'invalid', error: `section must be one of ${SITEMAP_SECTIONS.join(', ')}` };
	}
	const section = sectionRaw as SitemapSection;
	if (!PAGED_SITEMAP_SECTIONS.includes(section)) {
		return pageRaw === null || pageRaw === '1' ? { kind: 'section', section, page: 1 } : { kind: 'invalid', error: `${section} is a single-page section` };
	}
	if (pageRaw === null) return { kind: 'section', section, page: 1 };
	if (!/^[1-9][0-9]{0,3}$/.test(pageRaw) || Number(pageRaw) > SITEMAP_MAX_PAGES) {
		return { kind: 'invalid', error: `page must be an integer between 1 and ${SITEMAP_MAX_PAGES}` };
	}
	return { kind: 'section', section, page: Number(pageRaw) };
};

// ---------------------------------------------------------------------------
// robots.txt

// Well-known AI/LLM crawlers, explicitly welcomed (the owner's decision: the
// site is open to search and AI indexing alike). `User-agent: *` already
// allows them; naming them makes the intent unambiguous to operators that
// look for an explicit stanza before crawling.
export const AI_CRAWLER_USER_AGENTS: readonly string[] = [
	'GPTBot',
	'ChatGPT-User',
	'OAI-SearchBot',
	'ClaudeBot',
	'Claude-User',
	'Claude-SearchBot',
	'anthropic-ai',
	'Google-Extended',
	'Applebot-Extended',
	'PerplexityBot',
	'Perplexity-User',
	'CCBot',
	'Bytespider',
	'Amazonbot',
	'meta-externalagent',
	'cohere-ai',
	'DuckAssistBot',
	'YouBot',
	'MistralAI-User',
	'Diffbot'
];

export const buildRobotsTxt = (origin: string): string =>
	[
		'# Thingtime — everything here is welcome to be crawled, indexed and learned from.',
		'# Search engines and AI crawlers alike: the whole site is allowed.',
		'',
		'User-agent: *',
		'Allow: /',
		'',
		...AI_CRAWLER_USER_AGENTS.flatMap((agent) => [`User-agent: ${agent}`, 'Allow: /', '']),
		`Sitemap: ${absoluteUrl(origin, SITEMAP_PATH)}`,
		''
	].join('\n');
