import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { createSubspace, listSubspaces } from '~/api/utils/subspaces/subspaces';
import { viewerOf } from '~/api/utils/things/things';

// Matches the feed's anon edge-cache policy — one minute fresh, five minutes
// serve-stale-while-revalidating at the nearest Vercel PoP — and, for the
// reason spelled out there, varies on Authorization so a warm anon entry can
// never be replayed to a Bearer credential the loader below would have
// resolved. Anonymous callers all share the header-absent key.
const ANON_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';
const ANON_CACHE_VARY = 'Authorization';

// GET /api/v1/subspaces?q=&mine=&sort=&cursor=&limit=&anon=1 — the subspace
// directory (public, with the caller's membership state on each row);
// `mine=1` narrows to the caller's own memberships; `sort` is new (default,
// cursor-paged) | members | active (ranked over a bounded window, offset-
// paged — an unknown value answers 400). Rate-limited like the other public
// reads (subspaces.list, 120/min — the ranked sorts cost a candidate find
// plus one or two aggregations per call; anonymous callers key by IP).
// `anon=1` requests the logged-out view regardless of cookies — the response
// then depends only on the URL, so it is safe to cache on Vercel's edge
// (which keys by URL, not Cookie): the feed's contract — clients send it only
// when no viewer is present (the /explore strip, the /s directory and the
// /search section for guests), authed requests never share these URLs, and
// a Bearer credential is still answered as itself so a scoped token can
// never read past its own rules by asking for the anon view. There is no
// caller to narrow `mine=1` to under anon=1, so that pair answers 401.
export const loader = async ({ request }: { request: Request }) => {
  const params = new URL(request.url).searchParams;
  const anonCacheable = params.get('anon') === '1' && !request.headers.get('Authorization');
  const user = anonCacheable ? null : await getCurrentUser(request);
  const limit = await enforceRateLimit(request, 'subspaces.list', user ? `user:${user.id}` : null);
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re browsing subspaces very enthusiastically — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }
  const result = await listSubspaces(viewerOf(user), {
    q: params.get('q'),
    mine: params.get('mine'),
    sort: params.get('sort'),
    cursor: params.get('cursor'),
    limit: params.get('limit')
  });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result, {
    headers: anonCacheable ? { 'Cache-Control': ANON_CACHE_CONTROL, Vary: ANON_CACHE_VARY } : user ? { 'Cache-Control': 'private, no-store' } : {}
  });
};

// POST /api/v1/subspaces — { slug, name, description?, access?, nsfw?, rules?,
// flairs?, branding? } — found a subspace; the caller becomes its owner and
// first member.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const limit = await enforceRateLimit(request, 'subspaces.write', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Slow down a little 🌸' }, rateLimitedResponseInit(limit));
  }
  const body = await readJsonBody(request, 64 * 1024);
  const result = await createSubspace(viewerOf(user), body || {});
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result, { status: 201 });
};
