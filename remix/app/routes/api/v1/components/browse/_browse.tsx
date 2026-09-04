import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { browseComponents } from '~/api/utils/components/browse';

// GET /api/v1/components/browse — paginated browsing of component things (the
// /components page; system-seeded platform library + user-published ones ride
// one query).
//
//   ?q=          text search (relevance-ranked unless sort says otherwise)
//   ?sort=       newest (default) | oldest | popular | relevance
//   ?cursor=     opaque cursor from the previous page
//   ?limit=      page size (max 50)
//   ?lib=        design-library filter (antd|bootstrap|mui|…), no-q pages only
//   ?category=   catalog category filter, no-q pages only
//   ?group=family  one card per familyKey (plain browse only) with designs[]
//   ?family=     every design of one family (familyKey or componentKey)
//   ?library=1   only components the caller saved (auth required)
//   ?mine=1      only the caller's own components (auth required)
//
// Anonymous callers see public components. Every entry carries reactionCounts,
// viewerReactions, saved, and usageCount (visible saved versions sharing the
// componentKey).
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);

  const limit = await enforceRateLimit(request, 'components.browse', user ? `user:${user.id}` : null);
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re browsing very enthusiastically — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const params = new URL(request.url).searchParams;
  const result = await browseComponents(user ? { id: user.id, username: user.username } : null, {
    q: params.get('q') || undefined,
    sort: params.get('sort') || undefined,
    cursor: params.get('cursor') || undefined,
    limit: params.get('limit') ? Number(params.get('limit')) : undefined,
    lib: params.get('lib') || undefined,
    category: params.get('category') || undefined,
    group: params.get('group') || undefined,
    family: params.get('family') || undefined,
    library: params.get('library') || undefined,
    mine: params.get('mine') || undefined
  });

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
