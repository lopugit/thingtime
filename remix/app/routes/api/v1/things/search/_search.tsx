import { json, readJsonBody } from '~/api/http';

import { resolveThingsActor } from '~/api/utils/auth/patTokens';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { searchThings, type SearchQuery } from '~/api/utils/things/search';
import { viewerOf } from '~/api/utils/things/things';

// Search bodies are small JSON condition trees.
const MAX_BODY_BYTES = 32 * 1024;

// Matches the feed's anon edge-cache policy: one minute fresh, five minutes
// serve-stale-while-revalidating at the nearest Vercel PoP.
const ANON_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';

const respond = async (
  request: Request,
  user: { id: string; username: string } | null,
  query: SearchQuery,
  anonCacheable = false
) => {
  // throttled for everyone (searches hit indexes, but a query builder is still
  // an invitation to hammer) — authed users by id, anonymous by hashed IP
  const limit = await enforceRateLimit(request, 'things.search', user ? `user:${user.id}` : null);
  if (!limit.allowed) {
    return json(
      { ok: false, error: 'You’re searching very enthusiastically — take a breather 🌸' },
      rateLimitedResponseInit(limit)
    );
  }

  const result = await searchThings(viewerOf(user), query);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(
    {
      ok: true,
      things: result.things,
      posts: result.posts,
      nextCursor: result.nextCursor,
      total: result.total,
      totalCapped: result.totalCapped,
      ranked: result.ranked
    },
    anonCacheable ? { headers: { 'Cache-Control': ANON_CACHE_CONTROL } } : {}
  );
};

// GET /api/v1/things/search?q=&thingtime=&tags=&sort=&cursor=&limit=&anon=1 — the
// simple shareable-URL form: ranked text search plus csv filters. `anon=1`
// forces the logged-out view regardless of cookies so the response depends
// only on the URL and can be cached at Vercel's edge (see feed loader for the
// full safety argument). Clients send it only when no viewer is present.
export const loader = async ({ request }: { request: Request }) => {
  const params = new URL(request.url).searchParams;
  const anonCacheable = params.get('anon') === '1';
  // `anon=1` forces the logged-out, edge-cacheable view. Otherwise resolve the
  // things actor (cookie/Bearer session or a scoped PAT) — unknown/stale
  // credentials degrade to an anonymous null user; only PAT-specific failures
  // (missing scope, exhausted uses) return an explicit error.
  let user = null;
  if (!anonCacheable) {
    const auth = await resolveThingsActor(request, 'things.read');
    if (auth.ok === false) {
      return json({ ok: false, error: auth.error }, { status: auth.status });
    }
    user = auth.actor.user;
  }
  return respond(
    request,
    user,
    {
      q: params.get('q') || undefined,
      thingtime: params.get('thingtime') || undefined,
      tags: params.get('tags') || undefined,
      from: params.get('from') || undefined,
      to: params.get('to') || undefined,
      sort: params.get('sort') || undefined,
      cursor: params.get('cursor'),
      limit: Number(params.get('limit')) || undefined,
      types: params.get('types') || undefined,
      circles: params.get('circles') || undefined,
      author: params.get('author') || undefined,
      minTextChars: params.get('minTextChars') || undefined,
      maxTextChars: params.get('maxTextChars') || undefined,
      minReactions: params.get('minReactions') || undefined,
      minComments: params.get('minComments') || undefined
    },
    anonCacheable
  );
};

// POST /api/v1/things/search — the full structured form: { q?, mode?,
// conditions?: [{ field, op, value | values } | { mode, conditions }], ... }.
// Read-only despite the verb; POST is just the vehicle for the condition tree.
export const action = async ({ request }: { request: Request }) => {
  if (request.method.toUpperCase() !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, POST' } });
  }
  const auth = await resolveThingsActor(request, 'things.read');
  if (auth.ok === false) {
    return json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const user = auth.actor.user;
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  return respond(request, user, {
    q: body?.q,
    mode: body?.mode,
    conditions: body?.conditions,
    thingtime: body?.thingtime,
    tags: body?.tags,
    from: body?.from,
    to: body?.to,
    sort: body?.sort,
    cursor: body?.cursor,
    limit: body?.limit,
    types: body?.types,
    circles: body?.circles,
    author: body?.author,
    minTextChars: body?.minTextChars,
    maxTextChars: body?.maxTextChars,
    minReactions: body?.minReactions,
    minComments: body?.minComments
  });
};
