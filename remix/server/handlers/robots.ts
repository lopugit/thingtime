import { defineHandler } from 'nitro/h3';

import { getRequestOrigin } from '../../app/api/utils/health/statusTarget';

// Production remains indexable. Nonproduction deploys discourage cooperative
// crawlers in addition to platform authentication, which enforces actual access.
// Lazy import for the same bundler-ordering reason as handlers/sitemap.ts.
export default defineHandler(async (event) => {
	const { respondRobots } = await import('../../app/api/utils/seo/sitemap');
	const nonProduction = process.env.VERCEL_ENV === 'preview' ||
		['preview', 'develop', 'development', 'staging'].includes(process.env.THINGTIME_GATEWAY_ENVIRONMENT || '');
	return respondRobots(event.req, getRequestOrigin(event.req), { allowCrawling: !nonProduction });
});
