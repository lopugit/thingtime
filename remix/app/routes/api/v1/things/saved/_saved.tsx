import { json } from '~/api/http';

import { resolveThingsActor } from '~/api/utils/auth/patTokens';
import { getSavedPosts } from '~/api/utils/things/saved';
import { viewerOf } from '~/api/utils/things/things';

// GET /api/v1/things/saved?cursor=&limit=
// The viewer's Saved library: posts they bookmarked via POST /things/save,
// newest-saved-first, projected exactly like the feed (reactions, comments,
// polls, viewerSaved). Requires a session — a library is personal by
// construction, so there is no anonymous view and responses never cache.
export const loader = async ({ request }: { request: Request }) => {
  const auth = await resolveThingsActor(request, 'things.read');
  if (auth.ok === false) {
    return json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const user = auth.actor.user;
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;

  const result = await getSavedPosts(viewerOf(user, auth.actor.pat), cursor, limit);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, posts: result.posts, nextCursor: result.nextCursor }, { headers: { 'Cache-Control': 'private, no-store' } });
};
