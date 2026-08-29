import { json } from '~/api/http';

import { actorCors, actorPat, actorUser, resolveActor } from '~/api/utils/auth/resolveActor';
import type { Actor } from '~/api/utils/auth/resolveActor';
import { appDataPreflight, readJsonBodyWithCors } from '~/api/utils/apps/cors';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { searchThings, type SearchQuery } from '~/api/utils/things/search';
import { viewerOf } from '~/api/utils/things/things';

// Search bodies are small JSON condition trees.
const MAX_BODY_BYTES = 32 * 1024;

// Matches the feed's anon edge-cache policy: one minute fresh, five minutes
// serve-stale-while-revalidating at the nearest Vercel PoP — and, for the same
// reason spelled out there, keyed on Authorization so a warm anon entry can
// never be replayed to the Bearer credential the loader below would have
// resolved and fenced.
const ANON_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';
const ANON_CACHE_VARY = 'Authorization';

const respond = async (request: Request, actor: Actor, query: SearchQuery, anonCacheable = false) => {
  const user = actorUser(actor);
  const app = actor.kind === 'app' ? actor.scope : null;
  const cors = actorCors(actor);

  // throttled for everyone (searches hit indexes, but a query builder is still
  // an invitation to hammer) — authed users by id, anonymous by hashed IP,
  // app tokens by their own per-(user, app) window
  const limit = await enforceRateLimit(
    request,
    'things.search',
    actor.kind === 'app' ? actor.rateIdentity : user ? `user:${user.id}` : null
  );
  if (!limit.allowed) {
    const init = rateLimitedResponseInit(limit);
    return json(
      { ok: false, error: 'You’re searching very enthusiastically — take a breather 🌸' },
      { ...init, headers: { ...init.headers, ...cors } }
    );
  }

  // App tokens get the full grammar (value-path filters, sorts, cursors,
  // engagement windows) — the audience superset is swapped for the namespace
  // conjunction inside searchThings, server-side and inexpressible from the
  // client grammar.
  // pat context rides along so a visibility-restricted token's audience fence
  // applies to search results too
  const result = await searchThings(viewerOf(user, actorPat(actor)), query, app);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status, headers: cors });
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
    anonCacheable
      ? // cors is {} on this path (the loader hands `respond` an anonymous
        // actor), but compose rather than clobber so an app actor ever
        // reaching it keeps its Vary: Origin
        { headers: { ...cors, 'Cache-Control': ANON_CACHE_CONTROL, Vary: [cors.Vary, ANON_CACHE_VARY].filter(Boolean).join(', ') } }
      : { headers: cors }
  );
};

// GET /api/v1/things/search?q=&thingtime=&tags=&sort=&cursor=&limit=&anon=1 — the
// simple shareable-URL form: ranked text search plus csv filters. `anon=1`
// forces the logged-out view regardless of cookies so the response depends
// only on the URL and can be cached at Vercel's edge (see feed loader for the
// full safety argument). Clients send it only when no viewer is present; a
// Bearer credential is answered as itself rather than anonymously.
export const loader = async ({ request }: { request: Request }) => {
  const params = new URL(request.url).searchParams;
  // anon=1 forces the logged-out view regardless of cookies, so the response
  // depends only on the URL and can be edge-cached; otherwise resolve the
  // acting credential (cookie session, first-party Bearer, or app token). A
  // BEARER credential opts out of the shortcut (same rule as the feed loader):
  // skipping actor resolution would hand a visibility-fenced token the public
  // sphere its audience fence exists to keep it out of, and a fenced body must
  // never carry the shared anon URL's cache policy.
  const anonCacheable = params.get('anon') === '1' && !request.headers.get('Authorization');
  // Non-anon calls resolve the acting credential: cookie session, first-party
  // Bearer, app token, or a scoped PAT (things.read) — unknown/stale
  // credentials degrade to anonymous; PAT-specific failures (missing scope,
  // exhausted uses) come back as explicit errors.
  const actor: Actor | Response = anonCacheable
    ? { kind: 'anonymous' }
    : await resolveActor(request, { thingsScope: 'things.read' });
  if (actor instanceof Response) return actor;
  return respond(
    request,
    actor,
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
  // cross-origin SDK calls preflight (Authorization header) land here
  const preflight = appDataPreflight(request, 'GET, POST, OPTIONS');
  if (preflight) return preflight;

  if (request.method.toUpperCase() !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, POST' } });
  }
  const actor = await resolveActor(request, { thingsScope: 'things.read' });
  if (actor instanceof Response) return actor;
  const body = await readJsonBodyWithCors(request, MAX_BODY_BYTES, actorCors(actor));
  return respond(request, actor, {
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
