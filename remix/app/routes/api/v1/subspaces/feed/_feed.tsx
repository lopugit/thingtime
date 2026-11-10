import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { subspaceFeed } from '~/api/utils/subspaces/subspaces';
import { viewerOf } from '~/api/utils/things/things';

// GET /api/v1/subspaces/feed?slug=&sort=hot|new|top|rising|controversial&range=&cursor=&limit=&includeRemoved=
// The posts of one subspace. Works logged out for public/restricted
// subspaces; private ones are members-only (403). `new` pages by chrono
// cursor with pinned posts leading the first page; the ranked sorts score a
// bounded newest-first window with relational up/down tallies and page by
// offset. Moderators may pass includeRemoved=1 to review removed posts.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  const params = new URL(request.url).searchParams;
  const result = await subspaceFeed(viewerOf(user), {
    id: params.get('id'),
    slug: params.get('slug'),
    sort: params.get('sort'),
    range: params.get('range'),
    cursor: params.get('cursor'),
    limit: params.get('limit'),
    includeRemoved: params.get('includeRemoved')
  });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
