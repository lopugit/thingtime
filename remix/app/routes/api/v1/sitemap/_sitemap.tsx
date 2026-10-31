import { getRequestOrigin } from '~/api/utils/health/statusTarget';
import { respondSitemap } from '~/api/utils/seo/sitemap';

// GET /api/v1/sitemap
// The programmatic twin of GET /sitemap.xml — identical XML, identical query
// contract (?section=static|posts|pages|profiles, ?page=N on paged sections),
// so scripts, the offline generator and other deployments can pull the
// crawl frontier through the API. Always the anonymous viewer: only content an
// anonymous GET could already read is ever listed. Note the non-JSON body
// (application/xml) — like /api/v1/things/rss.
export const loader = async ({ request }: { request: Request }) => respondSitemap(request, getRequestOrigin(request));
