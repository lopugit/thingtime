import { json } from '~/api/http';

import { resolveThingsActor } from '~/api/utils/auth/patTokens';
import { getTrendingPosts } from '~/api/utils/things/trending';

// Trending moves slowly (engagement decays hourly, not per-request): five
// minutes fresh + fifteen minutes serve-stale-while-revalidating keeps anon
// explore traffic on the nearest Vercel edge PoP instead of a function.
const ANON_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=900';

// GET /api/v1/things/trending?anon=1
// The explore board: public posts from the last week ranked by time-decayed
// engagement. Works logged out (the candidate pool is public-only either
// way); a session only personalises projections (viewerReactions, poll
// viewerVote). `anon=1` requests the logged-out view regardless of cookies —
// the response then depends only on the URL, so it is safe to cache on
// Vercel's edge (same contract as the feed's anon mode).
export const loader = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const anonCacheable = url.searchParams.get('anon') === '1';
  // Mirrors the feed: unknown/stale credentials degrade to an anonymous null
  // user so logged-out browsers keep the public board; only PAT-specific
  // failures (missing scope, exhausted) 4xx.
  let user = null;
  if (!anonCacheable) {
    const auth = await resolveThingsActor(request, 'things.read');
    if (auth.ok === false) {
      return json({ ok: false, error: auth.error }, { status: auth.status });
    }
    user = auth.actor.user;
  }

  const result = await getTrendingPosts(user ? { id: user.id, username: user.username } : null);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(
    { ok: true, posts: result.posts, generatedAt: result.generatedAt },
    {
      headers: anonCacheable ? { 'Cache-Control': ANON_CACHE_CONTROL } : user ? { 'Cache-Control': 'private, no-store' } : {}
    }
  );
};
