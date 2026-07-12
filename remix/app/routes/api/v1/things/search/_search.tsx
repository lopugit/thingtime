import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { searchThings, type SearchQuery } from '~/api/utils/things/search';
import { viewerOf } from '~/api/utils/things/things';

// Search bodies are small JSON condition trees.
const MAX_BODY_BYTES = 32 * 1024;

const respond = async (request: Request, user: { id: string; username: string } | null, query: SearchQuery) => {
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
  return json({
    ok: true,
    things: result.things,
    posts: result.posts,
    nextCursor: result.nextCursor,
    total: result.total,
    totalCapped: result.totalCapped,
    ranked: result.ranked
  });
};

// GET /api/v1/things/search?q=&thingtime=&tags=&sort=&cursor=&limit= — the
// simple shareable-URL form: ranked text search plus csv filters.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  const params = new URL(request.url).searchParams;
  return respond(request, user, {
    q: params.get('q') || undefined,
    thingtime: params.get('thingtime') || undefined,
    tags: params.get('tags') || undefined,
    from: params.get('from') || undefined,
    to: params.get('to') || undefined,
    sort: params.get('sort') || undefined,
    cursor: params.get('cursor'),
    limit: Number(params.get('limit')) || undefined
  });
};

// POST /api/v1/things/search — the full structured form: { q?, mode?,
// conditions?: [{ field, op, value | values } | { mode, conditions }], ... }.
// Read-only despite the verb; POST is just the vehicle for the condition tree.
export const action = async ({ request }: { request: Request }) => {
  if (request.method.toUpperCase() !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, POST' } });
  }
  const user = await getCurrentUser(request);
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
    limit: body?.limit
  });
};
