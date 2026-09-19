import { defineHandler } from 'nitro/h3';

import { getRequestOrigin } from '../../app/api/utils/health/statusTarget';

// GET /robots.txt — everything is allowed (search engines and AI crawlers
// alike, by the owner's decision) and the Sitemap line points at this
// origin's own /sitemap.xml, so previews never advertise production's map.
// Lazy import for the same bundler-ordering reason as handlers/sitemap.ts.
export default defineHandler(async (event) => {
	const { respondRobots } = await import('../../app/api/utils/seo/sitemap');
	return respondRobots(event.req, getRequestOrigin(event.req));
});
