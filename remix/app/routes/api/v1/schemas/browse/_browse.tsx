import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { browseSchemas } from '~/api/utils/schemas/browse';

// GET /api/v1/schemas/browse — paginated browsing of published schema things
// (the UGC side of /schemas; built-in registry schemas ship in the client
// bundle and merge client-side).
//
//   ?q=          text search (relevance-ranked unless sort says otherwise)
//   ?sort=       newest (default) | oldest | popular | relevance
//   ?cursor=     opaque cursor from the previous page
//   ?limit=      page size (max 50)
//   ?library=1   only schemas the caller saved (auth required)
//   ?mine=1      only the caller's own schemas (auth required)
//
// Anonymous callers see public schemas. Every entry carries reactionCounts,
// viewerReactions, saved, and usageCount (data things following the schema).
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);

  const limit = await enforceRateLimit(request, 'schemas.browse', user ? `user:${user.id}` : null);
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re browsing very enthusiastically — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const params = new URL(request.url).searchParams;
  const result = await browseSchemas(user ? { id: user.id, username: user.username } : null, {
    q: params.get('q') || undefined,
    sort: params.get('sort') || undefined,
    cursor: params.get('cursor') || undefined,
    limit: params.get('limit') ? Number(params.get('limit')) : undefined,
    library: params.get('library') || undefined,
    mine: params.get('mine') || undefined
  });

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
