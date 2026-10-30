import { defineHandler } from 'nitro/h3';

import { getRequestOrigin } from '../../app/api/utils/health/statusTarget';

// GET /sitemap.xml — the crawler-facing sitemap index and its section files
// (see app/api/utils/seo/sitemapCore.ts for the layout). Deliberately NOT
// wrapped in runWithMongoEndpoint: the response is shared-cacheable and keyed
// on the URL alone, so an unauthenticated data-plane override header must
// never be able to seed the public cache — same rule as /social-card.
//
// Lazy import, like the API catch-all's route modules: a static import here
// pulls the branding manifest JSON into the eager server graph, and rolldown
// then hoists Nitro's own runtime inits ahead of `init_app` (dev worker dies
// with "init_app is not a function"). Loading on first request keeps the
// server entry's module order untouched and the cold start cheap.
export default defineHandler(async (event) => {
	const { respondSitemap } = await import('../../app/api/utils/seo/sitemap');
	return respondSitemap(event.req, getRequestOrigin(event.req));
});
