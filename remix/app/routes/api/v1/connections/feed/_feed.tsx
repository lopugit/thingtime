import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { readConnectionsFeed } from '~/api/utils/connections/connections';
import { applyFeedFilters } from '~/api/utils/connections/filters';

// GET /api/v1/connections/feed — sync + read the caller's connected
// third-party feeds as Thingtime posts (comments/reactions attach natively).
// Query: connection=<id> narrows to one connection (default: all), cursor,
// limit, sync=force bypasses the per-account sync cooldown. Each post gains
// `feedFilterMatches` from the caller's enabled AI feed filters.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(request.url);
  const result = await readConnectionsFeed(user, {
    connectionId: url.searchParams.get('connection'),
    cursor: url.searchParams.get('cursor'),
    limit: Number(url.searchParams.get('limit')) || undefined,
    forceSync: url.searchParams.get('sync') === 'force'
  });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  const { matchesByPostId, filters } = await applyFeedFilters(user.id, result.posts);
  const posts = result.posts.map((post) => ({ ...post, feedFilterMatches: matchesByPostId.get(post.id) || [] }));
  return json({
    ok: true,
    posts,
    nextCursor: result.nextCursor,
    connections: result.connections,
    synced: result.synced,
    filters
  });
};
