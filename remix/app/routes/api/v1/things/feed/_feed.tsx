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

// The `anon=1` guard below only fences a Bearer credential when the request
// actually reaches this function. `public, s-maxage` is exactly the marker
// that licenses a shared cache to reuse a stored response for an
// Authorization-carrying request (RFC 9111 §3.5), so without varying on it
// the warm anon entry — always warm, on a URL built to be cached — would be
// replayed to a fenced token and hand back the public sphere the guard just
// closed off. Anonymous callers all share the header-absent key, so the
// cacheable path keeps one entry and loses no hit rate.
const ANON_CACHE_VARY = 'Authorization';

// GET /api/v1/things/feed?types=&circles=&from=&to=&algorithm=<id|latest>&cursor=&limit=&anon=1
// The public feed. Works logged out (public posts only). With `algorithm`
// omitted the viewer's active algorithm applies; 'latest' forces chronological.
// `anon=1` requests the logged-out view regardless of cookies — the response
// then depends only on the URL, so it is safe to cache on Vercel's edge (which
// keys by URL, not Cookie). Clients send it only when no viewer is present;
// authed requests never share these URLs, so a cached anon body can never be
// served to a logged-in viewer. A Bearer credential is the one exception: it
// is answered as itself, so a scoped token can never read past its own rules
// by asking for the anon view.
export const loader = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const params = url.searchParams;
  // Cookies are deliberately ignored (a logged-in browser may still ask for
  // the cacheable public feed — the web client never sends Authorization), but
  // a BEARER credential is not: `anon=1` would otherwise skip actor resolution
  // entirely and hand the asker the logged-out view past every per-credential
  // rule — today a visibility-fenced token's audience fence, which is supposed
  // to cover reads. Answering the token as itself also keeps the shared anon
  // URL's cache entry honest: a fenced body never carries ANON_CACHE_CONTROL,
  // and the cacheable one carries ANON_CACHE_VARY so no shared cache can
  // replay it to a credential that would have been fenced here.
  const anonCacheable = params.get('anon') === '1' && !request.headers.get('Authorization');
  // Otherwise resolve the things actor (cookie/Bearer session or a scoped PAT)
  // — unknown/stale credentials degrade to an anonymous null user, so
  // logged-out browsers keep the public feed; only PAT-specific failures
  // (missing scope, exhausted) 4xx.
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
    tag: params.get('tag'),
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
        ? { 'Cache-Control': ANON_CACHE_CONTROL, Vary: ANON_CACHE_VARY }
        : user
          ? { 'Cache-Control': 'private, no-store' }
          : {}
    }
  );
};
