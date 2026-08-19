import { json } from '~/api/http';

import { getRequestOrigin } from '~/api/utils/health/statusTarget';
import { buildPublicPostsAtomFeed } from '~/api/utils/things/rss';

// The feed is anonymous-only (readers never authenticate), so the response
// depends only on the URL — same edge-cache contract as trending's anon mode.
const ANON_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=900';

// GET /api/v1/things/rss
// Atom feed of the latest ~50 PUBLIC (tt:all) posts, newest first. Always
// rendered as the anonymous viewer regardless of cookies: RSS readers have no
// session, and a viewer-independent body is what makes the edge caching safe.
// Note the non-JSON contract — this route returns application/atom+xml.
export const loader = async ({ request }: { request: Request }) => {
  const result = await buildPublicPostsAtomFeed(getRequestOrigin(request));
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return new Response(result.xml, {
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': ANON_CACHE_CONTROL
    }
  });
};
