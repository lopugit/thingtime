import { json } from '~/api/http';

import { resolveThingsActor } from '~/api/utils/auth/patTokens';
import type { PatContext } from '~/api/utils/auth/patTokens';
import { getOwnedAlgorithmWeights } from '~/api/utils/algorithms/algorithms';
import { getFeed, viewerOf, type PostType, type PostVisibility } from '~/api/utils/things/things';

const csv = (value: string | null): string[] =>
  (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const isoDate = (value: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

// One minute fresh + five minutes serve-stale-while-revalidating: anon feed
// traffic is absorbed by the nearest Vercel edge PoP instead of a function.
const ANON_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';

// GET /api/v1/things/feed?types=&circles=&from=&to=&algorithm=<id|latest>&cursor=&limit=&anon=1
// The public feed. Works logged out (public posts only). With `algorithm`
// omitted the viewer's active algorithm applies; 'latest' forces chronological.
// `anon=1` requests the logged-out view regardless of cookies — the response
// then depends only on the URL, so it is safe to cache on Vercel's edge (which
// keys by URL, not Cookie). Clients send it only when no viewer is present;
// authed requests never share these URLs, so a cached anon body can never be
// served to a logged-in viewer.
export const loader = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const params = url.searchParams;
  const anonCacheable = params.get('anon') === '1';
  // `anon=1` forces the logged-out, edge-cacheable view. Otherwise resolve the
  // things actor (cookie/Bearer session or a scoped PAT) — unknown/stale
  // credentials degrade to an anonymous null user, so logged-out browsers keep
  // the public feed; only PAT-specific failures (missing scope, exhausted) 4xx.
  let user = null;
  let pat: PatContext | null = null;
  if (!anonCacheable) {
    const auth = await resolveThingsActor(request, 'things.read');
    if (auth.ok === false) {
      return json({ ok: false, error: auth.error }, { status: auth.status });
    }
    user = auth.actor.user;
    pat = auth.actor.pat;
  }

  const algorithmParam = (params.get('algorithm') || '').trim();
  let weights = null;
  if (user && algorithmParam !== 'latest') {
    const algorithmId = algorithmParam || user.activeFeedAlgorithmId;
    if (algorithmId) {
      weights = await getOwnedAlgorithmWeights(user.id, algorithmId);
      if (!weights && algorithmParam) {
        return json({ ok: false, error: 'Algorithm not found' }, { status: 404 });
      }
    }
  }

  // pat context rides along so a visibility-restricted token's audience fence
  // applies to the feed query and the per-doc checks
  const result = await getFeed(viewerOf(user, pat), {
    types: csv(params.get('types')) as PostType[],
    circles: csv(params.get('circles')) as PostVisibility[],
    from: isoDate(params.get('from')),
    to: isoDate(params.get('to')),
    cursor: params.get('cursor'),
    limit: Number(params.get('limit')) || undefined,
    weights
  });

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(
    { ok: true, posts: result.posts, nextCursor: result.nextCursor, ranked: result.ranked },
    {
      headers: anonCacheable
        ? { 'Cache-Control': ANON_CACHE_CONTROL }
        : user
          ? { 'Cache-Control': 'private, no-store' }
          : {}
    }
  );
};
