// Which SPA paths are intentional public discovery surfaces.
//
// Single source of truth shared by the shell's robots meta tag
// (socialMeta.ts → `index, follow` vs `noindex, follow`) and the sitemap
// generator (seo/sitemapCore.ts): a path is listed in the sitemap only when
// the shell would also tell crawlers to index it, so the two never disagree.
// Data-backed public content (posts, profiles, pages…) is admitted separately
// by the anonymous preview's `publicContent` flag, never by this list.

export const INDEXABLE_STATIC_PATH_PATTERN =
	/^(?:\/|\/(?:welcome|about|branding|feed|explore|legal|privacy|terms)(?:\/)?|\/(?:docs|design-system)(?:\/.*)?)$/;

export const isIndexableStaticPath = (path: string): boolean => INDEXABLE_STATIC_PATH_PATTERN.test(path);

// The concrete static pages the sitemap advertises, in priority order. Every
// entry must satisfy isIndexableStaticPath (asserted by seo/sitemapCore.test.ts)
// and must exist in app/routes.tsx.
export const STATIC_SITEMAP_PATHS: readonly string[] = [
	'/',
	'/welcome',
	'/branding',
	'/feed',
	'/explore',
	'/docs',
	'/docs/api',
	'/design-system',
	'/legal',
	'/privacy',
	'/terms'
];
